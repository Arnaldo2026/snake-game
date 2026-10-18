"""
Catalog of games available in the game room.

To add a game: write games/<id>.py with a class following the interface
described in games/snake.py, add it to GAMES below, and add the browser
part as static/games/<id>.js.
"""

from .asteroids import AsteroidsGame
from .battlezone import BattlezoneGame
from .lander import LanderGame
from .pong import PongGame
from .snake import SnakeGame
from .spacewars import SpaceWarsGame

GAMES = {g.id: g for g in (SnakeGame, SpaceWarsGame, AsteroidsGame, LanderGame, BattlezoneGame, PongGame)}
DEFAULT_GAME = "snake"
