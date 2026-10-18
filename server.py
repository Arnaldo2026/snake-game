"""
Snake - single-player test version (server-authoritative).

The server owns the game: it runs the tick loop, moves the snake, checks
collisions and sends the board to the browser over a WebSocket.
The browser only draws the board and sends direction changes.
This is the same architecture the multiplayer version will use.

Run:   python server.py
Open:  http://localhost:8000          (on this PC)
       http://<LAN-IP>:8000           (on a phone on the same Wi-Fi)
"""

import asyncio
import os
import random
import socket
import sys
from pathlib import Path

from aiohttp import WSMsgType, web

# ---------------------------------------------------------------- settings
# Grid size and speed can be set from outside (the launcher GUI does this)
GRID_W = GRID_H = int(os.environ.get("SNAKE_GRID", 20))
TICK_START = float(os.environ.get("SNAKE_TICK", 0.14))  # seconds per move at score 0
TICK_MIN = TICK_START * 0.5                             # fastest speed
TICK_SPEEDUP = 0.003                                    # seconds removed per point

HERE = Path(__file__).resolve().parent

DIRS = {"up": (0, -1), "down": (0, 1), "left": (-1, 0), "right": (1, 0)}
OPPOSITE = {"up": "down", "down": "up", "left": "right", "right": "left"}


# ---------------------------------------------------------------- game
class Game:
    def __init__(self):
        self.reset()

    def reset(self):
        cx, cy = GRID_W // 2, GRID_H // 2
        self.snake = [(cx, cy), (cx - 1, cy), (cx - 2, cy)]
        self.direction = "right"
        self.pending = []          # buffered turns (max 2) for quick inputs
        self.score = 0
        self.alive = True
        self.running = False
        self.won = False
        self.food = self._place_food()

    def _place_food(self):
        occupied = set(self.snake)
        free = [(x, y) for x in range(GRID_W) for y in range(GRID_H)
                if (x, y) not in occupied]
        return random.choice(free) if free else None

    @property
    def tick(self):
        return max(TICK_MIN, TICK_START - self.score * TICK_SPEEDUP)

    def queue_direction(self, d):
        if d not in DIRS:
            return
        last = self.pending[-1] if self.pending else self.direction
        if d == last or d == OPPOSITE[last]:
            return                  # no reversing into yourself
        if len(self.pending) < 2:
            self.pending.append(d)

    def start(self):
        if not self.alive:
            self.reset()
        self.running = True

    def step(self):
        if not (self.running and self.alive):
            return
        if self.pending:
            self.direction = self.pending.pop(0)
        dx, dy = DIRS[self.direction]
        hx, hy = self.snake[0]
        head = (hx + dx, hy + dy)

        grows = head == self.food
        body = self.snake if grows else self.snake[:-1]   # tail moves away
        hit_wall = not (0 <= head[0] < GRID_W and 0 <= head[1] < GRID_H)
        if hit_wall or head in body:
            self.alive = False
            self.running = False
            return

        self.snake.insert(0, head)
        if grows:
            self.score += 1
            self.food = self._place_food()
            if self.food is None:          # board full
                self.won = True
                self.alive = False
                self.running = False
        else:
            self.snake.pop()

    def state(self):
        return {
            "type": "state",
            "w": GRID_W,
            "h": GRID_H,
            "snake": self.snake,
            "dir": self.direction,
            "food": self.food,
            "score": self.score,
            "alive": self.alive,
            "running": self.running,
            "won": self.won,
        }


# ---------------------------------------------------------------- web
async def index(request):
    return web.FileResponse(HERE / "index.html")


async def ws_handler(request):
    ws = web.WebSocketResponse(heartbeat=20)
    await ws.prepare(request)
    game = Game()

    async def send_state():
        if not ws.closed:
            try:
                await ws.send_json(game.state())
            except (ConnectionResetError, RuntimeError):
                pass

    async def loop():
        while not ws.closed:
            if game.running:
                game.step()
                await send_state()
            await asyncio.sleep(game.tick)

    loop_task = asyncio.create_task(loop())
    await send_state()

    try:
        async for msg in ws:
            if msg.type != WSMsgType.TEXT:
                continue
            try:
                data = msg.json()
            except ValueError:
                continue
            kind = data.get("type")
            if kind == "dir":
                game.queue_direction(data.get("dir"))
            elif kind == "start":
                if not game.running:
                    game.start()
                    await send_state()
    finally:
        loop_task.cancel()
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
    # printed only once the port is really open
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
