"""
Catalog of games available in the game room.

To add a game: write games/<id>.py with a class following the interface
described in games/snake.py, add it to GAMES below, and add the browser
part as static/games/<id>.js.
"""

from .asteroids import AsteroidsGame
from .snake import SnakeGame
from .spacewars import SpaceWarsGame

GAMES = {g.id: g for g in (SnakeGame, SpaceWarsGame, AsteroidsGame)}
DEFAULT_GAME = "snake"
