"""
Snake for the game room platform.

The platform (server.py) handles rooms, players, host and lobby.
This module only knows the Snake rules. The interface every game provides:

    id, name, max_players, SETTINGS      catalog entry and lobby settings
    settings (dict), set_setting(k, v)   current settings, validated change
    start(pids)                          begin a match with these players
    update(now) -> bool                  advance one step; True = state changed
    tick() -> float                      seconds until the next update
    running, results                     match in progress / outcome when over
    input(pid, data)                     a player's input (e.g. {"dir": "up"})
    quit(pid), remove(pid)               player left the match / the room
    can_drop_in(), drop_in(pid)          optional: join a running match
    snapshot() -> dict                   game part of the state sent to browsers
"""

import random
import time
from collections import Counter

BASE_TICK = 0.14                                         # seconds per move, "normal"
SPEEDS = {"slow": 1.3, "normal": 1.0, "fast": 0.75}
SIZES = {"small": 20, "medium": 28, "large": 36, "huge": 44}
CELLS_PER_FOOD = 200                                     # bigger arenas get more food
COUNTDOWN = 3.0
RESPAWN = 3.0
START_LEN = 3

DIRS = {"up": (0, -1), "down": (0, 1), "left": (-1, 0), "right": (1, 0)}
OPPOSITE = {"up": "down", "down": "up", "left": "right", "right": "left"}


class Snake:
    def __init__(self, pid):
        self.id = pid
        self.body = []
        self.dir = "right"
        self.pending = []          # buffered turns (max 2)
        self.alive = False
        self.in_round = False      # started this match (rounds mode)
        self.out = False           # quit the match
        self.score = 0
        self.respawn_at = None

    def queue(self, d):
        if d not in DIRS:
            return
        last = self.pending[-1] if self.pending else self.dir
        if d == last or d == OPPOSITE[last]:
            return
        if len(self.pending) < 2:
            self.pending.append(d)


class SnakeGame:
    id = "snake"
    name = "Snake"
    max_players = 4
    SETTINGS = [
        {"key": "mode", "label": "Game mode", "default": "rounds",
         "options": [["rounds", "Last snake standing"], ["endless", "Free-for-all"]],
         "hints": {"rounds": "Crash and you're out until the next round. The last snake alive wins.",
                   "endless": "Crash and you're back after 3 seconds. Highest score when time runs out wins."}},
        {"key": "duration", "label": "Duration", "default": 120, "show_if": {"mode": "endless"},
         "options": [[60, "1 min"], [120, "2 min"], [180, "3 min"]]},
        {"key": "speed", "label": "Speed", "default": "normal",
         "options": [["slow", "Slow"], ["normal", "Normal"], ["fast", "Fast"]]},
        {"key": "size", "label": "Arena", "default": "medium",
         "options": [["small", "Small"], ["medium", "Medium"], ["large", "Large"], ["huge", "Huge"]],
         "hints": {"small": "20 × 20 cells – best for 1–2 players",
                   "medium": "28 × 28 cells",
                   "large": "36 × 36 cells – good for 3–4 players",
                   "huge": "44 × 44 cells – very small cells on phones"}},
    ]

    def __init__(self, room):
        self.room = room                       # for player names in results
        self.settings = {s["key"]: s["default"] for s in self.SETTINGS}
        self.running = False
        self.results = None
        self.phase = "idle"                    # idle | countdown | playing | over
        self.snakes = {}
        self.food = []
        self.w = self.h = SIZES[self.settings["size"]]
        self.countdown_end = 0.0
        self.end_time = 0.0

    # ------------------------------------------------ settings
    def set_setting(self, key, value):
        for s in self.SETTINGS:
            if s["key"] == key and value in [o[0] for o in s["options"]]:
                self.settings[key] = value
                if key == "size":
                    self.w = self.h = SIZES[value]
                return True
        return False

    @property
    def mode(self):
        return self.settings["mode"]

    def tick(self):
        return BASE_TICK * SPEEDS[self.settings["speed"]] if self.running else 0.05

    # ------------------------------------------------ board helpers
    def occupied(self):
        cells = set()
        for s in self.snakes.values():
            if s.alive:
                cells.update(s.body)
        return cells

    def place_food(self):
        target = max(1, len(self.snakes), round(self.w * self.h / CELLS_PER_FOOD))
        if len(self.food) >= target:
            return
        taken = self.occupied() | set(self.food)
        free = [(x, y) for x in range(self.w) for y in range(self.h) if (x, y) not in taken]
        random.shuffle(free)
        while len(self.food) < target and free:
            self.food.append(free.pop())

    def spawn_fixed(self, i, s):
        w, h = self.w, self.h
        specs = [(3, h // 3, "right"), (w - 4, h - 1 - h // 3, "left"),
                 (w - 1 - w // 3, 3, "down"), (w // 3, h - 4, "up")]
        x, y, d = specs[i % len(specs)]
        dx, dy = DIRS[d]
        s.dir = d
        s.body = [(x - dx * k, y - dy * k) for k in range(START_LEN)]

    def spawn_random(self, s):
        taken = self.occupied() | set(self.food)
        for _ in range(300):
            d = random.choice(list(DIRS))
            dx, dy = DIRS[d]
            x = random.randrange(2, self.w - 2)
            y = random.randrange(2, self.h - 2)
            body = [(x - dx * k, y - dy * k) for k in range(START_LEN)]
            ahead = [(x + dx * k, y + dy * k) for k in range(1, 5)]
            if all(0 <= cx < self.w and 0 <= cy < self.h and (cx, cy) not in taken
                   for cx, cy in body + ahead):
                s.body, s.dir = body, d
                return True
        return False

    # ------------------------------------------------ match flow
    def start(self, pids):
        self.w = self.h = SIZES[self.settings["size"]]
        self.results = None
        self.food = []
        self.snakes = {}
        for i, pid in enumerate(pids):
            s = Snake(pid)
            s.alive = s.in_round = True
            self.spawn_fixed(i, s)
            self.snakes[pid] = s
        self.place_food()
        self.phase = "countdown"
        self.countdown_end = time.monotonic() + COUNTDOWN
        self.running = True

    def update(self, now):
        if not self.running:
            return False
        if self.phase == "countdown":
            if now >= self.countdown_end:
                self.phase = "playing"
                self.end_time = now + self.settings["duration"]
        elif self.phase == "playing":
            self.step(now)
        return True

    def input(self, pid, data):
        s = self.snakes.get(pid)
        if s and not s.out:
            s.queue(data.get("dir"))

    def kill(self, s, now):
        s.alive = False
        s.body = []
        s.pending = []
        if self.mode == "endless" and not s.out:
            s.respawn_at = now + RESPAWN

    def quit(self, pid):
        s = self.snakes.get(pid)
        if not s or s.out:
            return
        s.out = True
        s.alive = False
        s.body = []
        s.respawn_at = None
        self.check_end(time.monotonic())

    def remove(self, pid):
        self.snakes.pop(pid, None)
        if self.running:
            self.check_end(time.monotonic())

    def can_drop_in(self):
        return self.running and self.mode == "endless"

    def drop_in(self, pid):
        s = Snake(pid)
        s.respawn_at = time.monotonic() + 0.5
        self.snakes[pid] = s

    def step(self, now):
        if self.mode == "endless":
            for s in self.snakes.values():
                if not s.alive and not s.out and s.respawn_at and now >= s.respawn_at:
                    if self.spawn_random(s):
                        s.alive, s.respawn_at, s.pending = True, None, []

        alive = [s for s in self.snakes.values() if s.alive]
        moves = {}
        for s in alive:
            if s.pending:
                s.dir = s.pending.pop(0)
            dx, dy = DIRS[s.dir]
            hx, hy = s.body[0]
            moves[s.id] = (hx + dx, hy + dy)

        food = set(self.food)
        grows = {pid: head in food for pid, head in moves.items()}
        # cells still occupied after everyone moves (tails move away unless growing)
        blocked = set()
        for s in alive:
            blocked.update(s.body if grows[s.id] else s.body[:-1])
        heads = Counter(moves.values())

        for s in alive:
            nx, ny = moves[s.id]
            outside = not (0 <= nx < self.w and 0 <= ny < self.h)
            if outside or (nx, ny) in blocked or heads[(nx, ny)] > 1:
                self.kill(s, now)
                continue
            s.body.insert(0, (nx, ny))
            if grows[s.id]:
                s.score += 1
                self.food.remove((nx, ny))
            else:
                s.body.pop()

        self.place_food()
        self.check_end(now)

    def check_end(self, now):
        if not self.running or self.phase == "countdown":
            return
        if self.mode == "endless":
            active = [s for s in self.snakes.values() if not s.out]
            if now >= self.end_time or not active:
                self.finish()
            return
        in_round = [s for s in self.snakes.values() if s.in_round]
        alive = [s for s in in_round if s.alive]
        if (len(in_round) >= 2 and len(alive) <= 1) or not alive:
            self.finish()

    def name_of(self, pid):
        p = self.room.players.get(pid)
        return p.name if p else "?"

    def finish(self):
        snakes = list(self.snakes.values())
        winner = None
        if self.mode == "rounds":
            in_round = [s for s in snakes if s.in_round]
            alive = [s for s in in_round if s.alive]
            if len(in_round) >= 2:
                if len(alive) == 1:
                    winner = alive[0]
                    title = f"{self.name_of(winner.id)} wins the round!"
                else:
                    title = "Draw – everyone crashed"
            else:
                title = f"Game over – score {in_round[0].score if in_round else 0}"
            snakes.sort(key=lambda s: (s is not winner, -s.score))
        else:
            top = max((s.score for s in snakes), default=0)
            leaders = [s for s in snakes if s.score == top]
            if len(snakes) == 1:
                title = f"Time's up – score {top}"
            elif len(leaders) == 1:
                winner = leaders[0]
                title = f"{self.name_of(winner.id)} wins with {top}!"
            else:
                title = f"Draw at {top} points"
            snakes.sort(key=lambda s: -s.score)
        self.results = {
            "title": title,
            "winner": winner.id if winner else None,
            "ranking": [{"id": s.id, "score": s.score} for s in snakes],
        }
        self.phase = "over"
        self.running = False

    # ------------------------------------------------ state for browsers
    def snapshot(self):
        now = time.monotonic()
        countdown = max(1, int(self.countdown_end - now + 0.999)) if self.phase == "countdown" else 0
        time_left = None
        if self.phase == "playing" and self.mode == "endless":
            time_left = max(0, int(self.end_time - now + 0.999))
        return {
            "phase": self.phase,
            "w": self.w,
            "h": self.h,
            "countdown": countdown,
            "time_left": time_left,
            "food": self.food,
            "snakes": [{
                "id": s.id, "body": s.body, "dir": s.dir, "alive": s.alive,
                "in_round": s.in_round, "out": s.out, "score": s.score,
                "respawn": round(max(0.0, s.respawn_at - now), 1) if s.respawn_at else None,
            } for s in self.snakes.values()],
        }
