"""
Pong Tennis for the game room platform - after Atari's 1972 Pong and the
home "TV game" consoles that followed, with their TENNIS / FOOTBALL / SQUASH
selector.

One player: squash against a wall - three balls, count your returns.
Two to four players: two sides, first to the target score wins. Players
are put on sides alternately (1st left, 2nd right, 3rd left, 4th right).
With 2 bars per side (or whenever a side has two players) each side has a
goalkeeper at its end of the court and a forward at mid-distance; a player
alone on such a side moves both bars together, like the original Football.

The ball bounces off top and bottom; where it meets a bar sets the return
angle, and it speeds up during a rally.

Same interface as games/snake.py. Inputs: {"key": "up"|"down", "down": bool}
for held keys, or {"key": "pos", "value": 0..1} from the on-screen lever
(1 = top), which sets the bar position directly like the original knob;
with "drag": true (a finger dragged on a touch screen) the bars jump there.
"""

import math
import random
import time

W, H = 1000.0, 700.0
DT = 1 / 30
SUBSTEPS = 6                   # collision checks per tick, so a fast ball never skips a bar
BALL = 14.0                    # square ball
BAR_W = 14.0
BAR_SPEED = 760.0              # with the keys, units/s
BAR_FOLLOW = 1600.0            # max speed when following the lever
GOAL_X = 40.0                  # goalkeeper distance from the end line
FORWARD_X = 0.36               # forward bar position, as a share of the court from its own end
WALL = 16.0                    # solo: the wall on the right
SPEEDS = {"slow": 380.0, "normal": 470.0, "fast": 580.0}
BAR_SIZES = {"large": 110.0, "normal": 80.0, "small": 56.0}
SPEEDUP = 1.03                 # each return
MAX_SPEED = 950.0
MAX_ANGLE = math.radians(55)
SERVE_PAUSE = 1.0
COUNTDOWN = 3.0
SOLO_BALLS = 3


class Bar:
    def __init__(self, side, x, h, controllers):
        self.side = side           # 0 = left, 1 = right
        self.x = x                 # centre
        self.y = H / 2             # centre
        self.h = h
        self.controllers = controllers   # player ids moving this bar


class PongGame:
    id = "pong"
    name = "Pong Tennis"
    max_players = 4
    SETTINGS = [
        {"key": "bars", "label": "Bars per side", "default": 1,
         "options": [[1, "1 – Tennis"], [2, "2 – Football"]],
         "hints": {1: "One bar at each end. A side with two players always gets two bars. Alone you play squash against the wall.",
                   2: "A goalkeeper at the end and a forward at mid-distance. Alone on a side, you move both together."}},
        {"key": "speed", "label": "Ball speed", "default": "normal",
         "options": [["slow", "Slow"], ["normal", "Normal"], ["fast", "Fast"]]},
        {"key": "bat", "label": "Bar size", "default": "normal",
         "options": [["large", "Large"], ["normal", "Normal"], ["small", "Small"]]},
        {"key": "target", "label": "Match", "default": 11,
         "options": [[5, "First to 5"], [11, "First to 11"], [15, "First to 15"]]},
    ]

    def __init__(self, room):
        self.room = room
        self.settings = {s["key"]: s["default"] for s in self.SETTINGS}
        self.running = False
        self.results = None
        self.phase = "idle"        # idle | countdown | serve | playing | over
        self.phase_end = 0.0
        self.solo = False
        self.sides = [[], []]      # player ids per side
        self.bars = []
        self.score = [0, 0]
        self.ball = None           # [x, y, vx, vy]
        self.serve_to = 0
        self.keys = {}             # pid -> set of held keys
        self.target_y = {}         # pid -> lever target (bar centre) or None
        self.hits = 0              # counters for the browser's beeps
        self.walls = 0
        self.points = 0
        self.hit_pid = None        # who hit last, and which side won the last point (for vibration)
        self.point_to = None
        self.rally = 0
        self.solo_hits = 0
        self.solo_balls = SOLO_BALLS

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
        self.solo = len(pids) == 1
        self.sides = [pids[0::2], pids[1::2]]
        h = BAR_SIZES[self.settings["bat"]]
        self.bars = []
        for side in (0, 1):
            players = self.sides[side]
            if not players:
                continue                   # solo: the right side is a wall
            end_x = GOAL_X if side == 0 else W - GOAL_X
            fwd_x = W * FORWARD_X if side == 0 else W * (1 - FORWARD_X)
            two = self.settings["bars"] == 2 or len(players) == 2
            if not two:
                self.bars.append(Bar(side, end_x, h, players[:1]))
            elif len(players) == 2:
                self.bars.append(Bar(side, end_x, h, [players[0]]))          # goalkeeper
                self.bars.append(Bar(side, fwd_x, h, [players[1]]))          # forward
            else:
                self.bars.append(Bar(side, end_x, h, players[:1]))
                self.bars.append(Bar(side, fwd_x, h, players[:1]))
        self.keys = {pid: set() for pid in pids}
        self.target_y = {pid: None for pid in pids}
        self.score = [0, 0]
        self.solo_hits = 0
        self.solo_balls = SOLO_BALLS
        self.ball = None
        self.serve_to = random.choice((0, 1)) if not self.solo else 0
        self.phase = "countdown"
        self.phase_end = time.monotonic() + COUNTDOWN
        self.running = True

    def serve(self):
        sp = SPEEDS[self.settings["speed"]]
        ang = random.uniform(-0.45, 0.45)
        direction = -1 if self.serve_to == 0 else 1
        x = W - WALL - 60 if self.solo else W / 2
        self.ball = [x, random.uniform(H * 0.3, H * 0.7),
                     direction * sp * math.cos(ang), sp * math.sin(ang)]
        self.rally = 0

    def update(self, now):
        if not self.running:
            return False
        if self.phase in ("countdown", "serve"):
            self.move_bars(DT)
            if now >= self.phase_end:
                self.serve()
                self.phase = "playing"
        elif self.phase == "playing":
            self.move_bars(DT)
            for _ in range(SUBSTEPS):
                if self.step_ball(DT / SUBSTEPS, now):
                    break
        return True

    # ------------------------------------------------ input
    def input(self, pid, data):
        if pid not in self.keys:
            return
        key = data.get("key")
        if key == "pos":
            try:
                v = min(1.0, max(0.0, float(data.get("value", 0.5))))
            except (TypeError, ValueError):
                return
            h = BAR_SIZES[self.settings["bat"]]
            self.target_y[pid] = h / 2 + (1 - v) * (H - h)
            if data.get("drag"):
                # dragging a finger on a touch screen: the bars follow it at once
                for bar in self.bars:
                    if bar.controllers and bar.controllers[0] == pid:
                        bar.y = min(max(self.target_y[pid], bar.h / 2), H - bar.h / 2)
            return
        if key not in ("up", "down"):
            return
        if data.get("down"):
            self.keys[pid].add(key)
            self.target_y[pid] = None          # keys take over from the lever
        else:
            self.keys[pid].discard(key)

    def quit(self, pid):
        # a player leaving mid-match: their bars stop; with nobody left on a side the other side wins
        self.keys.pop(pid, None)
        self.target_y.pop(pid, None)
        for bar in self.bars:
            if pid in bar.controllers:
                bar.controllers = [c for c in bar.controllers if c != pid]
        self.check_abandoned()

    def remove(self, pid):
        self.quit(pid)

    def check_abandoned(self):
        if not self.running:
            return
        active = [any(c in self.keys for b in self.bars if b.side == s for c in b.controllers) for s in (0, 1)]
        if self.solo:
            if not active[0]:
                self.finish()
        elif not active[0] or not active[1]:
            self.finish(forfeit=0 if not active[0] else 1)

    def can_drop_in(self):
        return False               # sides are set at the start: the host restarts to add players

    def drop_in(self, pid):
        pass

    # ------------------------------------------------ physics
    def move_bars(self, dt):
        for bar in self.bars:
            if not bar.controllers:
                continue
            pid = bar.controllers[0]
            keys = self.keys.get(pid, set())
            tgt = self.target_y.get(pid)
            if keys:
                bar.y += ((("down" in keys) - ("up" in keys)) * BAR_SPEED * dt)
            elif tgt is not None:
                step = max(-BAR_FOLLOW * dt, min(BAR_FOLLOW * dt, tgt - bar.y))
                bar.y += step
            bar.y = min(max(bar.y, bar.h / 2), H - bar.h / 2)

    def step_ball(self, dt, now):
        b = self.ball
        if not b:
            return False
        b[0] += b[2] * dt
        b[1] += b[3] * dt
        half = BALL / 2
        # top and bottom
        if b[1] < half:
            b[1], b[3] = half, abs(b[3])
            self.walls += 1
        elif b[1] > H - half:
            b[1], b[3] = H - half, -abs(b[3])
            self.walls += 1
        # solo: the wall on the right
        if self.solo and b[0] > W - WALL - half:
            b[0], b[2] = W - WALL - half, -abs(b[2])
            self.walls += 1
        # bars only stop balls heading towards their own end, so your own returns
        # pass through your own forward bar
        for bar in self.bars:
            heading_home = b[2] < 0 if bar.side == 0 else b[2] > 0
            if not heading_home:
                continue
            if abs(b[0] - bar.x) < (BAR_W + BALL) / 2 and abs(b[1] - bar.y) < (bar.h + BALL) / 2:
                if (bar.side == 0 and b[0] < bar.x) or (bar.side == 1 and b[0] > bar.x):
                    continue                   # already past this bar's middle: too late
                rel = max(-1.0, min(1.0, (b[1] - bar.y) / (bar.h / 2)))
                speed = min(MAX_SPEED, math.hypot(b[2], b[3]) * SPEEDUP)
                ang = rel * MAX_ANGLE
                direction = 1 if bar.side == 0 else -1
                b[2] = direction * speed * math.cos(ang)
                b[3] = speed * math.sin(ang)
                b[0] = bar.x + direction * (BAR_W + BALL) / 2
                self.hits += 1
                self.hit_pid = bar.controllers[0] if bar.controllers else None
                self.rally += 1
                if self.solo:
                    self.solo_hits += 1
                break
        # out at either end
        if b[0] < -BALL:
            self.point(1, now)
            return True
        if b[0] > W + BALL:
            self.point(0, now)
            return True
        return False

    def point(self, side, now):
        self.ball = None
        self.points += 1
        self.point_to = side
        if self.solo:
            self.solo_balls -= 1
            if self.solo_balls <= 0:
                self.finish()
                return
            self.serve_to = 0
        else:
            self.score[side] += 1
            if self.score[side] >= self.settings["target"]:
                self.finish()
                return
            self.serve_to = 1 - side           # serve towards the side that lost the point
        self.phase = "serve"
        self.phase_end = now + SERVE_PAUSE

    # ------------------------------------------------ results
    def team_name(self, side):
        names = [self.name_of(p) for p in self.sides[side]]
        return " & ".join(names) if names else "?"

    def finish(self, forfeit=None):
        winner = None
        if self.solo:
            pid = self.sides[0][0] if self.sides[0] else None
            title = f"Practice over – {self.solo_hits} return{'s' if self.solo_hits != 1 else ''}"
            ranking = [{"id": pid, "score": self.solo_hits}] if pid else []
        else:
            if forfeit is not None:
                win = 1 - forfeit
            else:
                win = 0 if self.score[0] > self.score[1] else 1
            team = self.sides[win]
            plural = len(team) > 1
            title = f"{self.team_name(win)} win{'' if plural else 's'} {max(self.score)}–{min(self.score)}"
            if forfeit is not None:
                title = f"{self.team_name(win)} win{'' if plural else 's'} – the other side left"
            winner = team[0] if len(team) == 1 else None
            ranking = [{"id": p, "score": self.score[s]} for s in (win, 1 - win) for p in self.sides[s]]
        self.results = {"title": title, "winner": winner, "ranking": ranking}
        self.phase = "over"
        self.running = False

    # ------------------------------------------------ state for browsers
    def snapshot(self):
        now = time.monotonic()
        countdown = max(1, int(self.phase_end - now + 0.999)) if self.phase == "countdown" else 0
        r1 = lambda v: round(v, 1)
        return {
            "phase": self.phase,
            "w": W, "h": H,
            "solo": self.solo,
            "target": self.settings["target"],
            "countdown": countdown,
            "score": self.score,
            "sides": self.sides,
            "solo_hits": self.solo_hits,
            "solo_balls": self.solo_balls,
            "ball": [r1(self.ball[0]), r1(self.ball[1])] if self.ball else None,
            "bars": [{"side": b.side, "x": r1(b.x), "y": r1(b.y), "h": b.h, "pids": b.controllers}
                     for b in self.bars],
            "wall": WALL if self.solo else 0,
            "bar_w": BAR_W, "ball_size": BALL,
            "hits": self.hits, "walls": self.walls, "points": self.points,
            "hit_pid": self.hit_pid, "point_to": self.point_to,
        }
