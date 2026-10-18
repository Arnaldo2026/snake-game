"""
Catalog of games available in the game room.

To add a game: write games/<id>.py with a class following the interface
described in games/snake.py, add it to GAMES below, and add the browser
part as static/games/<id>.js.
"""

from .snake import SnakeGame

GAMES = {g.id: g for g in (SnakeGame,)}
DEFAULT_GAME = "snake"
