"""
Battlezone for the game room platform - after Atari's 1980 vector classic.

The server simulates a flat battlefield seen from above; each browser draws
the first-person wireframe view from its own tank. Cubes and pyramids block
tanks and shells. Each tank has two tracks: both forward = drive, both back =
reverse, one each way = pivot. Only one of your shells can be in flight.

One player: the classic game against computer enemies - one combat enemy at
a time (tank, later super tanks and zig-zagging missiles), plus the odd
flying saucer worth bonus points. Three or five tanks, extra tanks at 15,000
and 100,000 points.

Two to four players: everyone against everyone, no computer enemies. Respawn
after a few seconds; first to the target number of kills wins.

Same interface as games/snake.py. Inputs: {"key": <name>, "down": bool} with
key one of fwd, back, left, right (simple driving), lf, lb, rf, rb (left /
right track forward / back, the original twin-stick layout) and fire.
"""

import math
import random
import time

DT = 1 / 30
SIZES = {"compact": 3000.0, "standard": 4500.0, "wide": 6000.0}
TANK_R = 30.0
SPEED = 170.0                  # forward, units/s
REVERSE = 0.7                  # reverse is slower
TURN = 1.35                    # rad/s pivoting on the spot
SHELL_SPEED = 720.0
SHELL_LIFE = 2.4
FIRE_COOLDOWN = 0.6
RESPAWN_SOLO = 2.5
RESPAWN_PVP = 3.0
INVULNERABLE = 2.0
COUNTDOWN = 3.0
BOOM_LIFE = 1.6
EXTRA_TANKS = (15000, 100000)
OBSTACLE_R = {0: 40.0, 1: 38.0, 2: 30.0}          # cube, pyramid, short block
RADAR_RANGE = 3000.0

# enemy kinds: speed, turn, reload, aim tolerance, points, hit radius
ENEMIES = {
    "tank": (95.0, 0.9, 3.4, 0.06, 1000, 34.0),
    "super": (165.0, 1.7, 2.2, 0.04, 3000, 34.0),
    "missile": (390.0, 3.0, 0, 0, 2000, 26.0),
}
SAUCER_POINTS = 5000
SAUCER_EVERY = (35.0, 70.0)
SAUCER_LIFE = 18.0

KEYS = ("fwd", "back", "left", "right", "lf", "lb", "rf", "rb", "fire")


def norm(a):
    return (a + math.pi) % math.tau - math.pi


class Tank:
    def __init__(self, pid):
        self.id = pid
        self.x = self.y = 0.0
        self.a = 0.0               # heading: forward = (cos a, sin a); +a turns right
        self.alive = False
        self.out = False
        self.keys = set()
        self.fire_cd = 0.0
        self.blocked = False
        self.inv_until = 0.0
        self.respawn_at = 0.0
        self.lives = 3
        self.score = 0             # solo points
        self.kills = 0             # versus mode
        self.deaths = 0
        self.extra = list(EXTRA_TANKS)
        self.killed_by = None


class Enemy:
    def __init__(self, kind, x, y, a):
        self.kind = kind
        self.x, self.y, self.a = x, y, a
        self.reload = 1.5
        self.wander = 0.0          # heading offset while wandering
        self.wander_until = 0.0
        self.born = time.monotonic()


class Shell:
    __slots__ = ("x", "y", "vx", "vy", "born", "owner")

    def __init__(self, x, y, vx, vy, born, owner):
        self.x, self.y, self.vx, self.vy, self.born, self.owner = x, y, vx, vy, born, owner


class BattlezoneGame:
    id = "battlezone"
    name = "Battlezone"
    max_players = 4
    SETTINGS = [
        {"key": "arena", "label": "Arena", "default": "standard",
         "options": [["compact", "Compact"], ["standard", "Standard"], ["wide", "Wide"]],
         "hints": {"compact": "Close quarters, fewer obstacles.",
                   "standard": "A good size for 1–3 tanks.",
                   "wide": "Lots of room to hide and flank."}},
        {"key": "lives", "label": "Tanks (one player)", "default": 3,
         "options": [[3, "3"], [5, "5"]],
         "hints": {3: "Alone you fight computer tanks. Extra tanks at 15,000 and 100,000 points.",
                   5: "Alone you fight computer tanks. Extra tanks at 15,000 and 100,000 points."}},
        {"key": "missiles", "label": "Missiles from (one player)", "default": 10000,
         "options": [[5000, "5,000"], [10000, "10,000"], [20000, "20,000"], [30000, "30,000"]],
         "hints": {5000: "Guided missiles start attacking once you reach this score.",
                   10000: "Guided missiles start attacking once you reach this score.",
                   20000: "Guided missiles start attacking once you reach this score.",
                   30000: "Guided missiles start attacking once you reach this score."}},
        {"key": "target", "label": "Match (2+ players)", "default": 5,
         "options": [[5, "First to 5"], [10, "First to 10"], [15, "First to 15"]],
         "hints": {5: "With friends it's everyone against everyone – no computer enemies.",
                   10: "With friends it's everyone against everyone – no computer enemies.",
                   15: "With friends it's everyone against everyone – no computer enemies."}},
    ]

    def __init__(self, room):
        self.room = room
        self.settings = {s["key"]: s["default"] for s in self.SETTINGS}
        self.running = False
        self.results = None
        self.phase = "idle"        # idle | countdown | playing | over
        self.phase_end = 0.0
        self.size = SIZES[self.settings["arena"]]
        self.obstacles = []        # [x, y, type, r]
        self.tanks = {}
        self.enemy = None
        self.enemy_due = 0.0
        self.saucer = None         # {x, y, vx, vy, until, a}
        self.next_saucer = 0.0
        self.shells = []
        self.booms = []            # [x, y, time, kind]
        self.solo = False
        self.started = 0.0

    # ------------------------------------------------ settings
    def set_setting(self, key, value):
        for s in self.SETTINGS:
            if s["key"] == key and value in [o[0] for o in s["options"]]:
                self.settings[key] = value
                return True
        return False

    def tick(self):
        return DT if self.running else 0.05

    def name_of(self, pid):
        p = self.room.players.get(pid)
        return p.name if p else "?"

    # ------------------------------------------------ world
    def make_obstacles(self):
        S = self.size
        count = int(S * S / 330000)
        obs = []
        tries = 0
        while len(obs) < count and tries < count * 30:
            tries += 1
            kind = random.choice((0, 0, 1, 1, 2))
            x, y = random.uniform(120, S - 120), random.uniform(120, S - 120)
            r = OBSTACLE_R[kind]
            if all(math.hypot(x - o[0], y - o[1]) > r + o[3] + 160 for o in obs):
                obs.append([x, y, kind, r])
        self.obstacles = obs

    def free(self, x, y, r, ignore=None):
        S = self.size
        if not (r <= x <= S - r and r <= y <= S - r):
            return False
        for o in self.obstacles:
            if math.hypot(x - o[0], y - o[1]) < r + o[3]:
                return False
        for t in self.tanks.values():
            if t is not ignore and t.alive and math.hypot(x - t.x, y - t.y) < r + TANK_R:
                return False
        e = self.enemy
        if e and e is not ignore and e.kind != "missile" and math.hypot(x - e.x, y - e.y) < r + TANK_R:
            return False
        return True

    def safe_spot(self, away_from=(), min_dist=900.0):
        S = self.size
        best, best_d = None, -1.0
        for _ in range(60):
            x, y = random.uniform(200, S - 200), random.uniform(200, S - 200)
            if not self.free(x, y, TANK_R + 20):
                continue
            d = min((math.hypot(x - ax, y - ay) for ax, ay in away_from), default=1e9)
            if d >= min_dist:
                return x, y
            if d > best_d:
                best, best_d = (x, y), d
        return best or (S / 2, S / 2)

    def clear_line(self, x1, y1, x2, y2):
        dx, dy = x2 - x1, y2 - y1
        L2 = dx * dx + dy * dy or 1.0
        for o in self.obstacles:
            t = max(0.0, min(1.0, ((o[0] - x1) * dx + (o[1] - y1) * dy) / L2))
            if math.hypot(x1 + dx * t - o[0], y1 + dy * t - o[1]) < o[3]:
                return False
        return True

    # ------------------------------------------------ match flow
    def start(self, pids):
        self.results = None
        self.size = SIZES[self.settings["arena"]]
        self.make_obstacles()
        self.solo = len(pids) == 1
        self.tanks = {}
        self.shells = []
        self.booms = []
        self.enemy = None
        self.saucer = None
        placed = []
        for pid in pids:
            t = Tank(pid)
            t.lives = self.settings["lives"]
            t.x, t.y = self.safe_spot(placed, 1200)
            placed.append((t.x, t.y))
            t.a = math.atan2(self.size / 2 - t.y, self.size / 2 - t.x)   # facing the middle
            t.alive = True
            self.tanks[pid] = t
        now = time.monotonic()
        self.phase = "countdown"
        self.phase_end = now + COUNTDOWN
        self.enemy_due = self.phase_end + 2.0
        self.next_saucer = self.phase_end + random.uniform(*SAUCER_EVERY)
        self.started = now
        self.running = True

    def update(self, now):
        if not self.running:
            return False
        self.booms = [b for b in self.booms if now - b[2] < BOOM_LIFE]
        if self.phase == "countdown":
            if now >= self.phase_end:
                self.phase = "playing"
                for t in self.tanks.values():
                    t.inv_until = now + INVULNERABLE
        elif self.phase == "playing":
            self.step(now)
        return True

    # ------------------------------------------------ input
    def input(self, pid, data):
        t = self.tanks.get(pid)
        key = data.get("key")
        if not t or t.out or key not in KEYS:
            return
        if data.get("down"):
            t.keys.add(key)
        else:
            t.keys.discard(key)

    def quit(self, pid):
        t = self.tanks.get(pid)
        if not t:
            return
        t.out = True
        t.alive = False
        self.check_end()

    def remove(self, pid):
        self.tanks.pop(pid, None)
        self.check_end()

    def can_drop_in(self):
        return self.running and not self.solo

    def drop_in(self, pid):
        t = Tank(pid)
        t.respawn_at = time.monotonic() + 0.5
        self.tanks[pid] = t

    # ------------------------------------------------ tanks
    def tracks(self, t):
        if t.keys & {"lf", "lb", "rf", "rb"}:
            L = ("lf" in t.keys) - ("lb" in t.keys)
            R = ("rf" in t.keys) - ("rb" in t.keys)
        else:
            base = ("fwd" in t.keys) - ("back" in t.keys)
            turn = ("right" in t.keys) - ("left" in t.keys)
            L = max(-1, min(1, base + turn))
            R = max(-1, min(1, base - turn))
            if base and turn:                       # driving while steering: one track forward
                L, R = (1, 0) if (turn > 0) == (base > 0) else (0, 1)
                if base < 0:
                    L, R = -R, -L
        return L, R

    def drive(self, t, dt):
        L, R = self.tracks(t)
        fwd = (L + R) / 2          # both tracks forward = drive
        turn = (L - R) / 2         # left track faster than right = turn right
        t.a = norm(t.a + turn * TURN * dt)
        if fwd:
            v = SPEED * fwd * (REVERSE if fwd < 0 else 1)
            nx, ny = t.x + math.cos(t.a) * v * dt, t.y + math.sin(t.a) * v * dt
            if self.free(nx, ny, TANK_R, ignore=t):
                t.x, t.y = nx, ny
                t.blocked = False
            else:
                t.blocked = True
        else:
            t.blocked = False

    def fire(self, owner_id, x, y, a, now):
        nx, ny = math.cos(a), math.sin(a)
        self.shells.append(Shell(x + nx * (TANK_R + 6), y + ny * (TANK_R + 6),
                                 nx * SHELL_SPEED, ny * SHELL_SPEED, now, owner_id))

    def kill_tank(self, t, now, by=None):
        if not t.alive or now < t.inv_until:
            return False
        t.alive = False
        t.keys = set()
        t.deaths += 1
        t.killed_by = by
        self.booms.append([t.x, t.y, now, "tank"])
        if self.solo:
            t.lives -= 1
            if t.lives > 0:
                t.respawn_at = now + RESPAWN_SOLO
            # the battlefield resets around you: enemy shells vanish, the enemy backs off
            self.shells = [s for s in self.shells if s.owner != -1]
            self.enemy = None
            self.enemy_due = now + RESPAWN_SOLO + 2.0
        else:
            t.respawn_at = now + RESPAWN_PVP
            killer = self.tanks.get(by)
            if killer and killer is not t:
                killer.kills += 1
        return True

    def add_score(self, t, pts):
        t.score += pts
        while t.extra and t.score >= t.extra[0]:
            t.extra.pop(0)
            t.lives += 1

    # ------------------------------------------------ enemies (one player)
    def spawn_enemy(self, now):
        p = next((t for t in self.tanks.values() if t.alive), None)
        if not p:
            return
        score = p.score
        kind = "tank"
        if score >= self.settings["missiles"] and random.random() < 0.3:
            kind = "missile"
        elif score >= 10000 and random.random() < min(0.75, 0.35 + score / 100000):
            kind = "super"
        for _ in range(40):
            ang = random.uniform(0, math.tau)
            d = random.uniform(1500, 2300) if kind != "missile" else 2100
            x = min(max(p.x + math.cos(ang) * d, 150), self.size - 150)
            y = min(max(p.y + math.sin(ang) * d, 150), self.size - 150)
            if kind == "missile" or self.free(x, y, TANK_R + 10):
                break
        self.enemy = Enemy(kind, x, y, math.atan2(p.y - y, p.x - x))

    def step_enemy(self, now, dt):
        e = self.enemy
        p = next((t for t in self.tanks.values() if t.alive), None)
        if not e or not p:
            return
        speed, turn, reload, tol, _, _ = ENEMIES[e.kind]
        # later on everything gets a bit nastier
        ramp = 1 + min(0.5, p.score / 80000)
        dx, dy = p.x - e.x, p.y - e.y
        dist = math.hypot(dx, dy)
        to_p = math.atan2(dy, dx)

        if e.kind == "missile":
            weave = math.sin((now - e.born) * 5.5) * 0.7 * min(1.0, dist / 900)
            e.a = to_p + weave
            e.x += math.cos(e.a) * speed * ramp * dt
            e.y += math.sin(e.a) * speed * ramp * dt
            if dist < TANK_R + 18 and now >= p.inv_until:
                self.booms.append([e.x, e.y, now, "missile"])
                self.enemy = None
                self.enemy_due = now + 3.0
                self.kill_tank(p, now, by=-1)
            return

        e.reload = max(0.0, e.reload - dt)
        clear = self.clear_line(e.x, e.y, p.x, p.y)
        flanking = False
        if not clear:
            # no line of fire: swing round the obstacle to find one
            if now >= e.wander_until:
                e.wander = random.choice((-1, 1)) * random.uniform(0.9, 1.4)
                e.wander_until = now + random.uniform(1.2, 2.2)
            flanking = True
        elif now >= e.wander_until and random.random() < dt / 4.0:
            e.wander = random.choice((-1, 1)) * random.uniform(0.5, 1.1)
            e.wander_until = now + random.uniform(1.0, 2.2)
        aimed = clear and abs(norm(to_p - e.a)) < 0.5 and e.reload < 0.8 and dist < 2200
        target = to_p + (0 if aimed or now >= e.wander_until else e.wander)
        diff = norm(target - e.a)
        e.a = norm(e.a + max(-turn * ramp * dt, min(turn * ramp * dt, diff)))
        move = 0.0
        if flanking:
            move = 1.0 if abs(diff) < 1.0 else 0.0
        elif abs(diff) < 0.7:
            move = 1.0 if dist > 650 else (-0.6 if dist < 380 else 0.0)
        if move:
            nx = e.x + math.cos(e.a) * speed * ramp * move * dt
            ny = e.y + math.sin(e.a) * speed * ramp * move * dt
            if self.free(nx, ny, TANK_R, ignore=e):
                e.x, e.y = nx, ny
            else:
                e.wander = random.choice((-1, 1)) * 1.3      # steer round the obstacle
                e.wander_until = now + 1.2
        own = any(s.owner == -1 for s in self.shells)
        if not own and e.reload <= 0 and dist < 2400 and abs(norm(to_p - e.a)) < tol * 3 and clear:
            # aim with a little error so it can be dodged
            err = random.uniform(-tol, tol)
            self.fire(-1, e.x, e.y, e.a + err * 0.5, now)
            e.reload = reload / ramp

    def step_saucer(self, now, dt):
        p = next((t for t in self.tanks.values() if t.alive), None)
        if not self.saucer:
            if now >= self.next_saucer and p:
                ang = random.uniform(0, math.tau)
                d = random.uniform(700, 1400)
                x = min(max(p.x + math.cos(ang) * d, 100), self.size - 100)
                y = min(max(p.y + math.sin(ang) * d, 100), self.size - 100)
                va = random.uniform(0, math.tau)
                self.saucer = {"x": x, "y": y, "vx": math.cos(va) * 70, "vy": math.sin(va) * 70,
                               "until": now + SAUCER_LIFE, "a": 0.0}
            return
        s = self.saucer
        if random.random() < dt / 2.5:
            va = random.uniform(0, math.tau)
            s["vx"], s["vy"] = math.cos(va) * 70, math.sin(va) * 70
        s["x"] = min(max(s["x"] + s["vx"] * dt, 60), self.size - 60)
        s["y"] = min(max(s["y"] + s["vy"] * dt, 60), self.size - 60)
        s["a"] += 2.0 * dt
        if now >= s["until"]:
            self.saucer = None
            self.next_saucer = now + random.uniform(*SAUCER_EVERY)

    # ------------------------------------------------ physics
    def step(self, now):
        dt = DT
        for t in self.tanks.values():
            if not t.alive and not t.out and t.respawn_at and now >= t.respawn_at and (t.lives > 0 or not self.solo):
                others = [(o.x, o.y) for o in self.tanks.values() if o.alive and o is not t]
                t.x, t.y = self.safe_spot(others, 1000)
                t.a = math.atan2(self.size / 2 - t.y, self.size / 2 - t.x)
                t.alive, t.respawn_at, t.keys = True, 0.0, set()
                t.inv_until = now + INVULNERABLE
            if not t.alive:
                continue
            t.fire_cd = max(0.0, t.fire_cd - dt)
            self.drive(t, dt)
            if "fire" in t.keys and t.fire_cd <= 0 and not any(s.owner == t.id for s in self.shells):
                self.fire(t.id, t.x, t.y, t.a, now)
                t.fire_cd = FIRE_COOLDOWN

        if self.solo:
            if not self.enemy and now >= self.enemy_due:
                self.spawn_enemy(now)
            self.step_enemy(now, dt)
            self.step_saucer(now, dt)

        # shells
        S = self.size
        keep = []
        for s in self.shells:
            s.x += s.vx * dt
            s.y += s.vy * dt
            if now - s.born > SHELL_LIFE or not (0 <= s.x <= S and 0 <= s.y <= S):
                continue
            if any(math.hypot(s.x - o[0], s.y - o[1]) < o[3] for o in self.obstacles):
                self.booms.append([s.x, s.y, now, "shell"])
                continue
            hit = False
            for t in self.tanks.values():
                if t.alive and t.id != s.owner and math.hypot(s.x - t.x, s.y - t.y) < TANK_R:
                    if self.kill_tank(t, now, by=s.owner):
                        hit = True
                        break
                    hit = True                      # invulnerable: the shell still stops
                    break
            e = self.enemy
            if not hit and e and s.owner != -1 and math.hypot(s.x - e.x, s.y - e.y) < ENEMIES[e.kind][5]:
                shooter = self.tanks.get(s.owner)
                if shooter:
                    self.add_score(shooter, ENEMIES[e.kind][4])
                self.booms.append([e.x, e.y, now, e.kind])
                self.enemy = None
                self.enemy_due = now + random.uniform(1.5, 3.0)
                hit = True
            sc = self.saucer
            if not hit and sc and s.owner != -1 and math.hypot(s.x - sc["x"], s.y - sc["y"]) < 42:
                shooter = self.tanks.get(s.owner)
                if shooter:
                    self.add_score(shooter, SAUCER_POINTS)
                self.booms.append([sc["x"], sc["y"], now, "saucer"])
                self.saucer = None
                self.next_saucer = now + random.uniform(*SAUCER_EVERY)
                hit = True
            if not hit:
                keep.append(s)
        self.shells = keep
        self.check_end()

    # ------------------------------------------------ end of match
    def check_end(self):
        if not self.running or self.phase == "over":
            return
        active = [t for t in self.tanks.values() if not t.out]
        if self.solo:
            if not [t for t in active if t.alive or t.lives > 0]:
                self.finish()
        else:
            target = self.settings["target"]
            if not active or any(t.kills >= target for t in self.tanks.values()):
                self.finish()

    def finish(self):
        tanks = list(self.tanks.values())
        winner = None
        pts = lambda n: f"{n:,}".replace(",", ".")
        if self.solo:
            t = tanks[0] if tanks else None
            title = f"Game over – {pts(t.score)} points" if t else "Game over"
            ranking = [{"id": t.id, "score": t.score}] if t else []
        else:
            tanks.sort(key=lambda t: (-t.kills, t.deaths))
            top = tanks[0].kills if tanks else 0
            leaders = [t for t in tanks if t.kills == top]
            if len(leaders) == 1 and top > 0:
                winner = leaders[0]
                title = f"{self.name_of(winner.id)} wins with {top} kill{'s' if top != 1 else ''}"
            else:
                title = "Battle over – no winner"
            ranking = [{"id": t.id, "score": t.kills} for t in tanks]
        self.results = {"title": title, "winner": winner.id if winner else None, "ranking": ranking}
        self.phase = "over"
        self.running = False

    # ------------------------------------------------ state for browsers
    def snapshot(self):
        now = time.monotonic()
        r1 = lambda v: round(v, 1)
        countdown = max(1, int(self.phase_end - now + 0.999)) if self.phase == "countdown" else 0
        e, sc = self.enemy, self.saucer
        return {
            "phase": self.phase,
            "solo": self.solo,
            "size": self.size,
            "target": self.settings["target"],
            "countdown": countdown,
            "time": int(now - self.started) if self.running else 0,
            "obstacles": [[r1(o[0]), r1(o[1]), o[2]] for o in self.obstacles],
            "tanks": [{
                "id": t.id, "x": r1(t.x), "y": r1(t.y), "a": round(t.a, 3), "alive": t.alive, "out": t.out,
                "lives": t.lives, "score": t.score, "kills": t.kills, "deaths": t.deaths,
                "blocked": t.blocked, "inv": t.alive and now < t.inv_until,
                "moving": bool(t.keys - {"fire"}),
                "respawn": round(max(0.0, t.respawn_at - now), 1) if t.respawn_at and not t.alive else None,
                "killed_by": t.killed_by,
            } for t in self.tanks.values()],
            "enemy": {"k": e.kind, "x": r1(e.x), "y": r1(e.y), "a": round(e.a, 3)} if e else None,
            "saucer": {"x": r1(sc["x"]), "y": r1(sc["y"]), "a": round(sc["a"], 2)} if sc else None,
            "shells": [[r1(s.x), r1(s.y), s.owner, round(math.atan2(s.vy, s.vx), 2)] for s in self.shells],
            "booms": [[r1(b[0]), r1(b[1]), round(now - b[2], 2), b[3]] for b in self.booms],
        }
