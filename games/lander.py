"""
Lunar Lander for the game room platform - after Atari's 1979 coin-op,
extended to 1-4 players descending together.

Each descent all landers start high above a jagged terrain, already drifting
sideways. Gravity pulls them down; players rotate and use a variable throttle
(and an expensive Abort burn) to touch down gently on a flat pad. Narrow pads
carry score multipliers. Landers pass through each other.

Landing grades (like the original): good 50 points and +50 fuel, hard 15,
crash 5 - each times the pad multiplier; touching anything that isn't a pad
is a crash. When every lander has landed or crashed, a new terrain comes.
A player's game ends when their fuel runs out; the match ends when everyone
is out of fuel.

Missions (the four cabinet cards):
  training  light gravity, atmospheric friction
  cadet     moderate gravity
  prime     strong gravity
  command   moderate gravity, rotation keeps its momentum

Same interface as games/snake.py. Inputs: {"key": left|right|up|down|abort,
"down": bool} for held keys (up/down move the throttle), or
{"key": "throttle", "value": 0..1} from the on-screen lever.
"""

import math
import random
import time

W, H = 1600.0, 1000.0          # world: wide, wraps left/right
DT = 1 / 30
G_BASE = 9.0                   # units/s² for "moderate" gravity
MISSIONS = {                   # gravity factor, friction, rotational momentum
    "training": (0.6, 0.35, False),
    "cadet": (1.0, 0.0, False),
    "prime": (1.55, 0.0, False),
    "command": (1.0, 0.0, True),
}
THRUST_MAX = 21.0              # units/s² at full throttle
THROTTLE_RATE = 1.2            # throttle change per second while up/down held
BURN = 20.0                    # fuel per second at full throttle
ROT_SPEED = 2.2                # rad/s (controlled rotation)
ROT_ACCEL = 2.4                # rad/s² (command mission)
ABORT_FUEL = 150
ABORT_VY = -38.0
LEG = 13.5                     # from centre to the feet
FOOT = 13.0                    # half distance between the feet
TOP = 15.0                     # from centre to the top of the cabin
SAFE_GOOD = (15.0, 12.0, 0.2)  # vertical, horizontal speed, tilt (rad)
SAFE_HARD = (30.0, 31.0, 0.38)
GOOD_FUEL_BONUS = 50
COUNTDOWN = 3.0
NEXT_DESCENT = 2.0
DESCENT_PAUSE = 3.0
BOOM_LIFE = 1.4
PADS = [(150, 1), (100, 2), (70, 3), (46, 5)]   # width, multiplier

KEYS = ("left", "right", "up", "down", "abort")


def make_terrain():
    """Jagged polyline across the world with flat pads; ends match so it wraps."""
    pads = []
    xs = sorted(random.sample(range(1, 8), len(PADS)))           # 8 slots across the width
    order = random.sample(PADS, len(PADS))
    for slot, (w, mult) in zip(xs, order):
        start = slot * (W / 8) + random.uniform(10, W / 8 - w - 10)
        pads.append([start, start + w, mult])
    pts = []
    y = random.uniform(760, 880)
    first_y = y
    x = 0.0
    pad_i = 0
    while x < W:
        if pad_i < len(pads) and x + 45 >= pads[pad_i][0]:
            p = pads[pad_i]
            py = min(max(y + random.uniform(-40, 40), 640), 930)
            pts.append([p[0], py])
            pts.append([p[1], py])
            p.append(py)
            x = p[1]
            y = py
            pad_i += 1
            continue
        x += random.uniform(22, 46)
        if pad_i < len(pads) and x > pads[pad_i][0] - 4:
            x = pads[pad_i][0] - 4                               # never step over a pad's start
        # mostly rough ground with the odd tall peak
        jump = random.uniform(-70, 70) if random.random() < 0.85 else random.uniform(-190, -110)
        y = min(max(y + jump, 520), 960)
        if x >= W:
            break
        pts.append([x, y])
    pts.insert(0, [0.0, first_y])
    pts.append([W, first_y])
    return pts, pads                                              # pads: [x1, x2, mult, y]


class Lander:
    def __init__(self, pid, fuel):
        self.id = pid
        self.x = self.y = 0.0
        self.vx = self.vy = 0.0
        self.a = 0.0               # 0 = upright, positive = tilted right
        self.spin = 0.0            # rad/s (command mission)
        self.throttle = 0.0
        self.keys = set()
        self.abort_req = False
        self.fuel = float(fuel)
        self.score = 0
        self.landings = 0
        self.state = "waiting"     # waiting | flying | landed | crashed | done | out
        self.result = None         # last touchdown: {kind, points, mult, bonus}
        self.abort_at = 0.0        # last abort burn (for the browser's flash and sound)
        self.abort_denied_at = 0.0 # last abort refused for lack of fuel


class LanderGame:
    id = "lander"
    name = "Lunar Lander"
    max_players = 4
    SETTINGS = [
        {"key": "mission", "label": "Mission", "default": "cadet",
         "options": [["training", "Training"], ["cadet", "Cadet"], ["prime", "Prime"], ["command", "Command"]],
         "hints": {"training": "Light gravity and atmospheric friction to slow you down.",
                   "cadet": "Moderate lunar gravity, no friction.",
                   "prime": "Strong gravity – you'll need plenty of thrust.",
                   "command": "Moderate gravity, but rotation keeps spinning until you counter it."}},
        {"key": "fuel", "label": "Fuel", "default": 900,
         "options": [[450, "450"], [750, "750"], [900, "900"], [1800, "1800"]],
         "hints": {450: "A good landing gives 50 fuel back. Abort costs 150.",
                   750: "A good landing gives 50 fuel back. Abort costs 150.",
                   900: "A good landing gives 50 fuel back. Abort costs 150.",
                   1800: "A good landing gives 50 fuel back. Abort costs 150."}},
    ]

    def __init__(self, room):
        self.room = room
        self.settings = {s["key"]: s["default"] for s in self.SETTINGS}
        self.running = False
        self.results = None
        self.phase = "idle"        # idle | countdown | descent | pause | over
        self.phase_end = 0.0
        self.landers = {}
        self.terrain, self.pads = make_terrain()
        self.descent = 0
        self.started = 0.0
        self.booms = []            # [x, y, time]

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

    # ------------------------------------------------ terrain helpers
    def ground(self, x):
        x %= W
        t = self.terrain
        for i in range(1, len(t)):
            if x <= t[i][0]:
                x0, y0 = t[i - 1]
                x1, y1 = t[i]
                if x1 == x0:
                    return min(y0, y1)
                return y0 + (y1 - y0) * (x - x0) / (x1 - x0)
        return t[-1][1]

    def pad_under(self, x):
        for p in self.pads:
            if p[0] + 2 <= x - FOOT and x + FOOT <= p[1] - 2:
                return p
        return None

    # ------------------------------------------------ match flow
    def start(self, pids):
        self.results = None
        self.landers = {pid: Lander(pid, self.settings["fuel"]) for pid in pids}
        self.descent = 0
        self.started = time.monotonic()
        self.running = True
        self.new_descent(COUNTDOWN)

    def new_descent(self, countdown):
        self.descent += 1
        self.terrain, self.pads = make_terrain()
        self.booms = []
        flying = [l for l in self.landers.values() if l.state not in ("done", "out") and l.fuel > 0]
        n = len(flying)
        base = random.uniform(0, W)
        drift = random.choice((-1, 1))
        for i, l in enumerate(flying):
            l.x = (base + i * W / max(n, 1) * 0.6) % W
            l.y = 70.0
            l.vx = drift * random.uniform(22, 36)
            l.vy = 0.0
            l.a = 0.0
            l.spin = 0.0
            l.throttle = 0.0
            l.keys = set()
            l.abort_req = False
            l.result = None
            l.state = "flying"
        self.phase = "countdown"
        self.phase_end = time.monotonic() + countdown

    def update(self, now):
        if not self.running:
            return False
        self.booms = [b for b in self.booms if now - b[2] < BOOM_LIFE]
        if self.phase == "countdown":
            if now >= self.phase_end:
                self.phase = "descent"
        elif self.phase == "descent":
            self.step(now)
            if not [l for l in self.landers.values() if l.state == "flying"]:
                self.phase = "pause"
                self.phase_end = now + DESCENT_PAUSE
                for l in self.landers.values():
                    if l.state in ("landed", "crashed") and l.fuel <= 0:
                        l.state = "done"
        elif self.phase == "pause":
            if now >= self.phase_end:
                if [l for l in self.landers.values() if l.state not in ("done", "out") and l.fuel > 0]:
                    self.new_descent(NEXT_DESCENT)
                else:
                    self.finish()
        return True

    # ------------------------------------------------ input
    def input(self, pid, data):
        l = self.landers.get(pid)
        if not l or l.state in ("out", "done"):
            return
        key = data.get("key")
        if key == "throttle":
            try:
                l.throttle = min(1.0, max(0.0, float(data.get("value", 0))))
            except (TypeError, ValueError):
                pass
            return
        if key not in KEYS:
            return
        if data.get("down"):
            if key == "abort" and "abort" not in l.keys:
                l.abort_req = True
            l.keys.add(key)
        else:
            l.keys.discard(key)

    def quit(self, pid):
        l = self.landers.get(pid)
        if not l:
            return
        l.state = "out"
        self.check_end()

    def remove(self, pid):
        self.landers.pop(pid, None)
        self.check_end()

    def can_drop_in(self):
        return self.running

    def drop_in(self, pid):
        self.landers[pid] = Lander(pid, self.settings["fuel"])     # joins the next descent

    def check_end(self):
        if not self.running:
            return
        if not [l for l in self.landers.values() if l.state not in ("out", "done")]:
            self.finish()

    # ------------------------------------------------ physics
    def step(self, now):
        dt = DT
        gfac, friction, momentum = MISSIONS[self.settings["mission"]]
        g = G_BASE * gfac
        for l in self.landers.values():
            if l.state != "flying":
                continue
            # throttle and rotation
            if "up" in l.keys:
                l.throttle = min(1.0, l.throttle + THROTTLE_RATE * dt)
            if "down" in l.keys:
                l.throttle = max(0.0, l.throttle - THROTTLE_RATE * dt)
            turn = ("right" in l.keys) - ("left" in l.keys)
            if momentum:
                l.spin += turn * ROT_ACCEL * dt
                l.a += l.spin * dt
            else:
                l.a += turn * ROT_SPEED * dt
            l.a = (l.a + math.pi) % math.tau - math.pi
            # abort: snap upright and blast upwards
            if l.abort_req:
                l.abort_req = False
                if l.fuel >= ABORT_FUEL:
                    l.fuel -= ABORT_FUEL
                    l.a = 0.0
                    l.spin = 0.0
                    l.vy = min(l.vy, ABORT_VY)
                    l.vx *= 0.5
                    l.abort_at = now
                else:
                    l.abort_denied_at = now
            if l.fuel <= 0:
                l.fuel = 0.0
                l.throttle = 0.0
            thrust = THRUST_MAX * l.throttle
            if thrust:
                l.fuel = max(0.0, l.fuel - BURN * l.throttle * dt)
            l.vx += math.sin(l.a) * thrust * dt
            l.vy += (g - math.cos(l.a) * thrust) * dt
            if friction:
                k = max(0.0, 1 - friction * dt)
                l.vx *= k
                l.vy *= k
            l.x = (l.x + l.vx * dt) % W
            l.y += l.vy * dt
            if l.y < 10:
                l.y, l.vy = 10.0, max(0.0, l.vy)
            self.touchdown(l, now)

    def touchdown(self, l, now):
        # feet (rotated with the lander) and the top of the cabin
        ca, sa = math.cos(l.a), math.sin(l.a)
        feet = [(l.x + (-FOOT) * ca - LEG * sa, l.y + (-FOOT) * sa + LEG * ca),
                (l.x + FOOT * ca - LEG * sa, l.y + FOOT * sa + LEG * ca)]
        top = (l.x + TOP * sa, l.y - TOP * ca)
        hit = any(fy >= self.ground(fx) for fx, fy in feet) or top[1] >= self.ground(top[0])
        if not hit:
            return
        pad = self.pad_under(l.x)
        vy, vx, tilt = l.vy, abs(l.vx), abs(l.a)
        mult = pad[2] if pad else 1
        if pad and vy <= SAFE_GOOD[0] and vx <= SAFE_GOOD[1] and tilt <= SAFE_GOOD[2]:
            kind, pts, bonus = "good", 50, GOOD_FUEL_BONUS
        elif pad and vy <= SAFE_HARD[0] and vx <= SAFE_HARD[1] and tilt <= SAFE_HARD[2]:
            kind, pts, bonus = "hard", 15, 0
        else:
            kind, pts, bonus = "crash", 5, 0
            mult = 1                                   # multipliers only reward real landings
        l.score += pts * mult
        l.fuel += bonus
        l.throttle = 0.0
        l.keys = set()
        l.result = {"kind": kind, "points": pts * mult, "mult": mult, "bonus": bonus,
                    "vy": round(vy, 1), "vx": round(vx, 1)}
        if kind == "crash":
            l.state = "crashed"
            self.booms.append([l.x, l.y, now])
        else:
            l.state = "landed"
            l.landings += 1
            l.y = pad[3] - LEG
            l.a = 0.0
            l.vx = l.vy = 0.0

    # ------------------------------------------------ results
    def finish(self):
        landers = sorted(self.landers.values(), key=lambda l: -l.score)
        winner = None
        if len(landers) == 1:
            l = landers[0]
            title = f"Mission over – {l.score} points, {l.landings} landing{'s' if l.landings != 1 else ''}"
        elif landers:
            top = landers[0].score
            leaders = [l for l in landers if l.score == top]
            if len(leaders) == 1 and top > 0:
                winner = leaders[0]
                title = f"{self.name_of(winner.id)} wins with {top} points"
            else:
                title = "Mission over – it's a draw"
        else:
            title = "Mission over"
        self.results = {
            "title": title,
            "winner": winner.id if winner else None,
            "ranking": [{"id": l.id, "score": l.score} for l in landers],
        }
        self.phase = "over"
        self.running = False

    # ------------------------------------------------ state for browsers
    def snapshot(self):
        now = time.monotonic()
        r1 = lambda v: round(v, 1)
        countdown = max(1, int(self.phase_end - now + 0.999)) if self.phase == "countdown" else 0
        return {
            "phase": self.phase,
            "w": W, "h": H,
            "mission": self.settings["mission"],
            "descent": self.descent,
            "countdown": countdown,
            "time": int(now - self.started) if self.running else 0,
            "terrain": [[r1(x), r1(y)] for x, y in self.terrain],
            "pads": [[r1(p[0]), r1(p[1]), p[2], r1(p[3])] for p in self.pads],
            "landers": [{
                "id": l.id, "x": r1(l.x), "y": r1(l.y), "a": round(l.a, 3),
                "vx": r1(l.vx), "vy": r1(l.vy), "throttle": round(l.throttle, 2),
                "fuel": int(l.fuel), "score": l.score, "state": l.state,
                "alt": r1(max(0.0, self.ground(l.x) - l.y - LEG)) if l.state == "flying" else 0,
                "abort": round(now - l.abort_at, 2) if now - l.abort_at < 1.5 else None,
                "abort_denied": now - l.abort_denied_at < 1.5,
                "result": l.result,
            } for l in self.landers.values()],
            "booms": [[r1(b[0]), r1(b[1]), round(now - b[2], 2)] for b in self.booms],
        }
