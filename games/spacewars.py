"""
Space Wars for the game room platform - inspired by the 1977 Cinematronics
cabinet (itself derived from MIT's Spacewar! of 1962).

Up to 4 ships fly around a central star. Each ship can rotate, thrust, fire
torpedoes and jump into hyperspace (risky: sometimes the ship explodes).
The star pulls ships in (or pushes them away with negative gravity) and
destroys anything that touches it. The last ship flying wins the round;
the first to the target number of rounds wins the match.

Same interface as games/snake.py. Inputs: {"key": <name>, "down": bool}
with key one of left, right, thrust, fire, hyper (held-button controls).
"""

import math
import random
import time

W = 1000.0                     # square world, star in the middle
CX = CY = W / 2
DT = 1 / 30                    # physics step and broadcast rate
SHIP_R = 14
STAR_R = 22
ROT_SPEED = 3.6                # rad/s
THRUST = 240.0                 # units/s²
MAX_SPEED = 420.0
TORP_SPEED = 430.0
TORP_LIFE = 1.6                # seconds
TORP_MAX = 4                   # live torpedoes per ship
FIRE_COOLDOWN = 0.28
HYPER_COOLDOWN = 3.0
HYPER_TIME = 1.0               # time spent in hyperspace
HYPER_RISK = 1 / 6             # chance of exploding on a jump
COUNTDOWN = 3.0                # before the first round
NEXT_ROUND = 2.0               # countdown before later rounds
ROUND_PAUSE = 2.5              # after a round ends, before the next countdown
BOOM_LIFE = 1.2
SPAWN_R = 380

GRAVITY = {"off": 0.0, "weak": 2.5e6, "normal": 5e6, "strong": 1e7, "negative": -4e6}
KEYS = ("left", "right", "thrust", "fire", "hyper")


class Ship:
    def __init__(self, pid):
        self.id = pid
        self.x = self.y = CX
        self.vx = self.vy = 0.0
        self.a = 0.0
        self.alive = False
        self.in_round = False
        self.out = False           # quit the match
        self.keys = set()
        self.hyper_req = False
        self.fire_cd = 0.0
        self.hyper_cd = 0.0
        self.hyper_until = 0.0     # > now while in hyperspace
        self.points = 0


class Torp:
    __slots__ = ("x", "y", "vx", "vy", "born", "owner")

    def __init__(self, x, y, vx, vy, born, owner):
        self.x, self.y, self.vx, self.vy, self.born, self.owner = x, y, vx, vy, born, owner


class SpaceWarsGame:
    id = "spacewars"
    name = "Space Wars"
    max_players = 4
    SETTINGS = [
        {"key": "gravity", "label": "Gravity", "default": "normal",
         "options": [["off", "Off"], ["weak", "Weak"], ["normal", "Normal"],
                     ["strong", "Strong"], ["negative", "Negative"]],
         "hints": {"off": "No star – pure dogfight.",
                   "weak": "A gentle pull towards the star.",
                   "normal": "Use the pull to orbit, thrust to escape.",
                   "strong": "Hard to escape – stay moving or fall in.",
                   "negative": "The star pushes you away. Don't touch it anyway."}},
        {"key": "edges", "label": "Screen edges", "default": "wrap",
         "options": [["wrap", "Wrap around"], ["bounce", "Bounce"]]},
        {"key": "hyperspace", "label": "Hyperspace", "default": "on",
         "options": [["on", "On"], ["off", "Off"]],
         "hints": {"on": "Jump to a random spot – sometimes your ship explodes instead."}},
        {"key": "target", "label": "Match", "default": 5,
         "options": [[3, "First to 3"], [5, "First to 5"], [10, "First to 10"]]},
    ]

    def __init__(self, room):
        self.room = room
        self.settings = {s["key"]: s["default"] for s in self.SETTINGS}
        self.running = False
        self.results = None
        self.phase = "idle"        # idle | countdown | playing | roundover | over
        self.phase_end = 0.0
        self.ships = {}
        self.torps = []
        self.booms = []            # [x, y, time, kind]
        self.round = 0
        self.round_msg = ""
        self.round_winner = None

    # ------------------------------------------------ settings
    def set_setting(self, key, value):
        for s in self.SETTINGS:
            if s["key"] == key and value in [o[0] for o in s["options"]]:
                self.settings[key] = value
                return True
        return False

    @property
    def g(self):
        return GRAVITY[self.settings["gravity"]]

    def tick(self):
        return DT if self.running else 0.05

    def name_of(self, pid):
        p = self.room.players.get(pid)
        return p.name if p else "?"

    # ------------------------------------------------ match flow
    def start(self, pids):
        self.results = None
        self.ships = {}
        for pid in pids:
            s = Ship(pid)
            s.in_round = True
            self.ships[pid] = s
        self.round = 0
        self.running = True
        self.new_round(COUNTDOWN)

    def new_round(self, countdown):
        self.round += 1
        self.torps = []
        self.round_msg = ""
        self.round_winner = None
        players = [s for s in self.ships.values() if s.in_round and not s.out]
        n = max(1, len(players))
        base = random.uniform(0, math.tau)
        for i, s in enumerate(players):
            ang = base + math.tau * i / n
            s.x = CX + math.cos(ang) * SPAWN_R
            s.y = CY + math.sin(ang) * SPAWN_R
            # start in a gentle orbit (tangential velocity) when the star pulls
            if self.g > 0:
                v = math.sqrt(self.g / SPAWN_R) * 0.9
                s.vx, s.vy = -math.sin(ang) * v, math.cos(ang) * v
                s.a = ang + math.pi / 2
            else:
                s.vx = s.vy = 0.0
                s.a = ang + math.pi        # facing the centre
            s.alive = True
            s.keys = set()
            s.hyper_req = False
            s.fire_cd = s.hyper_cd = 0.0
            s.hyper_until = 0.0
        self.phase = "countdown"
        self.phase_end = time.monotonic() + countdown

    def update(self, now):
        if not self.running:
            return False
        self.booms = [b for b in self.booms if now - b[2] < BOOM_LIFE]
        if self.phase == "countdown":
            if now >= self.phase_end:
                self.phase = "playing"
        elif self.phase == "playing":
            self.step(now)
            self.check_round(now)
        elif self.phase == "roundover":
            self.step(now)                     # let torpedoes and wrecks finish flying
            if now >= self.phase_end:
                target = self.settings["target"]
                if any(s.points >= target for s in self.ships.values()):
                    self.finish()
                elif not [s for s in self.ships.values() if s.in_round and not s.out]:
                    self.finish()
                else:
                    self.new_round(NEXT_ROUND)
        return True

    # ------------------------------------------------ input
    def input(self, pid, data):
        s = self.ships.get(pid)
        key = data.get("key")
        if not s or s.out or key not in KEYS:
            return
        if data.get("down"):
            if key == "hyper" and "hyper" not in s.keys:
                s.hyper_req = True
            s.keys.add(key)
        else:
            s.keys.discard(key)

    def quit(self, pid):
        s = self.ships.get(pid)
        if not s or s.out:
            return
        s.out = True
        s.alive = False
        self.check_round(time.monotonic())

    def remove(self, pid):
        self.ships.pop(pid, None)
        if self.running:
            self.check_round(time.monotonic())

    def can_drop_in(self):
        return False               # round based: the host restarts to add players

    def drop_in(self, pid):
        pass

    # ------------------------------------------------ physics
    def explode(self, s, now, kind="ship"):
        if not s.alive:
            return
        s.alive = False
        s.keys = set()
        self.booms.append([s.x, s.y, now, kind])

    def gravity(self, x, y):
        g = self.g
        if not g:
            return 0.0, 0.0
        dx, dy = CX - x, CY - y
        r2 = max(dx * dx + dy * dy, 40.0 * 40.0)
        r = math.sqrt(r2)
        acc = g / r2
        return acc * dx / r, acc * dy / r

    def edges(self, o, radius):
        if self.settings["edges"] == "wrap":
            o.x %= W
            o.y %= W
            return
        if o.x < radius:
            o.x, o.vx = radius, abs(o.vx) * 0.8
        elif o.x > W - radius:
            o.x, o.vx = W - radius, -abs(o.vx) * 0.8
        if o.y < radius:
            o.y, o.vy = radius, abs(o.vy) * 0.8
        elif o.y > W - radius:
            o.y, o.vy = W - radius, -abs(o.vy) * 0.8

    def random_spot(self):
        for _ in range(50):
            x, y = random.uniform(60, W - 60), random.uniform(60, W - 60)
            if math.hypot(x - CX, y - CY) > 180:
                return x, y
        return 100.0, 100.0

    def step(self, now):
        dt = DT
        star = self.g != 0
        playing = self.phase == "playing"

        for s in self.ships.values():
            if not s.alive:
                continue
            s.fire_cd = max(0.0, s.fire_cd - dt)
            s.hyper_cd = max(0.0, s.hyper_cd - dt)

            if s.hyper_until:
                if now < s.hyper_until:
                    continue                   # invisible, untouchable
                s.hyper_until = 0.0            # reappear
                s.x, s.y = self.random_spot()
                s.vx = s.vy = 0.0

            if s.hyper_req:
                s.hyper_req = False
                if playing and self.settings["hyperspace"] == "on" and s.hyper_cd <= 0:
                    s.hyper_cd = HYPER_COOLDOWN
                    if random.random() < HYPER_RISK:
                        self.explode(s, now, "hyper")
                        continue
                    s.hyper_until = now + HYPER_TIME
                    s.keys.discard("thrust")
                    continue

            if "left" in s.keys:
                s.a -= ROT_SPEED * dt
            if "right" in s.keys:
                s.a += ROT_SPEED * dt
            if "thrust" in s.keys:
                s.vx += math.cos(s.a) * THRUST * dt
                s.vy += math.sin(s.a) * THRUST * dt
            gx, gy = self.gravity(s.x, s.y)
            s.vx += gx * dt
            s.vy += gy * dt
            speed = math.hypot(s.vx, s.vy)
            if speed > MAX_SPEED:
                s.vx *= MAX_SPEED / speed
                s.vy *= MAX_SPEED / speed
            s.x += s.vx * dt
            s.y += s.vy * dt
            self.edges(s, SHIP_R)

            if star and math.hypot(s.x - CX, s.y - CY) < STAR_R + SHIP_R * 0.6:
                self.explode(s, now, "star")
                continue

            if playing and "fire" in s.keys and s.fire_cd <= 0:
                mine = sum(1 for t in self.torps if t.owner == s.id)
                if mine < TORP_MAX:
                    nx, ny = math.cos(s.a), math.sin(s.a)
                    self.torps.append(Torp(s.x + nx * (SHIP_R + 4), s.y + ny * (SHIP_R + 4),
                                           s.vx + nx * TORP_SPEED, s.vy + ny * TORP_SPEED,
                                           now, s.id))
                    s.fire_cd = FIRE_COOLDOWN

        # torpedoes (they fly straight; the star swallows them)
        keep = []
        for t in self.torps:
            if now - t.born > TORP_LIFE:
                continue
            t.x += t.vx * dt
            t.y += t.vy * dt
            self.edges(t, 2)
            if star and math.hypot(t.x - CX, t.y - CY) < STAR_R:
                continue
            keep.append(t)
        self.torps = keep

        # torpedo hits
        flying = [s for s in self.ships.values() if s.alive and not s.hyper_until]
        for t in list(self.torps):
            for s in flying:
                if not s.alive:
                    continue
                if t.owner == s.id and now - t.born < 0.2:
                    continue                   # don't hit yourself while launching
                if math.hypot(t.x - s.x, t.y - s.y) < SHIP_R + 2:
                    self.explode(s, now)
                    if t in self.torps:
                        self.torps.remove(t)
                    break

        # ship collisions: both explode
        flying = [s for s in flying if s.alive]
        for i, a in enumerate(flying):
            for b in flying[i + 1:]:
                if a.alive and b.alive and math.hypot(a.x - b.x, a.y - b.y) < SHIP_R * 1.6:
                    self.explode(a, now)
                    self.explode(b, now)

    # ------------------------------------------------ rounds and results
    def check_round(self, now):
        if self.phase != "playing":
            return
        players = [s for s in self.ships.values() if s.in_round and not s.out]
        alive = [s for s in players if s.alive]
        if len(players) >= 2:
            if len(alive) > 1:
                return
            if len(alive) == 1:
                w = alive[0]
                w.points += 1
                self.round_winner = w.id
                self.round_msg = f"{self.name_of(w.id)} wins round {self.round}"
            else:
                self.round_msg = f"Round {self.round}: no survivors"
        else:
            if alive:
                return
            self.round_msg = "Ship destroyed"
            if not players:
                self.finish()
                return
            # solo practice: one life
            self.phase = "roundover"
            self.phase_end = now + ROUND_PAUSE
            for s in players:
                s.out = True
            return
        self.phase = "roundover"
        self.phase_end = now + ROUND_PAUSE

    def finish(self):
        ships = sorted(self.ships.values(), key=lambda s: -s.points)
        target = self.settings["target"]
        winner = None
        if len(ships) == 1:
            title = f"Practice over – {self.round} round{'s' if self.round > 1 else ''} flown"
        else:
            top = ships[0].points if ships else 0
            leaders = [s for s in ships if s.points == top]
            if len(leaders) == 1 and top >= target:
                winner = leaders[0]
                title = f"{self.name_of(winner.id)} wins the match {top}–{ships[1].points if len(ships) > 1 else 0}!"
            elif len(leaders) == 1 and top > 0:
                winner = leaders[0]
                title = f"{self.name_of(winner.id)} wins with {top}"
            else:
                title = "Match over – no winner"
        self.results = {
            "title": title,
            "winner": winner.id if winner else None,
            "ranking": [{"id": s.id, "score": s.points} for s in ships],
        }
        self.phase = "over"
        self.running = False

    # ------------------------------------------------ state for browsers
    def snapshot(self):
        now = time.monotonic()
        countdown = 0
        if self.phase == "countdown":
            countdown = max(1, int(self.phase_end - now + 0.999))
        r = lambda v: round(v, 1)
        return {
            "phase": self.phase,
            "size": W,
            "star": self.g != 0,
            "gravity": self.settings["gravity"],
            "round": self.round,
            "target": self.settings["target"],
            "countdown": countdown,
            "round_msg": self.round_msg,
            "round_winner": self.round_winner,
            "ships": [{
                "id": s.id, "x": r(s.x), "y": r(s.y), "a": round(s.a, 3),
                "alive": s.alive, "out": s.out, "points": s.points,
                "thrust": s.alive and "thrust" in s.keys and not s.hyper_until,
                "hyper": bool(s.hyper_until),
            } for s in self.ships.values()],
            "torps": [[r(t.x), r(t.y), t.owner] for t in self.torps],
            "booms": [[r(b[0]), r(b[1]), round(now - b[2], 2), b[3]] for b in self.booms],
        }
