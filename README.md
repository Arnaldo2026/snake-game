# Game Room

Multiplayer browser games for phones and PCs. One player creates a room, picks
a game and its settings, and friends join with the 4-letter room code, the
link, or the QR code.

## Layout

| Path | What it is |
|---|---|
| `server.py` | Platform: rooms, players, host, lobby, notices, players arriving mid-match |
| `games/__init__.py` | Catalog of available games |
| `games/snake.py` | Snake rules and its lobby settings (runs on the server) |
| `static/index.html` | The page: home, lobby, game screen, join prompts, sounds |
| `static/games/snake.js` | Snake drawing, scoreboard and sounds (runs in the browser) |

## Run locally

    pip install -r requirements.txt
    python server.py

Then open http://localhost:8000, or the phone address it prints (same Wi-Fi).

## Adding a game

1. Write `games/<id>.py` with a class that follows the interface described at
   the top of `games/snake.py`, and add it to `GAMES` in `games/__init__.py`.
2. Write `static/games/<id>.js` that registers `window.GAMES["<id>"]` with a
   `render(api)` function (and optionally `sounds`, `liveInfo`, `status`).

The new game then appears in the game list, and its settings in the lobby.

## Deploy

Hosted on Render as a Python web service: build `pip install -r requirements.txt`,
start `python server.py`. Every commit to `main` redeploys automatically.
