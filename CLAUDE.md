# Game Room (snake-game)

- Every push to `main` must bump `VERSION` (patch = fix, minor = new feature/game) and add a dated line to
  `CHANGELOG.md`. The home screen shows the version, and open pages offer a reload when the server's differs.
- Each game: `games/<id>.py` (server rules) + `static/games/<id>.js` (drawing) + `static/games/<id>.svg`,
  registered in `games/__init__.py`.
