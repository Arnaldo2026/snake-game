"""
Snake - multiplayer server (server-authoritative).

Players create or join a room with a 4-letter code. The server runs one
game loop per room, moves every snake, resolves collisions and sends the
board to all players in the room over WebSockets.

The host (whoever created the room) chooses before each match:
  - mode "rounds":  last snake standing wins; dead snakes wait for the next round
  - mode "endless": timed free-for-all; dead snakes respawn after 3 s,
                    highest score when time runs out wins
  - duration (free-for-all only) and speed

Run:   python server.py
Open:  http://localhost:8000          (on this PC)
       http://<LAN-IP>:8000           (on a phone on the same Wi-Fi)
On Render the PORT environment variable is set automatically.
"""

import asyncio
import itertools
import json
import os
import random
import socket
import sys
import time
import traceback
from collections import Counter
from pathlib import Path

from aiohttp import WSMsgType, web

# ---------------------------------------------------------------- settings
GRID = int(os.environ.get("SNAKE_GRID", 24))
BASE_TICK = float(os.environ.get("SNAKE_TICK", 0.14))   # seconds per move, "normal"
SPEEDS = {"slow": 1.3, "normal": 1.0, "fast": 0.75}      # multipliers on BASE_TICK
DURATIONS = (60, 120, 180)                               # free-for-all, seconds
MAX_PLAYERS = 4
COUNTDOWN = 3.0
RESPAWN = 3.0
START_LEN = 3
NAME_MAX = 12
COLORS = ["#4ade80", "#60a5fa", "#fb923c", "#f472b6"]
CODE_CHARS = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"           # no 0/O, 1/I/L

HERE = Path(__file__).resolve().parent
DIRS = {"up": (0, -1), "down": (0, 1), "left": (-1, 0), "right": (1, 0)}
OPPOSITE = {"up": "down", "down": "up", "left": "right", "right": "left"}

ROOMS = {}
_ids = itertools.count(1)


# ---------------------------------------------------------------- player
class Player:
    def __init__(self, pid, name, ws, color):
        self.id = pid
        self.name = name
        self.ws = ws
        self.color = color
        self.body = []
        self.dir = "right"
        self.pending = []          # buffered turns (max 2)
        self.alive = False
        self.in_round = False      # took part in the current match from the start
        self.score = 0
        self.wins = 0
        self.respawn_at = None

    def queue(self, d):
        if d not in DIRS:
            return
        last = self.pending[-1] if self.pending else self.dir
        if d == last or d == OPPOSITE[last]:
            return
        if len(self.pending) < 2:
            self.pending.append(d)


# ---------------------------------------------------------------- room
class Room:
    def __init__(self, code):
        self.code = code
        self.players = {}          # insertion-ordered
        self.host = None
        self.mode = "rounds"
        self.duration = 120
        self.speed = "normal"
        self.state = "lobby"       # lobby | countdown | playing
        self.w = self.h = GRID
        self.food = []
        self.countdown_end = 0.0
        self.end_time = 0.0
        self.results = None
        self.dirty = True
        self.task = None

    @property
    def tick(self):
        return BASE_TICK * SPEEDS[self.speed]

    # ------------------------------------------------ membership
    def add(self, name, ws):
        used = {p.color for p in self.players.values()}
        color = next((c for c in COLORS if c not in used), random.choice(COLORS))
        p = Player(next(_ids), name, ws, color)
        if self.host is None:
            self.host = p.id
        if self.state == "playing" and self.mode == "endless":
            p.respawn_at = time.monotonic() + 1.0      # drop in shortly
        self.players[p.id] = p
        self.dirty = True
        return p

    def remove(self, pid):
        self.players.pop(pid, None)
        if self.host == pid:
            self.host = next(iter(self.players), None)
        if self.state == "playing" and self.players:
            self.check_end(time.monotonic())
        self.dirty = True

    # ------------------------------------------------ board helpers
    def occupied(self):
        cells = set()
        for p in self.players.values():
            if p.alive:
                cells.update(p.body)
        return cells

    def place_food(self):
        target = max(1, len(self.players))
        if len(self.food) >= target:
            return
        taken = self.occupied() | set(self.food)
        free = [(x, y) for x in range(self.w) for y in range(self.h) if (x, y) not in taken]
        random.shuffle(free)
        while len(self.food) < target and free:
            self.food.append(free.pop())

    def spawn_fixed(self, i, p):
        w, h = self.w, self.h
        specs = [(3, h // 3, "right"), (w - 4, h - 1 - h // 3, "left"),
                 (w - 1 - w // 3, 3, "down"), (w // 3, h - 4, "up")]
        x, y, d = specs[i % len(specs)]
        dx, dy = DIRS[d]
        p.dir = d
        p.body = [(x - dx * k, y - dy * k) for k in range(START_LEN)]

    def spawn_random(self, p):
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
                p.body, p.dir = body, d
                return True
        return False

    # ------------------------------------------------ match flow
    def start_match(self):
        self.results = None
        self.food = []
        for i, p in enumerate(self.players.values()):
            p.score = 0
            p.pending = []
            p.respawn_at = None
            p.in_round = True
            p.alive = True
            self.spawn_fixed(i, p)
        self.place_food()
        self.state = "countdown"
        self.countdown_end = time.monotonic() + COUNTDOWN
        self.dirty = True

    def kill(self, p, now):
        p.alive = False
        p.body = []
        p.pending = []
        if self.mode == "endless":
            p.respawn_at = now + RESPAWN

    def step(self, now):
        if self.mode == "endless":
            for p in self.players.values():
                if not p.alive and p.respawn_at and now >= p.respawn_at:
                    if self.spawn_random(p):
                        p.alive, p.respawn_at, p.pending = True, None, []

        alive = [p for p in self.players.values() if p.alive]
        moves = {}
        for p in alive:
            if p.pending:
                p.dir = p.pending.pop(0)
            dx, dy = DIRS[p.dir]
            hx, hy = p.body[0]
            moves[p.id] = (hx + dx, hy + dy)

        food = set(self.food)
        grows = {pid: head in food for pid, head in moves.items()}

        # cells that will still be occupied after everyone moves (tails move away
        # unless that snake is growing); new heads are checked separately
        blocked = set()
        for p in alive:
            blocked.update(p.body if grows[p.id] else p.body[:-1])
        heads = Counter(moves.values())

        for p in alive:
            nx, ny = moves[p.id]
            out = not (0 <= nx < self.w and 0 <= ny < self.h)
            if out or (nx, ny) in blocked or heads[(nx, ny)] > 1:
                self.kill(p, now)
                continue
            p.body.insert(0, (nx, ny))
            if grows[p.id]:
                p.score += 1
                self.food.remove((nx, ny))
            else:
                p.body.pop()

        self.place_food()
        self.check_end(now)

    def check_end(self, now):
        if self.state != "playing":
            return
        if self.mode == "endless":
            if now >= self.end_time:
                self.finish()
            return
        in_round = [p for p in self.players.values() if p.in_round]
        alive = [p for p in in_round if p.alive]
        if (len(in_round) >= 2 and len(alive) <= 1) or not alive:
            self.finish()

    def finish(self):
        players = list(self.players.values())
        winner = None
        if self.mode == "rounds":
            in_round = [p for p in players if p.in_round]
            alive = [p for p in in_round if p.alive]
            if len(in_round) >= 2:
                if len(alive) == 1:
                    winner = alive[0]
                    title = f"{winner.name} wins the round!"
                else:
                    title = "Draw – everyone crashed"
            else:
                title = f"Game over – score {in_round[0].score if in_round else 0}"
            players.sort(key=lambda p: (p is not winner, -p.score))
        else:
            top = max((p.score for p in players), default=0)
            leaders = [p for p in players if p.score == top]
            if len(players) == 1:
                title = f"Time's up – score {top}"
            elif len(leaders) == 1:
                winner = leaders[0]
                title = f"{winner.name} wins with {top}!"
            else:
                title = f"Draw at {top} points"
            players.sort(key=lambda p: -p.score)
        if winner and len(self.players) > 1:
            winner.wins += 1
        self.results = {
            "title": title,
            "winner": winner.id if winner else None,
            "ranking": [{"id": p.id, "name": p.name, "color": p.color,
                         "score": p.score, "wins": p.wins} for p in players],
        }
        for p in self.players.values():
            p.in_round = False
            p.respawn_at = None
        self.state = "lobby"
        self.dirty = True

    # ------------------------------------------------ networking
    def snapshot(self):
        now = time.monotonic()
        countdown = 0
        if self.state == "countdown":
            countdown = max(1, int(self.countdown_end - now + 0.999))
        time_left = None
        if self.state == "playing" and self.mode == "endless":
            time_left = max(0, int(self.end_time - now + 0.999))
        return {
            "type": "state",
            "code": self.code,
            "state": self.state,
            "mode": self.mode,
            "duration": self.duration,
            "speed": self.speed,
            "host": self.host,
            "w": self.w,
            "h": self.h,
            "max": MAX_PLAYERS,
            "countdown": countdown,
            "time_left": time_left,
            "food": self.food,
            "results": self.results,
            "players": [{
                "id": p.id, "name": p.name, "color": p.color,
                "score": p.score, "wins": p.wins,
                "alive": p.alive, "in_round": p.in_round,
                "body": p.body, "dir": p.dir,
                "respawn": round(max(0.0, p.respawn_at - now), 1) if p.respawn_at else None,
            } for p in self.players.values()],
        }

    async def broadcast(self):
        msg = json.dumps(self.snapshot())
        for p in list(self.players.values()):
            try:
                await p.ws.send_str(msg)
            except Exception:
                pass

    async def run(self):
        try:
            while True:
                now = time.monotonic()
                if self.state == "countdown":
                    if now >= self.countdown_end:
                        self.state = "playing"
                        self.end_time = now + self.duration
                    self.dirty = True
                elif self.state == "playing":
                    self.step(now)
                    self.dirty = True
                if self.dirty:
                    self.dirty = False
                    await self.broadcast()
                busy = self.state in ("countdown", "playing")
                await asyncio.sleep(self.tick if busy else 0.05)
        except asyncio.CancelledError:
            raise
        except Exception:
            traceback.print_exc()


def new_room():
    while True:
        code = "".join(random.choice(CODE_CHARS) for _ in range(4))
        if code not in ROOMS:
            break
    room = Room(code)
    ROOMS[code] = room
    room.task = asyncio.create_task(room.run())
    return room


def clean_name(raw, room):
    name = " ".join(str(raw or "").split())[:NAME_MAX]
    return name or f"Player {len(room.players) + 1}"


# ---------------------------------------------------------------- web
async def index(request):
    return web.FileResponse(HERE / "index.html")


async def ws_handler(request):
    ws = web.WebSocketResponse(heartbeat=20)
    await ws.prepare(request)
    room = None
    me = None

    async def error(text):
        await ws.send_json({"type": "error", "msg": text})

    try:
        async for msg in ws:
            if msg.type != WSMsgType.TEXT:
                continue
            try:
                data = msg.json()
            except ValueError:
                continue
            if not isinstance(data, dict):
                continue
            kind = data.get("type")

            if me is None:
                if kind == "create":
                    room = new_room()
                elif kind == "join":
                    code = str(data.get("code", "")).strip().upper()
                    room = ROOMS.get(code)
                    if room is None:
                        await error("Room not found – check the code.")
                        continue
                    if len(room.players) >= MAX_PLAYERS:
                        room = None
                        await error(f"Room is full ({MAX_PLAYERS} players max).")
                        continue
                else:
                    continue
                me = room.add(clean_name(data.get("name"), room), ws)
                await ws.send_json({"type": "joined", "code": room.code, "you": me.id})
                continue

            if kind == "dir":
                me.queue(data.get("dir"))
            elif kind == "leave":
                break
            elif me.id == room.host and room.state == "lobby":
                if kind == "settings":
                    if data.get("mode") in ("rounds", "endless"):
                        room.mode = data["mode"]
                    if data.get("duration") in DURATIONS:
                        room.duration = data["duration"]
                    if data.get("speed") in SPEEDS:
                        room.speed = data["speed"]
                    room.dirty = True
                elif kind == "start":
                    room.start_match()
    finally:
        if room and me:
            room.remove(me.id)
            if not room.players:
                room.task.cancel()
                ROOMS.pop(room.code, None)
    return ws


def lan_ip():
    """Best guess of this PC's address on the local network."""
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(("10.255.255.255", 1))   # no packet is actually sent
        return s.getsockname()[0]
    except OSError:
        return "127.0.0.1"
    finally:
        s.close()


async def serve(port):
    app = web.Application()
    app.router.add_get("/", index)
    app.router.add_get("/ws", ws_handler)
    runner = web.AppRunner(app)
    await runner.setup()
    site = web.TCPSite(runner, "0.0.0.0", port)
    try:
        await site.start()
    except OSError:
        print(f"PORT_IN_USE: port {port} is already in use", flush=True)
        await runner.cleanup()
        sys.exit(1)
    # printed only once the port is really open (the launcher waits for this line)
    print("Snake server running", flush=True)
    print(f"  This PC : http://localhost:{port}", flush=True)
    print(f"  Phone   : http://{lan_ip()}:{port}   (same Wi-Fi)", flush=True)
    print("Ctrl+C to stop", flush=True)
    try:
        await asyncio.Event().wait()
    finally:
        await runner.cleanup()


def main():
    port = int(os.environ.get("PORT", 8000))   # Render sets PORT
    try:
        asyncio.run(serve(port))
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
