"""
Breakout for the game room platform - after Atari's Breakout (1976) and
Super Breakout (1978), extended to 1-4 players sharing one wall.

Each player has a paddle at the bottom, their own ball(s), lives and score.
Balls bounce off any paddle, so you can save a friend's ball; a brick scores
for whoever's ball broke it. Bricks come in the original colour bands:
yellow 1, green 3, orange 5, red 7 points. The ball speeds up after 4 and 12
hits and on reaching the orange and red rows; your paddle shrinks to half
the first time your ball breaks through to the top wall. Clear the wall and
a new one comes.

Modes (Super Breakout):
  classic      one ball each
  double       two stacked paddles and two balls each; a life is lost only
               when both balls are gone
  cavity       two balls are trapped inside the wall and join in once freed
  progressive  the wall keeps moving down, with new rows appearing at the top

Same interface as games/snake.py. Inputs: {"key": "left"|"right"|"fire",
"down": bool} for held keys (fire launches early), or {"key": "pos",
"value": 0..1} from the on-screen knob (0 = far left); with "drag": true
(a finger dragged on a touch screen) the paddle jumps straight there.
"""

import math
import random
import time

W, H = 800.0, 900.0
DT = 1 / 30
SUBSTEPS = 6
COLS = 14
BRICK_W = W / COLS
BRICK_H = 24.0
TOP = 110.0                    # top of the wall (room for the scores above)
ROWS = 8
BALL = 12.0
PADDLE_Y = H - 40.0
UPPER_Y = H - 92.0             # double mode: the second paddle
PADDLE_H = 12.0
PADDLE_W = 100.0
PADDLE_SPEED = 820.0
PADDLE_FOLLOW = 1700.0
SPEEDS = {"slow": 340.0, "normal": 410.0, "fast": 490.0}
MAX_ANGLE = math.radians(60)
SERVE_AFTER = 1.2
COUNTDOWN = 3.0
DANGER_Y = H - 130.0           # progressive: the wall reaching this line ends the game
POINTS = {0: 7, 1: 5, 2: 3, 3: 1}                 # by colour band from the top: red, orange, green, yellow


def band(row):
    return min(3, row // 2)


class Paddle:
    def __init__(self, pid, x):
        self.pid = pid
        self.x = x
        self.w = PADDLE_W
        self.shrunk = False
        self.keys = set()
        self.target = None         # knob position (paddle centre) or None


class Ball:
    def __init__(self, owner, x, y):
        self.owner = owner
        self.x, self.y = x, y
        self.vx = self.vy = 0.0
        self.hits = 0
        self.top_band = 3          # highest colour band reached (0 = red)
        self.attached = True       # sitting on the paddle, waiting to be served
        self.serve_at = 0.0
        self.trapped = False       # cavity mode: stuck inside the wall
        self.bonus = False         # a freed cavity ball: losing it costs no life
        self.offset = 0.0

    def speed(self, base):
        k = 1.0
        if self.hits >= 4:
            k = 1.15
        if self.hits >= 12:
            k = 1.3
        if self.top_band <= 1:
            k = max(k, 1.45)
        if self.top_band == 0:
            k = max(k, 1.6)
        return base * k


class Player:
    def __init__(self, pid, lives):
        self.id = pid
        self.lives = lives
        self.score = 0
        self.out = False


class BreakoutGame:
    id = "breakout"
    name = "Breakout"
    max_players = 4
    SETTINGS = [
        {"key": "mode", "label": "Game", "default": "classic",
         "options": [["classic", "Breakout"], ["double", "Double"], ["cavity", "Cavity"], ["progressive", "Progressive"]],
         "hints": {"classic": "The 1976 original: one paddle, one ball.",
                   "double": "Two stacked paddles and two balls each – a life goes only when both balls are lost.",
                   "cavity": "Two balls are trapped inside the wall. Break them free and they join in.",
                   "progressive": "The wall keeps moving down and new rows appear on top. Don't let it reach you."}},
        {"key": "lives", "label": "Balls", "default": 3,
         "options": [[3, "3"], [5, "5"]]},
        {"key": "speed", "label": "Ball speed", "default": "normal",
         "options": [["slow", "Slow"], ["normal", "Normal"], ["fast", "Fast"]]},
    ]

    def __init__(self, room):
        self.room = room
        self.settings = {s["key"]: s["default"] for s in self.SETTINGS}
        self.running = False
        self.results = None
        self.phase = "idle"        # idle | countdown | playing | over
        self.phase_end = 0.0
        self.rows = []             # list of rows, each a list of 0/1, from the top
        self.players = {}
        self.paddles = {}
        self.balls = []
        self.level = 0
        self.next_shift = 0.0
        self.lost_reason = ""
        # counters for the browser's beeps; *_pid says whose paddle/ball it was (for vibration)
        self.ev = {"brick": 0, "band": 3, "paddle": 0, "wall": 0, "lost": 0, "level": 0,
                   "brick_pid": None, "paddle_pid": None, "lost_pid": None}

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

    @property
    def mode(self):
        return self.settings["mode"]

    # ------------------------------------------------ match flow
    def start(self, pids):
        self.results = None
        self.players = {pid: Player(pid, self.settings["lives"]) for pid in pids}
        self.paddles = {}
        n = len(pids)
        for i, pid in enumerate(pids):
            self.paddles[pid] = Paddle(pid, W * (i + 1) / (n + 1))
        self.level = 0
        self.lost_reason = ""
        self.new_wall()
        self.phase = "countdown"
        self.phase_end = time.monotonic() + COUNTDOWN
        self.running = True

    def new_wall(self):
        self.level += 1
        self.rows = [[1] * COLS for _ in range(ROWS)]
        self.balls = []
        if self.mode == "cavity":
            # two hollow cells in the middle rows, each holding a trapped ball
            for col in random.sample(range(2, COLS - 2), 2):
                row = random.choice((3, 4))
                self.rows[row][col] = 0
                b = Ball(None, (col + 0.5) * BRICK_W, TOP + (row + 0.5) * BRICK_H)
                b.attached = False
                b.trapped = True
                self.balls.append(b)
        for p in self.paddles.values():
            p.w = PADDLE_W
            p.shrunk = False
        now = time.monotonic()
        for pid, pl in self.players.items():
            if not pl.out:
                self.give_balls(pid, now + (COUNTDOWN if self.level == 1 else SERVE_AFTER))
        self.next_shift = now + (COUNTDOWN if self.level == 1 else 0) + self.shift_interval()
        self.ev["level"] += 1

    def shift_interval(self):
        return max(4.0, 11.0 - self.level * 1.0)

    def give_balls(self, pid, serve_at):
        n = 2 if self.mode == "double" else 1
        pad = self.paddles.get(pid)
        if not pad:
            return
        for i in range(n):
            b = Ball(pid, pad.x, PADDLE_Y - PADDLE_H / 2 - BALL / 2)
            b.offset = (i - (n - 1) / 2) * 30
            b.serve_at = serve_at + i * 0.6
            self.balls.append(b)

    def update(self, now):
        if not self.running:
            return False
        if self.phase == "countdown":
            self.move_paddles(DT)
            self.carry_attached()
            if now >= self.phase_end:
                self.phase = "playing"
        elif self.phase == "playing":
            self.move_paddles(DT)
            self.carry_attached()
            for b in self.balls:
                if b.attached and now >= b.serve_at:
                    self.launch(b)
            for _ in range(SUBSTEPS):
                self.step_balls(DT / SUBSTEPS, now)
            if self.mode == "progressive" and now >= self.next_shift:
                self.shift_wall(now)
            self.check_wall(now)
        return True

    # ------------------------------------------------ input
    def input(self, pid, data):
        pad = self.paddles.get(pid)
        pl = self.players.get(pid)
        if not pad or not pl or pl.out:
            return
        key = data.get("key")
        if key == "pos":
            try:
                v = min(1.0, max(0.0, float(data.get("value", 0.5))))
            except (TypeError, ValueError):
                return
            pad.target = pad.w / 2 + v * (W - pad.w)
            if data.get("drag"):
                pad.x = pad.target         # dragging a finger: the paddle follows it at once
            return
        if key not in ("left", "right", "fire"):
            return
        if data.get("down"):
            if key == "fire":
                for b in self.balls:
                    if b.attached and b.owner == pid and self.phase == "playing":
                        b.serve_at = min(b.serve_at, time.monotonic())
                return
            pad.keys.add(key)
            pad.target = None
        else:
            pad.keys.discard(key)

    def quit(self, pid):
        pl = self.players.get(pid)
        if pl:
            pl.out = True
        self.paddles.pop(pid, None)
        self.balls = [b for b in self.balls if b.owner != pid or b.trapped]
        self.check_end()

    def remove(self, pid):
        self.quit(pid)
        self.players.pop(pid, None)
        self.check_end()

    def can_drop_in(self):
        return self.running

    def drop_in(self, pid):
        self.players[pid] = Player(pid, self.settings["lives"])
        self.paddles[pid] = Paddle(pid, W / 2)
        self.give_balls(pid, time.monotonic() + SERVE_AFTER)

    # ------------------------------------------------ paddles and serving
    def move_paddles(self, dt):
        for p in self.paddles.values():
            if p.keys:
                p.x += (("right" in p.keys) - ("left" in p.keys)) * PADDLE_SPEED * dt
            elif p.target is not None:
                p.x += max(-PADDLE_FOLLOW * dt, min(PADDLE_FOLLOW * dt, p.target - p.x))
            p.x = min(max(p.x, p.w / 2), W - p.w / 2)

    def carry_attached(self):
        for b in self.balls:
            if b.attached:
                pad = self.paddles.get(b.owner)
                if pad:
                    b.x = min(max(pad.x + b.offset, BALL), W - BALL)
                    b.y = PADDLE_Y - PADDLE_H / 2 - BALL / 2 - (52 if self.mode == "double" else 0)

    def launch(self, b):
        b.attached = False
        ang = random.uniform(-0.5, 0.5)
        sp = b.speed(SPEEDS[self.settings["speed"]])
        b.vx, b.vy = sp * math.sin(ang), -sp * math.cos(ang)

    # ------------------------------------------------ bricks
    def brick_at(self, x, y):
        r = int((y - TOP) // BRICK_H)
        c = int(x // BRICK_W)
        if y < TOP or r < 0 or r >= len(self.rows) or c < 0 or c >= COLS:
            return None
        return (r, c) if self.rows[r][c] else None

    def hit_brick(self, b):
        h = BALL / 2
        for dx, dy in ((-h, -h), (h, -h), (-h, h), (h, h)):
            cell = self.brick_at(b.x + dx, b.y + dy)
            if cell:
                return cell
        return None

    def break_brick(self, cell, b, now):
        r, c = cell
        self.rows[r][c] = 0
        bd = band(r)
        b.hits += 1
        b.top_band = min(b.top_band, bd)
        if b.owner in self.players:
            self.players[b.owner].score += POINTS[bd]
        self.ev["brick"] += 1
        self.ev["band"] = bd
        self.ev["brick_pid"] = b.owner
        # cavity: a trapped ball next to the broken brick is freed and joins the breaker
        for t in self.balls:
            if t.trapped:
                tr, tc = int((t.y - TOP) // BRICK_H), int(t.x // BRICK_W)
                if abs(tr - r) + abs(tc - c) == 1:
                    t.trapped = False
                    t.bonus = True
                    t.owner = b.owner
                    ang = random.uniform(-0.8, 0.8)
                    sp = SPEEDS[self.settings["speed"]]
                    t.vx, t.vy = sp * math.sin(ang), sp * math.cos(ang)

    # ------------------------------------------------ balls
    def step_balls(self, dt, now):
        base = SPEEDS[self.settings["speed"]]
        h = BALL / 2
        for b in list(self.balls):
            if b.attached or b.trapped:
                continue
            # move along x, bounce off bricks and side walls
            b.x += b.vx * dt
            if b.x < h or b.x > W - h:
                b.x = min(max(b.x, h), W - h)
                b.vx = -b.vx
                self.ev["wall"] += 1
            cell = self.hit_brick(b)
            if cell:
                self.break_brick(cell, b, now)
                b.x -= b.vx * dt
                b.vx = -b.vx
            # move along y, bounce off bricks and the top wall
            b.y += b.vy * dt
            if b.y < h:
                b.y = h
                b.vy = abs(b.vy)
                self.ev["wall"] += 1
                pad = self.paddles.get(b.owner)
                if pad and not pad.shrunk:             # broke through to the top: paddle halves
                    pad.shrunk = True
                    pad.w = PADDLE_W / 2
            cell = self.hit_brick(b)
            if cell:
                self.break_brick(cell, b, now)
                b.y -= b.vy * dt
                b.vy = -b.vy
            # keep the speed in line with the ball's progress
            sp = math.hypot(b.vx, b.vy) or 1.0
            want = b.speed(base)
            b.vx *= want / sp
            b.vy *= want / sp
            # paddles (anyone's)
            if b.vy > 0:
                ys = [PADDLE_Y] + ([UPPER_Y] if self.mode == "double" else [])
                for pad in self.paddles.values():
                    done = False
                    for py in ys:
                        top = py - PADDLE_H / 2
                        if top - h <= b.y <= top + PADDLE_H and abs(b.x - pad.x) <= pad.w / 2 + h:
                            rel = max(-1.0, min(1.0, (b.x - pad.x) / (pad.w / 2)))
                            ang = rel * MAX_ANGLE
                            sp = b.speed(base)
                            b.vx, b.vy = sp * math.sin(ang), -sp * math.cos(ang)
                            b.y = top - h
                            self.ev["paddle"] += 1
                            self.ev["paddle_pid"] = pad.pid
                            done = True
                            break
                    if done:
                        break
            # lost off the bottom
            if b.y > H + BALL:
                self.balls.remove(b)
                self.ball_lost(b, now)

    def ball_lost(self, b, now):
        self.ev["lost"] += 1
        self.ev["lost_pid"] = b.owner
        pl = self.players.get(b.owner)
        if not pl or pl.out:
            return
        still = [x for x in self.balls if x.owner == b.owner and not x.trapped]
        if still:
            return                                     # another of your balls is still in play
        pl.lives -= 1
        if pl.lives > 0:
            self.give_balls(b.owner, now + SERVE_AFTER)
        else:
            pl.out = True
            self.paddles.pop(b.owner, None)
            self.check_end()

    # ------------------------------------------------ the wall
    def shift_wall(self, now):
        new = [1 if random.random() < 0.8 else 0 for _ in range(COLS)]
        self.rows.insert(0, new)
        for b in self.balls:
            if b.trapped:
                b.y += BRICK_H
        self.next_shift = now + self.shift_interval()
        self.ev["wall"] += 1

    def check_wall(self, now):
        while self.rows and not any(self.rows[-1]):
            self.rows.pop()
        if self.mode == "progressive":
            if self.rows and TOP + len(self.rows) * BRICK_H > DANGER_Y:
                self.lost_reason = "The wall reached the paddles"
                self.finish()
            return
        if not self.rows or not any(any(r) for r in self.rows):
            self.new_wall()

    # ------------------------------------------------ end of match
    def check_end(self):
        if self.running and not [p for p in self.players.values() if not p.out]:
            self.finish()

    def finish(self):
        players = sorted(self.players.values(), key=lambda p: -p.score)
        winner = None
        reason = f"{self.lost_reason} – " if self.lost_reason else ""
        if len(players) == 1:
            p = players[0]
            title = f"{reason}Game over – {p.score} points, wall {self.level}"
        elif players:
            top = players[0].score
            leaders = [p for p in players if p.score == top]
            if len(leaders) == 1 and top > 0:
                winner = leaders[0]
                title = f"{reason}{self.name_of(winner.id)} wins with {top} points"
            else:
                title = f"{reason}Game over – wall {self.level}"
        else:
            title = "Game over"
        self.results = {"title": title, "winner": winner.id if winner else None,
                        "ranking": [{"id": p.id, "score": p.score} for p in players]}
        self.phase = "over"
        self.running = False

    # ------------------------------------------------ state for browsers
    def snapshot(self):
        now = time.monotonic()
        countdown = max(1, int(self.phase_end - now + 0.999)) if self.phase == "countdown" else 0
        r1 = lambda v: round(v, 1)
        ys = [PADDLE_Y] + ([UPPER_Y] if self.mode == "double" else [])
        return {
            "phase": self.phase,
            "w": W, "h": H,
            "mode": self.mode,
            "level": self.level,
            "countdown": countdown,
            "top": TOP, "bw": BRICK_W, "bh": BRICK_H, "ball_size": BALL, "paddle_h": PADDLE_H,
            "danger": DANGER_Y if self.mode == "progressive" else None,
            "shift_in": round(max(0.0, self.next_shift - now), 1) if self.mode == "progressive" else None,
            "rows": ["".join("1" if c else "0" for c in row) for row in self.rows],
            "balls": [[r1(b.x), r1(b.y), b.owner, 1 if b.trapped else 0,
                       1 if b.attached else 0] for b in self.balls],
            "paddles": [{"pid": p.pid, "x": r1(p.x), "w": p.w, "ys": ys} for p in self.paddles.values()],
            "players": [{"id": p.id, "lives": p.lives, "score": p.score, "out": p.out} for p in self.players.values()],
            "ev": self.ev,
        }
