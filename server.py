"""
Game Room - multiplayer game server (server-authoritative).

Players create or join a room with a 4-letter code. The room creator is the
host: they choose the game and its settings, and start each match. The game
rules live in the games/ package; this file handles everything shared:
rooms, players, host, lobby, notices, and players arriving mid-match.

Someone joining while a match is running waits in the room. Everyone gets a
notice, and the host can restart with them, let them in now (if the game
allows dropping in) or let them wait for the next match.

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
from pathlib import Path

from aiohttp import WSMsgType, web

from games import DEFAULT_GAME, GAMES

NAME_MAX = 12
COLORS = ["#4ade80", "#60a5fa", "#fb923c", "#f472b6", "#facc15", "#a78bfa", "#2dd4bf", "#f87171"]
CODE_CHARS = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"           # no 0/O, 1/I/L
# each game has a picture at static/games/<id>.svg for the home screen
CATALOG = [{"id": g.id, "name": g.name, "max": g.max_players,
            "image": f"/static/games/{g.id}.svg"} for g in GAMES.values()]

HERE = Path(__file__).resolve().parent
STATIC = HERE / "static"

ROOMS = {}
_ids = itertools.count(1)


class Player:
    def __init__(self, pid, name, ws, color):
        self.id = pid
        self.name = name
        self.ws = ws
        self.color = color
        self.wins = 0
        self.waiting = False       # arrived during a match, waits to be let in
        self.quit = False          # left the current match


class Room:
    def __init__(self, code, game_id):
        self.code = code
        self.players = {}          # insertion-ordered
        self.host = None
        self.state = "lobby"       # lobby | match
        self.results = None
        self.notices = []          # sent with the next state message
        self.dirty = True
        self.task = None
        self.set_game(game_id)

    def set_game(self, game_id):
        self.game_id = game_id
        self.game = GAMES[game_id](self)
        self.results = None
        self.dirty = True

    def notice(self, kind, p):
        self.notices.append({"kind": kind, "pid": p.id, "name": p.name})
        self.dirty = True

    # ------------------------------------------------ membership
    def add(self, name, ws):
        used = {p.color for p in self.players.values()}
        color = next((c for c in COLORS if c not in used), random.choice(COLORS))
        p = Player(next(_ids), name, ws, color)
        if self.host is None:
            self.host = p.id
        if self.state == "match":
            p.waiting = True
        self.players[p.id] = p
        self.notice("join", p)
        return p

    def remove(self, pid):
        p = self.players.pop(pid, None)
        if not p:
            return
        self.notice("leave", p)
        if self.state == "match":
            self.game.remove(pid)
        if self.host == pid:
            self.host = next(iter(self.players), None)
            if self.host:
                self.notice("host", self.players[self.host])

    # ------------------------------------------------ match flow
    def start_match(self):
        self.results = None
        for p in self.players.values():
            p.waiting = p.quit = False
        self.game.start(list(self.players))
        self.state = "match"
        self.dirty = True

    def quit_match(self, p):
        if self.state != "match" or p.quit or p.waiting:
            return
        p.quit = True
        self.game.quit(p.id)
        self.dirty = True

    def admit(self, pid, action):
        p = self.players.get(pid)
        if self.state != "match" or not p or not p.waiting:
            return
        if action == "restart":
            self.start_match()
        elif action == "now" and self.game.can_drop_in():
            self.game.drop_in(pid)
            p.waiting = False
            self.dirty = True

    def finish_match(self):
        r = self.game.results or {"title": "Match over", "winner": None, "ranking": []}
        winner = self.players.get(r.get("winner"))
        played = len(r.get("ranking", []))
        if winner and played > 1:
            winner.wins += 1
        ranking = []
        for row in r.get("ranking", []):
            p = self.players.get(row["id"])
            if p:
                ranking.append({**row, "name": p.name, "color": p.color, "wins": p.wins})
        self.results = {**r, "ranking": ranking}
        for p in self.players.values():
            p.waiting = p.quit = False
        self.state = "lobby"
        self.dirty = True

    # ------------------------------------------------ networking
    def snapshot(self):
        return {
            "type": "state",
            "code": self.code,
            "state": self.state,
            "host": self.host,
            "games": CATALOG,
            "game_id": self.game_id,
            "game_name": self.game.name,
            "schema": self.game.SETTINGS,
            "settings": self.game.settings,
            "max": self.game.max_players,
            "can_drop_in": self.state == "match" and self.game.can_drop_in(),
            "results": self.results,
            "notices": self.notices,
            "players": [{"id": p.id, "name": p.name, "color": p.color, "wins": p.wins,
                         "waiting": p.waiting, "quit": p.quit} for p in self.players.values()],
            "game": self.game.snapshot(),
        }

    async def broadcast(self):
        msg = json.dumps(self.snapshot())
        self.notices = []
        for p in list(self.players.values()):
            try:
                await p.ws.send_str(msg)
            except Exception:
                pass

    async def run(self):
        try:
            while True:
                if self.state == "match":
                    if self.game.update(time.monotonic()):
                        self.dirty = True
                    if not self.game.running:
                        self.finish_match()
                if self.dirty:
                    self.dirty = False
                    await self.broadcast()
                await asyncio.sleep(self.game.tick() if self.state == "match" else 0.05)
        except asyncio.CancelledError:
            raise
        except Exception:
            traceback.print_exc()


def new_room(game_id):
    while True:
        code = "".join(random.choice(CODE_CHARS) for _ in range(4))
        if code not in ROOMS:
            break
    room = Room(code, game_id if game_id in GAMES else DEFAULT_GAME)
    ROOMS[code] = room
    room.task = asyncio.create_task(room.run())
    return room


def clean_name(raw, room):
    name = " ".join(str(raw or "").split())[:NAME_MAX]
    return name or f"Player {len(room.players) + 1}"


# ---------------------------------------------------------------- web
async def index(request):
    return web.FileResponse(STATIC / "index.html")


async def ws_handler(request):
    ws = web.WebSocketResponse(heartbeat=20)
    await ws.prepare(request)
    room = None
    me = None
    await ws.send_json({"type": "hello", "games": CATALOG})   # game list for the home screen

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
                    room = new_room(data.get("game"))
                elif kind == "join":
                    code = str(data.get("code", "")).strip().upper()
                    room = ROOMS.get(code)
                    if room is None:
                        await error("Room not found – check the code.")
                        continue
                    if len(room.players) >= room.game.max_players:
                        room = None
                        await error("Room is full.")
                        continue
                else:
                    continue
                me = room.add(clean_name(data.get("name"), room), ws)
                await ws.send_json({"type": "joined", "code": room.code, "you": me.id})
                continue

            is_host = me.id == room.host
            if kind == "input":
                if room.state == "match" and not me.waiting:
                    room.game.input(me.id, data)
            elif kind == "quit":
                room.quit_match(me)
            elif kind == "leave":
                break
            elif kind == "admit" and is_host:
                room.admit(data.get("pid"), data.get("action"))
            elif is_host and room.state == "lobby":
                if kind == "setting":
                    if room.game.set_setting(data.get("key"), data.get("value")):
                        room.dirty = True
                elif kind == "game" and data.get("id") in GAMES and data["id"] != room.game_id:
                    room.set_game(data["id"])
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
    app.router.add_static("/static", STATIC)
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
