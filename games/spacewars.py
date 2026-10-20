"""
Space Wars for the game room platform - inspired by the 1977 Cinematronics
cabinet (itself derived from MIT's Spacewar! of 1962).

Up to 4 ships fly around a central star. Each ship can rotate, thrust, fire
torpedoes and jump into hyperspace (risky: sometimes the ship explodes).
The star pulls ships in (or pushes them away with negative gravity) and
destroys anything that touches it. The last ship flying wins the round;
the first to the target number of rounds wins the match.

Alone in the room it becomes training: free flight with respawns, until the
player exits. Optional asteroids (a few, set by the host) bounce off the
borders, feel the star's gravity, can be shot and destroy ships they hit.

Same interface as games/snake.py. Inputs: {"key": <name>, "down": bool}
with key one of left, right, thrust, reverse, fire, hyper (held-button controls).
"reverse" is a weaker retro-thrust out of the nose, for braking.
"""

import math
import random
import time

H = 1000.0                     # world height; the width depends on the arena setting
ARENA = {"square": 1000.0, "wide": 1333.0, "screen": 1778.0}   # 1:1, 4:3, 16:9
AUTO_DEFAULT = 1333.0          # Auto arena when no screen shape is known yet
CY = H / 2                     # the star sits in the middle
DT = 1 / 30                    # physics step and broadcast rate
SHIP_R = 14
STAR_R = 22
ROT_SPEED = 3.6                # rad/s
SOFTEN = 40.0                  # gravity uses r >= this, so the pull never becomes infinite
THRUST = 240.0                 # units/s²
REVERSE = 150.0                # retro-thrust (braking), units/s²
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
TRAIN_RESPAWN = 2.0            # training: back in flight after a crash
ROCK_R = (22, 34)              # asteroid radius range
ROCK_SPEED = (45, 90)
ROCK_GRAVITY = 0.45            # asteroids feel less pull than ships
ROCK_RESPAWN = 3.0             # a destroyed asteroid is replaced after this

GRAVITY = {"off": 0.0, "weak": 2.5e6, "normal": 5e6, "strong": 1e7, "negative": -4e6}
KEYS = ("left", "right", "thrust", "reverse", "fire", "hyper")


class Ship:
    def __init__(self, pid):
        self.id = pid
        self.x = self.y = CY
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
        self.points = 0            # rounds won (training: asteroids destroyed)
        self.deaths = 0            # training: crashes
        self.respawn_at = 0.0      # training: when to fly again


class Torp:
    __slots__ = ("x", "y", "vx", "vy", "born", "owner")

    def __init__(self, x, y, vx, vy, born, owner):
        self.x, self.y, self.vx, self.vy, self.born, self.owner = x, y, vx, vy, born, owner


class Rock:
    __slots__ = ("x", "y", "vx", "vy", "r", "seed", "rot", "spin")

    def __init__(self, W):
        CX = W / 2
        self.r = random.uniform(*ROCK_R)
        self.seed = random.randrange(1, 100000)      # the browser draws its shape from this
        self.rot = random.uniform(0, math.tau)
        self.spin = random.uniform(-0.8, 0.8)
        # enter from a random border, heading roughly inwards
        side = random.randrange(4)
        t = random.uniform(80, (W if side % 2 == 0 else H) - 80)
        self.x, self.y = [(t, self.r), (W - self.r, t), (t, H - self.r), (self.r, t)][side]
        # aimed past the star, not at it, so they swing around before falling in
        ang = math.atan2(CY - self.y, CX - self.x) + random.choice((-1, 1)) * random.uniform(0.6, 1.1)
        sp = random.uniform(*ROCK_SPEED)
        self.vx, self.vy = math.cos(ang) * sp, math.sin(ang) * sp


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
        {"key": "arena", "label": "Arena", "default": "auto",
         "options": [["auto", "Auto"], ["square", "Square"], ["wide", "Wide 4:3"], ["screen", "Widescreen 16:9"]],
         "hints": {"auto": "Alone: shaped like your screen. Together: shaped to suit the narrowest screen, "
                           "so everyone sees the whole arena at a good size.",
                   "square": "Best for phones held upright.",
                   "wide": "Shaped like the 1977 cabinet screen – fits PCs and tablets.",
                   "screen": "Fills a phone held sideways or a widescreen monitor."}},
        {"key": "edges", "label": "Screen edges", "default": "wrap",
         "options": [["wrap", "Wrap around"], ["bounce", "Bounce"]]},
        {"key": "hyperspace", "label": "Hyperspace", "default": "on",
         "options": [["on", "On"], ["off", "Off"]],
         "hints": {"on": "Jump to a random spot – sometimes your ship explodes instead."}},
        {"key": "asteroids", "label": "Asteroids", "default": 0,
         "options": [[0, "None"], [2, "2"], [4, "4"], [6, "6"]],
         "hints": {2: "They bounce off the borders, fall into the star, can be shot – and wreck any ship they hit.",
                   4: "They bounce off the borders, fall into the star, can be shot – and wreck any ship they hit.",
                   6: "They bounce off the borders, fall into the star, can be shot – and wreck any ship they hit."}},
        {"key": "target", "label": "Match", "default": 5,
         "options": [[3, "First to 3"], [5, "First to 5"], [10, "First to 10"]],
         "hints": {3: "Playing alone? You get free-flight training instead, until you press Exit.",
                   5: "Playing alone? You get free-flight training instead, until you press Exit.",
                   10: "Playing alone? You get free-flight training instead, until you press Exit."}},
    ]

    def __init__(self, room):
        self.room = room
        self.settings = {s["key"]: s["default"] for s in self.SETTINGS}
        self.auto_w = None         # Auto arena: the width chosen when the match started
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
        self.solo = False          # training: one player, no rounds
        self.rocks = []
        self.rock_due = []         # times at which a replacement asteroid enters

    # ------------------------------------------------ settings
    def set_setting(self, key, value):
        for s in self.SETTINGS:
            if s["key"] == key and value in [o[0] for o in s["options"]]:
                self.settings[key] = value
                return True
        return False

    @property
    def W(self):
        if self.settings.get("arena") == "auto":
            return self.auto_w or self.fit_width()
        return ARENA.get(self.settings.get("arena"), 1000.0)

    def fit_width(self, pids=None):
        # each browser reports the shape (width / height) of the space it has for the board;
        # the arena takes the narrowest one, between square and 16:9
        players = self.room.players
        ids = pids if pids is not None else [p for p in players if not players[p].waiting]
        shapes = [players[p].aspect for p in ids if p in players and getattr(players[p], "aspect", None)]
        if not shapes:
            return AUTO_DEFAULT
        return round(1000.0 * min(16 / 9, max(1.0, min(shapes))))

    @property
    def CX(self):
        return self.W / 2

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
        self.auto_w = self.fit_width(pids)          # fixed for the whole match
        self.ships = {}
        for pid in pids:
            s = Ship(pid)
            s.in_round = True
            self.ships[pid] = s
        self.round = 0
        self.solo = len(pids) == 1
        self.running = True
        self.new_round(COUNTDOWN)

    def new_round(self, countdown):
        self.round += 1
        self.torps = []
        self.rocks = [Rock(self.W) for _ in range(self.settings["asteroids"])]
        self.rock_due = []
        self.round_msg = ""
        self.round_winner = None
        players = [s for s in self.ships.values() if s.in_round and not s.out]
        n = max(1, len(players))
        base = random.uniform(0, math.tau)
        for i, s in enumerate(players):
            ang = base + math.tau * i / n
            s.x = self.CX + math.cos(ang) * SPAWN_R
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
        s.hyper_until = 0.0
        self.booms.append([s.x, s.y, now, kind])
        if self.solo and not s.out:
            s.deaths += 1
            s.respawn_at = now + TRAIN_RESPAWN

    def destroy_rock(self, rock, now, by=None):
        if rock not in self.rocks:
            return
        self.rocks.remove(rock)
        self.booms.append([rock.x, rock.y, now, "rock"])
        self.rock_due.append(now + ROCK_RESPAWN)
        if by is not None and self.solo:
            s = self.ships.get(by)
            if s:
                s.points += 1

    def gravity(self, x, y):
        g = self.g
        if not g:
            return 0.0, 0.0
        dx, dy = self.CX - x, CY - y
        r2 = max(dx * dx + dy * dy, SOFTEN * SOFTEN)
        r = math.sqrt(r2)
        acc = g / r2
        return acc * dx / r, acc * dy / r

    def edges(self, o, radius):
        if self.settings["edges"] == "wrap":
            o.x %= self.W
            o.y %= H
            return
        if o.x < radius:
            o.x, o.vx = radius, abs(o.vx) * 0.8
        elif o.x > self.W - radius:
            o.x, o.vx = self.W - radius, -abs(o.vx) * 0.8
        if o.y < radius:
            o.y, o.vy = radius, abs(o.vy) * 0.8
        elif o.y > H - radius:
            o.y, o.vy = H - radius, -abs(o.vy) * 0.8

    def random_spot(self):
        for _ in range(50):
            x, y = random.uniform(60, self.W - 60), random.uniform(60, H - 60)
            if math.hypot(x - self.CX, y - CY) > 180 and \
                    all(math.hypot(x - r.x, y - r.y) > r.r + 80 for r in self.rocks):
                return x, y
        return 100.0, 100.0

    def step_rocks(self, now, dt, star):
        while self.rock_due and now >= self.rock_due[0] and \
                len(self.rocks) < self.settings["asteroids"]:
            self.rock_due.pop(0)
            self.rocks.append(Rock(self.W))
        for rock in list(self.rocks):
            gx, gy = self.gravity(rock.x, rock.y)
            rock.vx += gx * ROCK_GRAVITY * dt
            rock.vy += gy * ROCK_GRAVITY * dt
            speed = math.hypot(rock.vx, rock.vy)
            if speed > MAX_SPEED * 0.6:
                rock.vx *= MAX_SPEED * 0.6 / speed
                rock.vy *= MAX_SPEED * 0.6 / speed
            rock.x += rock.vx * dt
            rock.y += rock.vy * dt
            rock.rot += rock.spin * dt
            # asteroids always bounce off the borders
            if rock.x < rock.r:
                rock.x, rock.vx = rock.r, abs(rock.vx)
            elif rock.x > self.W - rock.r:
                rock.x, rock.vx = self.W - rock.r, -abs(rock.vx)
            if rock.y < rock.r:
                rock.y, rock.vy = rock.r, abs(rock.vy)
            elif rock.y > H - rock.r:
                rock.y, rock.vy = H - rock.r, -abs(rock.vy)
            if star and math.hypot(rock.x - self.CX, rock.y - CY) < STAR_R + rock.r * 0.7:
                self.destroy_rock(rock, now)

    def step(self, now):
        dt = DT
        star = self.g != 0
        playing = self.phase == "playing"

        if self.solo:
            for s in self.ships.values():
                if not s.alive and not s.out and s.respawn_at and now >= s.respawn_at:
                    s.x, s.y = self.random_spot()
                    s.vx = s.vy = 0.0
                    s.a = math.atan2(CY - s.y, self.CX - s.x) + math.pi / 2
                    s.alive, s.respawn_at, s.keys = True, 0.0, set()

        self.step_rocks(now, dt, star)

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
                    s.keys.discard("reverse")
                    continue

            if "left" in s.keys:
                s.a -= ROT_SPEED * dt
            if "right" in s.keys:
                s.a += ROT_SPEED * dt
            if "reverse" in s.keys:
                s.vx -= math.cos(s.a) * REVERSE * dt
                s.vy -= math.sin(s.a) * REVERSE * dt
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

            if star and math.hypot(s.x - self.CX, s.y - CY) < STAR_R + SHIP_R * 0.6:
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
            if star and math.hypot(t.x - self.CX, t.y - CY) < STAR_R:
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

        # torpedoes against asteroids
        for t in list(self.torps):
            for rock in self.rocks:
                if math.hypot(t.x - rock.x, t.y - rock.y) < rock.r:
                    self.destroy_rock(rock, now, by=t.owner)
                    self.torps.remove(t)
                    break

        # asteroids against ships: both are wrecked
        for s in flying:
            if not s.alive:
                continue
            for rock in self.rocks:
                if math.hypot(s.x - rock.x, s.y - rock.y) < rock.r + SHIP_R * 0.7:
                    self.explode(s, now)
                    self.destroy_rock(rock, now)
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
        if self.solo:
            # training goes on until the player exits (or leaves)
            if not [s for s in self.ships.values() if not s.out]:
                self.finish()
            return
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
            self.round_msg = f"Round {self.round}: no survivors"
            if not players:
                self.finish()
                return
        self.phase = "roundover"
        self.phase_end = now + ROUND_PAUSE

    def finish(self):
        ships = sorted(self.ships.values(), key=lambda s: -s.points)
        target = self.settings["target"]
        winner = None
        if self.solo:
            s = ships[0] if ships else None
            rocks = f"{s.points} asteroid{'s' if s.points != 1 else ''} destroyed, " if s and self.settings["asteroids"] else ""
            crashes = f"{s.deaths} crash{'es' if s.deaths != 1 else ''}" if s else ""
            title = f"Training over – {rocks}{crashes}"
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
            "w": self.W, "h": H,
            "star": self.g != 0,
            "gravity": self.settings["gravity"],
            "round": self.round,
            "target": self.settings["target"],
            "countdown": countdown,
            "round_msg": self.round_msg,
            "round_winner": self.round_winner,
            "solo": self.solo,
            "rocks_on": self.settings["asteroids"] > 0,
            # the numbers behind the physics, for the browser's data pad
            "phys": {"gm": self.g, "thrust": THRUST, "reverse": REVERSE, "soften": SOFTEN, "vmax": MAX_SPEED, "dt": round(DT, 5),
                     "star_r": STAR_R, "ship_r": SHIP_R, "edges": self.settings["edges"]},
            "rocks": [[r(k.x), r(k.y), r(k.r), k.seed, round(k.rot, 2)] for k in self.rocks],
            "ships": [{
                "id": s.id, "x": r(s.x), "y": r(s.y), "a": round(s.a, 3), "vx": r(s.vx), "vy": r(s.vy),
                "alive": s.alive, "out": s.out, "points": s.points, "deaths": s.deaths,
                "respawn": round(max(0.0, s.respawn_at - now), 1) if s.respawn_at else None,
                "thrust": s.alive and "thrust" in s.keys and not s.hyper_until,
                "reverse": s.alive and "reverse" in s.keys and not s.hyper_until,
                "hyper": bool(s.hyper_until),
            } for s in self.ships.values()],
            "torps": [[r(t.x), r(t.y), t.owner] for t in self.torps],
            "booms": [[r(b[0]), r(b[1]), round(now - b[2], 2), b[3]] for b in self.booms],
        }
