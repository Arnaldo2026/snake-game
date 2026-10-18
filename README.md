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
| `games/spacewars.py` | Space Wars rules and physics: ships, star gravity, torpedoes, hyperspace, asteroids, solo training |
| `games/asteroids.py` | Asteroids rules and physics: 1-4 ships, splitting rocks, waves, saucers, lives |
| `games/lander.py` | Lunar Lander rules and physics: terrain with multiplier pads, 4 missions, variable throttle, fuel |
| `games/battlezone.py` | Battlezone simulation seen from above: twin-track tanks, obstacles, computer enemies (one player), versus (2-4) |
| `games/pong.py` | Pong Tennis: squash against the wall alone, 1 or 2 bars per side for 2-4 players |
| `static/index.html` | The page: home, lobby, game screen, join prompts, sounds |
| `static/games/snake.js` | Snake drawing, scoreboard, sounds and controls (runs in the browser) |
| `static/games/spacewars.js` | Space Wars vector drawing, scoreboard, sounds and controls |
| `static/games/asteroids.js` | Asteroids vector drawing, scoreboard with lives, sounds and controls |
| `static/games/lander.js` | Lunar Lander drawing with auto-zoom, cabinet readouts, engine sound, thrust lever |
| `static/games/battlezone.js` | Battlezone first-person wireframe 3D view, radar, warnings, arena map, sounds |
| `static/games/pong.js` | Pong Tennis court, block-digit scores, classic beeps, knob-style lever |
| `static/games/<id>.svg` | Picture of each game for the home screen |

## Run locally

    pip install -r requirements.txt
    python server.py

Then open http://localhost:8000, or the phone address it prints (same Wi-Fi).

## Adding a game

1. Write `games/<id>.py` with a class that follows the interface described at
   the top of `games/snake.py`, and add it to `GAMES` in `games/__init__.py`.
2. Write `static/games/<id>.js` that registers `window.GAMES["<id>"]` with a
   `render(api)` function, its `controls` (keys and on-screen buttons; `hold: true`
   for press-and-hold controls; a pad item with `type: "lever"` gives a vertical slider) and optionally `sounds`, `liveInfo`, `status`.
3. Draw a picture for the home screen as `static/games/<id>.svg`.

The new game then appears in the game list and on the home screen, and its settings in the lobby.

## Deploy

Hosted on Render as a Python web service: build `pip install -r requirements.txt`,
start `python server.py`. Every commit to `main` redeploys automatically.
