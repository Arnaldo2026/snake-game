"""
Asteroids for the game room platform - after Atari's 1979 classic, extended
to 1-4 players flying together in the same field.

Each player has a ship with its own score and lives. Rocks split from large
to medium to small when shot; clear the field and a bigger wave arrives.
Saucers (optional) cross the screen and shoot. Edges wrap around, ships keep
their momentum, hyperspace is an emergency escape. With friendly fire on,
shots and collisions between ships count too. The match ends when every
ship is out of lives; the highest score wins.

Same interface as games/snake.py. Inputs: {"key": <name>, "down": bool}
with key one of left, right, thrust, fire, hyper (held-button controls).
"""

import math
import random
import time

W = 1000.0
DT = 1 / 30
SHIP_R = 13
ROT_SPEED = 4.0                # rad/s
THRUST = 300.0
DRAG = 0.45                    # share of speed lost per second when coasting
MAX_SPEED = 430.0
BULLET_SPEED = 540.0
BULLET_LIFE = 1.0
BULLET_MAX = 4
FIRE_COOLDOWN = 0.2
HYPER_COOLDOWN = 2.5
HYPER_TIME = 0.8
HYPER_RISK = 1 / 8
RESPAWN = 2.0
INVULNERABLE = 2.5             # after (re)spawning
COUNTDOWN = 3.0
WAVE_PAUSE = 2.5
EXTRA_LIFE_EVERY = 10000
ROCK_CAP = 40                  # never more rocks than this, to keep things light
BOOM_LIFE = 1.0

# size: radius, points, speed range
ROCK_SIZES = {3: (44, 20, (35, 65)), 2: (24, 50, (65, 105)), 1: (12, 100, (105, 155))}
DIFFICULTY = {"easy": (3, 0.8), "normal": (4, 1.0), "hard": (6, 1.25)}   # first wave rocks, speed factor

UFO_EVERY = (18.0, 30.0)       # seconds between saucers
UFO_SPEED = 120.0
UFO_FIRE = 1.3
UFO_BIG = (20, 200)            # radius, points
UFO_SMALL = (12, 1000)

KEYS = ("left", "right", "thrust", "fire", "hyper")


class Ship:
    def __init__(self, pid):
        self.id = pid
        self.x = self.y = W / 2
        self.vx = self.vy = 0.0
        self.a = -math.pi / 2
        self.alive = False
        self.out = False           # quit the match
        self.keys = set()
        self.hyper_req = False
        self.fire_cd = 0.0
        self.hyper_cd = 0.0
        self.hyper_until = 0.0
        self.inv_until = 0.0
        self.respawn_at = 0.0
        self.lives = 3
        self.score = 0
        self.next_life = EXTRA_LIFE_EVERY


class Rock:
    __slots__ = ("x", "y", "vx", "vy", "size", "r", "seed", "rot", "spin")

    def __init__(self, x, y, size, speed_k):
        self.x, self.y, self.size = x, y, size
        r, _, (lo, hi) = ROCK_SIZES[size]
        self.r = r
        ang = random.uniform(0, math.tau)
        sp = random.uniform(lo, hi) * speed_k
        self.vx, self.vy = math.cos(ang) * sp, math.sin(ang) * sp
        self.seed = random.randrange(1, 100000)
        self.rot = random.uniform(0, math.tau)
        self.spin = random.uniform(-1.0, 1.0)


class Bullet:
    __slots__ = ("x", "y", "vx", "vy", "born", "owner")

    def __init__(self, x, y, vx, vy, born, owner):
        self.x, self.y, self.vx, self.vy, self.born, self.owner = x, y, vx, vy, born, owner


class Ufo:
    def __init__(self, small, now):
        self.small = small
        self.r, self.points = UFO_SMALL if small else UFO_BIG
        self.dir = random.choice((-1, 1))
        self.x = -self.r if self.dir > 0 else W + self.r
        self.y = random.uniform(120, W - 120)
        self.vy = 0.0
        self.turn_at = now + random.uniform(1.0, 2.5)
        self.fire_at = now + 1.0


class AsteroidsGame:
    id = "asteroids"
    name = "Asteroids"
    max_players = 4
    SETTINGS = [
        {"key": "difficulty", "label": "Difficulty", "default": "normal",
         "options": [["easy", "Easy"], ["normal", "Normal"], ["hard", "Hard"]],
         "hints": {"easy": "Fewer, slower rocks to start with.",
                   "normal": "The classic: four big rocks in the first wave.",
                   "hard": "Six fast rocks from the first wave."}},
        {"key": "lives", "label": "Lives", "default": 3,
         "options": [[3, "3"], [5, "5"]],
         "hints": {3: "Extra ship every 10,000 points.", 5: "Extra ship every 10,000 points."}},
        {"key": "ufos", "label": "Saucers", "default": "on",
         "options": [["on", "On"], ["off", "Off"]],
         "hints": {"on": "Big saucers shoot at random; from wave 3 the small ones aim at you."}},
        {"key": "friendly", "label": "Friendly fire", "default": "off",
         "options": [["off", "Off"], ["on", "On"]],
         "hints": {"off": "Everyone against the rocks – your shots pass through other ships.",
                   "on": "Shots and crashes between ships count. Watch where you aim."}},
    ]

    def __init__(self, room):
        self.room = room
        self.settings = {s["key"]: s["default"] for s in self.SETTINGS}
        self.running = False
        self.results = None
        self.phase = "idle"        # idle | countdown | playing | over
        self.phase_end = 0.0
        self.ships = {}
        self.rocks = []
        self.bullets = []
        self.booms = []            # [x, y, time, kind]
        self.ufo = None
        self.next_ufo = 0.0
        self.wave = 0
        self.wave_at = 0.0         # when the next wave arrives (0 = wave in progress)
        self.events = []           # short-lived sound cues: [kind, pid, time]

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

    # ------------------------------------------------ match flow
    def start(self, pids):
        self.results = None
        self.ships = {}
        self.bullets = []
        self.booms = []
        self.events = []
        self.ufo = None
        n = len(pids)
        for i, pid in enumerate(pids):
            s = Ship(pid)
            s.lives = self.settings["lives"]
            self.place_start(s, i, n)
            s.alive = True
            self.ships[pid] = s
        self.wave = 0
        self.next_wave()
        self.wave_at = 0.0
        self.phase = "countdown"
        self.phase_end = time.monotonic() + COUNTDOWN
        self.running = True

    def place_start(self, s, i, n):
        # side by side across the middle, all pointing up
        s.x = W / 2 + (i - (n - 1) / 2) * 90
        s.y = W / 2
        s.vx = s.vy = 0.0
        s.a = -math.pi / 2

    def next_wave(self):
        self.wave += 1
        first, speed_k = DIFFICULTY[self.settings["difficulty"]]
        count = min(first + self.wave - 1, 11)
        speed_k *= 1 + 0.06 * (self.wave - 1)
        self.rocks = []
        for _ in range(count):
            # enter along the borders, away from the ships
            for _try in range(30):
                if random.random() < 0.5:
                    x, y = random.uniform(0, W), random.choice((0.0, W - 1))
                else:
                    x, y = random.choice((0.0, W - 1)), random.uniform(0, W)
                if all(not s.alive or self.dist(x, y, s.x, s.y) > 220 for s in self.ships.values()):
                    break
            self.rocks.append(Rock(x, y, 3, speed_k))
        self.next_ufo = time.monotonic() + random.uniform(*UFO_EVERY)

    def update(self, now):
        if not self.running:
            return False
        self.booms = [b for b in self.booms if now - b[2] < BOOM_LIFE]
        self.events = [e for e in self.events if now - e[2] < 0.5]
        if self.phase == "countdown":
            if now >= self.phase_end:
                self.phase = "playing"
                for s in self.ships.values():
                    s.inv_until = now + INVULNERABLE
        elif self.phase == "playing":
            self.step(now)
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
        self.check_end()

    def remove(self, pid):
        self.ships.pop(pid, None)
        if self.running:
            self.check_end()

    def can_drop_in(self):
        return self.running

    def drop_in(self, pid):
        s = Ship(pid)
        s.lives = self.settings["lives"]
        s.respawn_at = time.monotonic() + 0.5
        self.ships[pid] = s

    # ------------------------------------------------ helpers
    @staticmethod
    def wrap(o):
        o.x %= W
        o.y %= W

    @staticmethod
    def dist(x1, y1, x2, y2):
        # shortest distance on a wrap-around screen
        dx = abs(x1 - x2)
        dy = abs(y1 - y2)
        dx = min(dx, W - dx)
        dy = min(dy, W - dy)
        return math.hypot(dx, dy)

    def safe_spot(self, x, y, radius=110):
        if self.ufo and self.dist(x, y, self.ufo.x, self.ufo.y) < radius:
            return False
        return all(self.dist(x, y, r.x, r.y) > r.r + radius for r in self.rocks)

    def add_score(self, pid, pts, now):
        s = self.ships.get(pid)
        if not s:
            return
        s.score += pts
        while s.score >= s.next_life:
            s.next_life += EXTRA_LIFE_EVERY
            s.lives += 1
            self.events.append(["life", pid, now])

    def kill_ship(self, s, now, kind="ship"):
        if not s.alive or now < s.inv_until:
            return False
        s.alive = False
        s.keys = set()
        s.hyper_until = 0.0
        self.booms.append([s.x, s.y, now, kind])
        s.lives -= 1
        if s.lives > 0 and not s.out:
            s.respawn_at = now + RESPAWN
        return True

    def break_rock(self, rock, now, by=None):
        if rock not in self.rocks:
            return
        self.rocks.remove(rock)
        _, pts, _ = ROCK_SIZES[rock.size]
        self.booms.append([rock.x, rock.y, now, f"rock{rock.size}"])
        if by:
            self.add_score(by, pts, now)
        if rock.size > 1:
            speed_k = DIFFICULTY[self.settings["difficulty"]][1] * (1 + 0.06 * (self.wave - 1))
            for _ in range(2):
                if len(self.rocks) < ROCK_CAP:
                    self.rocks.append(Rock(rock.x, rock.y, rock.size - 1, speed_k))

    def kill_ufo(self, now, by=None):
        u = self.ufo
        if not u:
            return
        self.booms.append([u.x, u.y, now, "ufo"])
        if by:
            self.add_score(by, u.points, now)
        self.ufo = None
        self.next_ufo = now + random.uniform(*UFO_EVERY)

    # ------------------------------------------------ physics
    def step(self, now):
        dt = DT
        friendly = self.settings["friendly"] == "on"

        # wave flow
        if not self.rocks and not self.wave_at:
            self.wave_at = now + WAVE_PAUSE
        if self.wave_at and now >= self.wave_at:
            self.wave_at = 0.0
            self.next_wave()

        # respawns (wait for a clear spot near the centre)
        for s in self.ships.values():
            if not s.alive and not s.out and s.lives > 0 and s.respawn_at and now >= s.respawn_at:
                spots = [(W / 2, W / 2)] + [(random.uniform(150, W - 150), random.uniform(150, W - 150))
                                            for _ in range(8)]
                for x, y in spots:
                    if self.safe_spot(x, y):
                        s.x, s.y, s.vx, s.vy, s.a = x, y, 0.0, 0.0, -math.pi / 2
                        s.alive, s.respawn_at, s.keys = True, 0.0, set()
                        s.inv_until = now + INVULNERABLE
                        break

        # ships
        for s in self.ships.values():
            if not s.alive:
                continue
            s.fire_cd = max(0.0, s.fire_cd - dt)
            s.hyper_cd = max(0.0, s.hyper_cd - dt)
            if s.hyper_until:
                if now < s.hyper_until:
                    continue
                s.hyper_until = 0.0
                s.x, s.y = random.uniform(60, W - 60), random.uniform(60, W - 60)
                s.vx = s.vy = 0.0
            if s.hyper_req:
                s.hyper_req = False
                if s.hyper_cd <= 0:
                    s.hyper_cd = HYPER_COOLDOWN
                    if random.random() < HYPER_RISK:
                        s.inv_until = 0.0
                        self.kill_ship(s, now, "hyper")
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
            else:
                k = max(0.0, 1 - DRAG * dt)
                s.vx *= k
                s.vy *= k
            sp = math.hypot(s.vx, s.vy)
            if sp > MAX_SPEED:
                s.vx *= MAX_SPEED / sp
                s.vy *= MAX_SPEED / sp
            s.x += s.vx * dt
            s.y += s.vy * dt
            self.wrap(s)
            if "fire" in s.keys and s.fire_cd <= 0:
                if sum(1 for b in self.bullets if b.owner == s.id) < BULLET_MAX:
                    nx, ny = math.cos(s.a), math.sin(s.a)
                    self.bullets.append(Bullet(s.x + nx * (SHIP_R + 3), s.y + ny * (SHIP_R + 3),
                                               s.vx + nx * BULLET_SPEED, s.vy + ny * BULLET_SPEED,
                                               now, s.id))
                    s.fire_cd = FIRE_COOLDOWN

        # rocks
        for r in self.rocks:
            r.x += r.vx * dt
            r.y += r.vy * dt
            r.rot += r.spin * dt
            self.wrap(r)

        # saucer
        if self.settings["ufos"] == "on":
            self.step_ufo(now, dt)

        # bullets
        self.bullets = [b for b in self.bullets if now - b.born <= BULLET_LIFE]
        for b in self.bullets:
            b.x += b.vx * dt
            b.y += b.vy * dt
            self.wrap(b)

        # bullet hits: rocks, saucer, ships
        for b in list(self.bullets):
            hit = False
            for r in self.rocks:
                if self.dist(b.x, b.y, r.x, r.y) < r.r:
                    self.break_rock(r, now, by=b.owner or None)
                    hit = True
                    break
            if not hit and self.ufo and b.owner and self.dist(b.x, b.y, self.ufo.x, self.ufo.y) < self.ufo.r:
                self.kill_ufo(now, by=b.owner)
                hit = True
            if not hit:
                for s in self.ships.values():
                    if not s.alive or s.hyper_until or s.id == b.owner:
                        continue
                    if b.owner and not friendly:
                        continue                   # players' shots pass through friends
                    if self.dist(b.x, b.y, s.x, s.y) < SHIP_R + 2:
                        if self.kill_ship(s, now):
                            hit = True
                        break
            if hit and b in self.bullets:
                self.bullets.remove(b)

        # ship collisions with rocks, saucer and (friendly fire) each other
        flying = [s for s in self.ships.values() if s.alive and not s.hyper_until]
        for s in flying:
            for r in self.rocks:
                if self.dist(s.x, s.y, r.x, r.y) < r.r + SHIP_R * 0.7:
                    if self.kill_ship(s, now):
                        self.break_rock(r, now, by=s.id)
                    break
            if s.alive and self.ufo and self.dist(s.x, s.y, self.ufo.x, self.ufo.y) < self.ufo.r + SHIP_R * 0.7:
                if self.kill_ship(s, now):
                    self.kill_ufo(now, by=s.id)
        if friendly:
            flying = [s for s in flying if s.alive]
            for i, a in enumerate(flying):
                for b in flying[i + 1:]:
                    if self.dist(a.x, a.y, b.x, b.y) < SHIP_R * 1.6:
                        self.kill_ship(a, now)
                        self.kill_ship(b, now)

        self.check_end()

    def step_ufo(self, now, dt):
        if not self.ufo:
            if now >= self.next_ufo and not self.wave_at:
                self.ufo = Ufo(small=self.wave >= 3 and random.random() < 0.6, now=now)
            return
        u = self.ufo
        if now >= u.turn_at:
            u.vy = random.choice((-1, 0, 1)) * UFO_SPEED * 0.6
            u.turn_at = now + random.uniform(1.0, 2.5)
        u.x += u.dir * UFO_SPEED * dt
        u.y = (u.y + u.vy * dt) % W
        if u.x < -u.r * 2 or u.x > W + u.r * 2:
            self.ufo = None                        # flew off the screen
            self.next_ufo = now + random.uniform(*UFO_EVERY)
            return
        if now >= u.fire_at:
            u.fire_at = now + UFO_FIRE
            targets = [s for s in self.ships.values() if s.alive and not s.hyper_until]
            if u.small and targets:
                t = min(targets, key=lambda s: self.dist(u.x, u.y, s.x, s.y))
                ang = math.atan2(t.y - u.y, t.x - u.x) + random.uniform(-0.25, 0.25)
            else:
                ang = random.uniform(0, math.tau)
            self.bullets.append(Bullet(u.x, u.y, math.cos(ang) * 330, math.sin(ang) * 330, now, 0))
        for r in self.rocks:
            if self.dist(u.x, u.y, r.x, r.y) < r.r + u.r:
                self.break_rock(r, now)
                self.kill_ufo(now)
                break

    # ------------------------------------------------ end of match
    def check_end(self):
        if not self.running:
            return
        active = [s for s in self.ships.values() if not s.out and (s.alive or s.lives > 0)]
        if not active:
            self.finish()

    def finish(self):
        ships = sorted(self.ships.values(), key=lambda s: -s.score)
        winner = None
        pts = lambda n: f"{n:,}".replace(",", ".")      # 12.340
        if len(ships) == 1:
            title = f"Game over – {pts(ships[0].score)} points, wave {self.wave}"
        elif ships:
            top = ships[0].score
            leaders = [s for s in ships if s.score == top]
            if len(leaders) == 1 and top > 0:
                winner = leaders[0]
                title = f"{self.name_of(winner.id)} wins with {pts(top)} points"
            else:
                title = f"Game over – wave {self.wave}"
        else:
            title = "Game over"
        self.results = {
            "title": title,
            "winner": winner.id if winner else None,
            "ranking": [{"id": s.id, "score": s.score} for s in ships],
        }
        self.phase = "over"
        self.running = False

    # ------------------------------------------------ state for browsers
    def snapshot(self):
        now = time.monotonic()
        r1 = lambda v: round(v, 1)
        countdown = max(1, int(self.phase_end - now + 0.999)) if self.phase == "countdown" else 0
        u = self.ufo
        return {
            "phase": self.phase,
            "size": W,
            "wave": self.wave,
            "countdown": countdown,
            "wave_in": round(max(0.0, self.wave_at - now), 1) if self.wave_at else None,
            "ships": [{
                "id": s.id, "x": r1(s.x), "y": r1(s.y), "a": round(s.a, 3),
                "alive": s.alive, "out": s.out, "lives": s.lives, "score": s.score,
                "thrust": s.alive and "thrust" in s.keys and not s.hyper_until,
                "hyper": bool(s.hyper_until),
                "inv": s.alive and now < s.inv_until,
                "respawn": round(max(0.0, s.respawn_at - now), 1) if s.respawn_at and not s.alive else None,
            } for s in self.ships.values()],
            "rocks": [[r1(r.x), r1(r.y), r.r, r.seed, round(r.rot, 2)] for r in self.rocks],
            "bullets": [[r1(b.x), r1(b.y), b.owner] for b in self.bullets],
            "ufo": {"x": r1(u.x), "y": r1(u.y), "small": u.small, "r": u.r} if u else None,
            "booms": [[r1(b[0]), r1(b[1]), round(now - b[2], 2), b[3]] for b in self.booms],
            "events": [[e[0], e[1]] for e in self.events],
        }
