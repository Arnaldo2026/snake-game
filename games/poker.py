"""
Poker for the game room platform: Texas Hold'em or Five-card draw (the host chooses).

Same interface as games/snake.py, plus snapshot_for(pid): every player gets their own
view, so nobody's hidden cards ever leave the server (except in Demo mode, where all
cards are face up on purpose).

* Alone in the room you play against computer players; with two or more people at the
  table everybody is human.
* Everyone starts with the same chips. Blinds each hand; the raises allowed in one
  betting round are capped (setting). No-limit sizes otherwise, with side pots for
  all-ins. The match lasts a set number of hands or until one player has every chip.
* Modes: Normal; Advice (hints on your own cards: hand, chance to win, pot odds, a
  suggested action, which cards to change); Demo (every card face up + advice for all).

Inputs: {"action": "fold" | "check" | "call" | "raise" | "allin", "to": total bet}
        {"action": "draw", "cards": [indices of the cards to change]}  (Five-card draw)
Cards are numbers 0..51: rank = card // 4 + 2 (2..14, 14 = Ace), suit = card % 4 (♠ ♥ ♦ ♣).
"""

import math
import random
import time
from collections import Counter

COUNTDOWN = 2.0
SHOWDOWN_PAUSE = 5.5           # seconds to look at the result of a hand
FOLD_PAUSE = 2.5               # result when everybody else folded
RUNOUT_STEP = 1.3              # all-in: the rest of the board is dealt slowly
STREET_PAUSE = 0.6             # after a new card on the board, before the next action
MAX_SEATS = 6
MAX_DRAW = 4                   # Five-card draw: change up to 4 cards
SIMS = 300                     # Monte Carlo deals for the chance to win

BOTS = [("Ada", "#c4b5fd"), ("Bruno", "#fca5a5"), ("Carla", "#fde68a"), ("Dario", "#a7f3d0"), ("Elsa", "#93c5fd")]

CATEGORY = ["High card", "One pair", "Two pair", "Three of a kind", "Straight", "Flush",
            "Full house", "Four of a kind", "Straight flush"]
RANK_NAME = {2: "Two", 3: "Three", 4: "Four", 5: "Five", 6: "Six", 7: "Seven", 8: "Eight", 9: "Nine",
             10: "Ten", 11: "Jack", 12: "Queen", 13: "King", 14: "Ace"}
RANK_PLURAL = {6: "Sixes"}


def plural(r):
    return RANK_PLURAL.get(r, RANK_NAME[r] + "s")


# ---------------------------------------------------------------- hand evaluation
def straight_high(ranks):
    s = set(ranks)
    if 14 in s:
        s.add(1)                                   # the Ace also plays low: A-2-3-4-5
    for hi in range(14, 4, -1):
        if all(r in s for r in range(hi - 4, hi + 1)):
            return hi
    return 0


def evaluate(cards):
    """Best poker hand among 1..7 cards, as a tuple that compares correctly
    (category first, then the ranks that break ties). Suits never break ties."""
    ranks = [c // 4 + 2 for c in cards]
    suits = [c % 4 for c in cards]
    flush_suit = None
    if len(cards) >= 5:
        for s, n in Counter(suits).items():
            if n >= 5:
                flush_suit = s
    if flush_suit is not None:
        fr = sorted((r for r, s in zip(ranks, suits) if s == flush_suit), reverse=True)
        sf = straight_high(fr)
        if sf:
            return (8, sf)
    counts = Counter(ranks)
    quads = [r for r, n in counts.items() if n == 4]
    if quads:
        q = max(quads)
        rest = [r for r in ranks if r != q]
        return (7, q, max(rest)) if rest else (7, q)
    trips = sorted((r for r, n in counts.items() if n == 3), reverse=True)
    pairs = sorted((r for r, n in counts.items() if n == 2), reverse=True)
    if trips and (len(trips) > 1 or pairs):
        return (6, trips[0], max(trips[1:2] + pairs[:1]))
    if flush_suit is not None:
        return (5, *fr[:5])
    st = straight_high(ranks) if len(cards) >= 5 else 0
    if st:
        return (4, st)
    if trips:
        t = trips[0]
        return (3, t, *sorted((r for r in ranks if r != t), reverse=True)[:2])
    if len(pairs) >= 2:
        a, b = pairs[0], pairs[1]
        rest = [r for r in ranks if r not in (a, b)]
        return (2, a, b, max(rest)) if rest else (2, a, b)
    if pairs:
        p = pairs[0]
        return (1, p, *sorted((r for r in ranks if r != p), reverse=True)[:3])
    return (0, *sorted(ranks, reverse=True)[:5])


def describe(ev):
    cat = ev[0]
    if cat == 8:
        return "Royal flush" if ev[1] == 14 else f"Straight flush, {RANK_NAME[ev[1]]} high"
    if cat == 7:
        return f"Four {plural(ev[1])}"
    if cat == 6:
        return f"Full house, {plural(ev[1])} full of {plural(ev[2])}"
    if cat == 5:
        return f"Flush, {RANK_NAME[ev[1]]} high"
    if cat == 4:
        return f"Straight, {RANK_NAME[ev[1]]} high"
    if cat == 3:
        return f"Three {plural(ev[1])}"
    if cat == 2:
        return f"Two pair, {plural(ev[1])} and {plural(ev[2])}"
    if cat == 1:
        return f"Pair of {plural(ev[1])}"
    return f"{RANK_NAME[ev[1]]} high" if len(ev) > 1 else "Nothing"


def describe_start(cards):
    """Two Hold'em cards before the flop: 'Pair of Queens', 'Ace-King suited', ..."""
    a, b = sorted(cards, key=lambda c: -(c // 4))
    ra, rb = a // 4 + 2, b // 4 + 2
    if ra == rb:
        return f"Pair of {plural(ra)}"
    suited = " suited" if a % 4 == b % 4 else ""
    return f"{RANK_NAME[ra]}-{RANK_NAME[rb]}{suited}"


def discard_plan(cards):
    """Five-card draw: which cards to change (indices) and why. Used by the computer
    players and by the advice."""
    if len(cards) != 5:
        return [], ""
    ev = evaluate(cards)
    cat = ev[0]
    ranks = [c // 4 + 2 for c in cards]
    if cat >= 4:
        return [], f"{describe(ev)} – a made hand: keep all five (stand pat)."
    if cat == 3:
        return [i for i, r in enumerate(ranks) if r != ev[1]], f"Keep the three {plural(ev[1])}, change the other two."
    if cat == 2:
        return [i for i, r in enumerate(ranks) if r not in (ev[1], ev[2])], \
            f"Keep both pairs, change the odd card: 1 chance in 11 to make a full house."
    suits = [c % 4 for c in cards]
    four_suit = [s for s, n in Counter(suits).items() if n == 4]
    if four_suit and cat < 1:
        return [i for i, s in enumerate(suits) if s != four_suit[0]], \
            "Four cards of the same suit: change the fifth, about 1 chance in 5 to make a flush."
    if cat == 1:
        return [i for i, r in enumerate(ranks) if r != ev[1]], \
            f"Keep the pair of {plural(ev[1])} and change three cards."
    if four_suit:
        return [i for i, s in enumerate(suits) if s != four_suit[0]], "Four to a flush: change the fifth card."
    # four to an open-ended straight (e.g. 5-6-7-8): change the fifth
    uniq = sorted(set(ranks))
    for lo in range(2, 11):
        run = set(range(lo, lo + 4))
        if run <= set(uniq) and lo + 3 < 14:
            odd = [i for i, r in enumerate(ranks) if r not in run]
            if len(odd) == 1:
                return odd, "Four in a row, open at both ends: change the fifth, about 1 chance in 6 for a straight."
    keep = max(range(5), key=lambda i: ranks[i])
    return [i for i in range(5) if i != keep], \
        f"Nothing yet: keep your highest card ({RANK_NAME[ranks[keep]]}) and change four."


# ---------------------------------------------------------------- table
class Seat:
    def __init__(self, pid, name, color, chips, bot=False):
        self.pid = pid             # room player id, or a negative number for a computer player
        self.name = name
        self.color = color
        self.bot = bot
        self.chips = chips
        self.style = random.uniform(0.85, 1.2) if bot else 1.0     # computer: tighter (<1) or looser
        self.out = False           # no chips left
        self.out_hand = 0          # the hand they went broke in (for the final ranking)
        self.left = False          # quit the match
        self.waiting = False       # joined during the match: dealt in from the next hand
        self.reset()

    def reset(self):
        self.cards = []
        self.folded = False
        self.allin = False
        self.bet = 0               # put in during this betting round
        self.total = 0             # put in during this hand
        self.acted = False
        self.action = ""           # last action, shown on the table
        self.drew = None           # Five-card draw: how many cards changed (None = not yet)
        self.shown = False         # cards turned face up for everybody (showdown)
        self.won = 0

    @property
    def live(self):
        return bool(self.cards) and not self.folded

    @property
    def can_act(self):
        return self.live and not self.allin


class PokerGame:
    id = "poker"
    name = "Poker"
    max_players = MAX_SEATS
    SETTINGS = [
        {"key": "variant", "label": "Variant", "default": "holdem",
         "options": [["holdem", "Texas Hold'em"], ["draw", "Five-card draw"]],
         "hints": {"holdem": "2 cards each + 5 shared on the table (flop, turn, river). Four betting rounds.",
                   "draw": "5 cards each, a betting round, change up to 4 cards, a second betting round."}},
        {"key": "mode", "label": "Mode", "default": "advice",
         "options": [["normal", "Normal"], ["advice", "Advice"], ["demo", "Demo"]],
         "hints": {"normal": "Real poker: you see only your own cards.",
                   "advice": "Hints on your own hand: what you hold, your chance to win, a suggested move.",
                   "demo": "Learning table: every card is face up and everybody gets advice."}},
        {"key": "chips", "label": "Starting chips", "default": 1000,
         "options": [[500, "500"], [1000, "1,000"], [2000, "2,000"]]},
        {"key": "blinds", "label": "Blinds", "default": 20,
         "options": [[10, "5 / 10"], [20, "10 / 20"], [50, "25 / 50"]],
         "hints": {10: "Small blind / big blind: the two forced bets that start each hand."}},
        {"key": "cap", "label": "Raises per round", "default": 3,
         "options": [[2, "2"], [3, "3"], [4, "4"], [0, "No cap"]],
         "hints": {2: "After the first bet, at most 2 raises in each betting round.",
                   3: "After the first bet, at most 3 raises in each betting round.",
                   4: "After the first bet, at most 4 raises in each betting round.",
                   0: "Players may re-raise without limit."}},
        {"key": "hands", "label": "Match", "default": 20,
         "options": [[10, "10 hands"], [20, "20 hands"], [0, "Last one standing"]]},
        {"key": "bots", "label": "Computer players (when alone)", "default": 3,
         "options": [[1, "1"], [2, "2"], [3, "3"], [4, "4"], [5, "5"]],
         "hints": {1: "Playing alone you face the computer; with friends in the room all players are human."}},
        {"key": "timer", "label": "Time to act", "default": 40,
         "options": [[20, "20 s"], [40, "40 s"], [0, "No limit"]],
         "hints": {20: "When time runs out you check if you can, otherwise you fold.",
                   40: "When time runs out you check if you can, otherwise you fold."}},
    ]

    def __init__(self, room):
        self.room = room
        self.settings = {s["key"]: s["default"] for s in self.SETTINGS}
        self.running = False
        self.results = None
        self.seats = []
        self.phase = "idle"        # idle | countdown | betting | draw | runout | showdown | over
        self.hand_no = 0
        self.board = []
        self.deck = []
        self.muck = []
        self.dealer = -1
        self.street = 0
        self.to_act = None
        self.current_bet = 0
        self.min_raise = 0
        self.raises = 0
        self.next_at = 0.0
        self.act_at = 0.0
        self.deadline = None
        self.last_sec = None
        self.result = None
        self.ev = {"deal": 0, "card": 0, "chips": 0, "check": 0, "fold": 0, "win": 0, "turn": 0, "allin": 0}
        self.cache = {}
        self.bust_order = 0

    # ------------------------------------------------ settings
    def set_setting(self, key, value):
        for s in self.SETTINGS:
            if s["key"] == key and value in [o[0] for o in s["options"]]:
                self.settings[key] = value
                return True
        return False

    @property
    def holdem(self):
        return self.settings["variant"] == "holdem"

    @property
    def bb(self):
        return self.settings["blinds"]

    @property
    def sb(self):
        return self.bb // 2

    def tick(self):
        return 0.1 if self.running else 0.5

    # ------------------------------------------------ match flow
    def start(self, pids):
        chips = self.settings["chips"]
        self.seats = []
        for pid in pids:
            p = self.room.players.get(pid)
            self.seats.append(Seat(pid, p.name if p else "?", p.color if p else "#fff", chips))
        if len(pids) == 1:
            for k, (name, color) in enumerate(BOTS[:self.settings["bots"]]):
                self.seats.append(Seat(-(k + 1), name, color, chips, bot=True))
        if len(pids) > 1:
            random.shuffle(self.seats)                  # random seating at a table of friends
        self.dealer = random.randrange(len(self.seats))
        self.hand_no = 0
        self.result = None
        self.results = None
        self.board = []
        self.running = True
        self.phase = "countdown"
        self.next_at = time.monotonic() + COUNTDOWN
        self.bust_order = 0

    def players(self):
        return [s for s in self.seats if not s.out and not s.left and not s.waiting]

    def nxt(self, i, pred):
        n = len(self.seats)
        for k in range(1, n + 1):
            j = (i + k) % n
            if pred(self.seats[j]):
                return j
        return None

    def new_hand(self, now):
        self.cache = {}
        for s in self.seats:
            s.reset()
            s.waiting = False if not s.left else s.waiting
            if s.chips <= 0 and not s.out and not s.left:
                s.out = True
                self.bust_order += 1
                s.out_hand = self.bust_order
        playing = self.players()
        humans = [s for s in playing if not s.bot]
        limit = self.settings["hands"]
        if len(playing) < 2 or not humans or (limit and self.hand_no >= limit):
            self.finish()
            return
        self.hand_no += 1
        self.result = None
        in_game = lambda s: not s.out and not s.left and not s.waiting
        self.dealer = self.nxt(self.dealer, in_game)
        self.deck = list(range(52))
        random.shuffle(self.deck)
        self.muck = []
        self.board = []
        n_cards = 2 if self.holdem else 5
        for s in playing:
            s.cards = [self.deck.pop() for _ in range(n_cards)]
        if len(playing) == 2:                       # heads-up: the dealer posts the small blind
            sb_i = self.dealer
        else:
            sb_i = self.nxt(self.dealer, in_game)
        bb_i = self.nxt(sb_i, in_game)
        self.post(sb_i, self.sb, "Small blind")
        self.post(bb_i, self.bb, "Big blind")
        self.current_bet = self.bb
        self.min_raise = self.bb
        self.raises = 0
        self.street = 0
        self.phase = "betting"
        self.ev["deal"] += 1
        first = self.nxt(bb_i, lambda s: s.can_act)
        if first is None or self.count(lambda s: s.can_act) == 0 or \
                (self.count(lambda s: s.can_act) == 1 and self.seats[first].bet >= self.current_bet):
            self.end_round(now)
        else:
            self.set_turn(first, now)

    def post(self, i, amount, label):
        s = self.seats[i]
        a = min(amount, s.chips)
        s.chips -= a
        s.bet += a
        s.total += a
        s.action = f"{label} {a}"
        if s.chips == 0:
            s.allin = True

    def count(self, pred):
        return sum(1 for s in self.seats if pred(s))

    def pot_total(self):
        return sum(s.total for s in self.seats)

    def set_turn(self, i, now, delay=0.0):
        self.to_act = i
        s = self.seats[i]
        self.ev["turn"] += 1
        if s.bot:
            self.act_at = now + delay + random.uniform(0.9, 1.9)
            self.deadline = None
        else:
            t = self.settings["timer"]
            self.deadline = now + delay + t if t else None

    def finish(self):
        self.running = False
        self.phase = "over"
        self.to_act = None
        order = sorted(self.seats, key=lambda s: (-(s.chips if not s.out else 0), -s.out_hand))
        top = order[0]
        bots = any(s.bot for s in self.seats)
        if bots:
            me = next((s for s in self.seats if not s.bot), None)
            place = order.index(me) + 1 if me else 0
            title = (f"You win! {me.chips:,} chips" if place == 1 else
                     f"{top.name} wins · you finish {place}{['st', 'nd', 'rd'][place - 1] if place <= 3 else 'th'} "
                     f"with {me.chips:,} chips") if me else "Match over"
        else:
            title = f"{top.name} wins with {top.chips:,} chips"
        self.results = {
            "title": title,
            "winner": top.pid if not top.bot else None,
            "ranking": [{"id": s.pid, "score": s.chips} for s in order if not s.bot],
        }

    def update(self, now):
        if not self.running:
            return False
        changed = False
        if self.phase == "countdown" and now >= self.next_at:
            self.new_hand(now)
            return True
        if self.phase == "showdown" and now >= self.next_at:
            self.new_hand(now)
            return True
        if self.phase == "runout" and now >= self.next_at:
            if self.street < 3:
                self.street += 1
                self.deal_board()
                self.next_at = now + RUNOUT_STEP
            else:
                self.showdown(now)
            return True
        if self.phase in ("betting", "draw") and self.to_act is not None:
            s = self.seats[self.to_act]
            if s.bot and now >= self.act_at:
                self.bot_act(self.to_act, now)
                return True
            if not s.bot and self.deadline and now >= self.deadline:
                if self.phase == "draw":
                    self.do_draw(self.to_act, [], now)
                elif s.bet >= self.current_bet:
                    self.act(self.to_act, "check", 0, now)
                else:
                    self.act(self.to_act, "fold", 0, now)
                return True
            if self.deadline:
                sec = math.ceil(self.deadline - now)
                if sec != self.last_sec:
                    self.last_sec = sec
                    changed = True
        if not self.players() or not any(not s.bot for s in self.players()):
            self.finish()
            return True
        return changed

    # ------------------------------------------------ betting
    def options(self, i):
        s = self.seats[i]
        to_call = max(0, self.current_bet - s.bet)
        call = min(to_call, s.chips)
        others = self.count(lambda o: o is not s and o.can_act)
        cap = self.settings["cap"]
        capped = bool(cap) and self.current_bet > 0 and self.raises >= cap
        can_raise = s.chips > to_call and others > 0 and not capped
        min_to = (self.current_bet + self.min_raise) if self.current_bet else self.bb
        max_to = s.bet + s.chips
        return {"to_call": to_call, "call": call, "can_check": to_call == 0,
                "can_raise": can_raise, "capped": capped,
                "min_to": min(min_to, max_to), "max_to": max_to,
                "word": "Raise" if self.current_bet else "Bet"}

    def act(self, i, action, to, now):
        s = self.seats[i]
        o = self.options(i)
        if action == "check" and not o["can_check"]:
            action = "call"
        if action == "allin":
            to = o["max_to"]
            action = "raise" if o["can_raise"] and to > self.current_bet else "call"
        if action == "raise" and not o["can_raise"]:
            action = "call" if o["to_call"] else "check"
        if action == "fold":
            s.folded = True
            s.action = "Fold"
            self.muck += s.cards
            self.ev["fold"] += 1
        elif action == "check":
            s.action = "Check"
            self.ev["check"] += 1
        elif action == "call":
            add = o["call"]
            s.chips -= add
            s.bet += add
            s.total += add
            if s.chips == 0:
                s.allin = True
            s.action = "All-in " + str(s.bet) if s.allin else (f"Call {add}" if add else "Check")
            self.ev["chips" if add else "check"] += 1
        elif action == "raise":
            to = max(o["min_to"], min(o["max_to"], int(to or 0)))
            add = to - s.bet
            s.chips -= add
            s.bet = to
            s.total += add
            if s.chips == 0:
                s.allin = True
            inc = to - self.current_bet
            word = o["word"]
            if inc >= self.min_raise:
                self.min_raise = inc
                if self.current_bet:
                    self.raises += 1
            self.current_bet = max(self.current_bet, to)
            for other in self.seats:
                if other is not s:
                    other.acted = False
            s.action = f"All-in {to}" if s.allin else (f"{word} {to}" if word == "Bet" else f"Raise to {to}")
            self.ev["allin" if s.allin else "chips"] += 1
        else:
            return
        s.acted = True
        self.advance(i, now)

    def advance(self, i, now):
        if self.count(lambda s: s.live) == 1:
            self.fold_win(now)
            return
        pending = lambda s: s.can_act and (not s.acted or s.bet < self.current_bet)
        if not any(pending(s) for s in self.seats):
            self.end_round(now)
            return
        nxt = self.nxt(i, pending)
        self.set_turn(nxt, now)

    def collect(self):
        for s in self.seats:
            s.bet = 0
            s.acted = False
        self.current_bet = 0
        self.min_raise = self.bb
        self.raises = 0

    def deal_board(self):
        n = 3 if self.street == 1 else 1
        self.board += [self.deck.pop() for _ in range(n)]
        self.ev["card"] += 1

    def end_round(self, now):
        self.collect()
        self.to_act = None
        self.deadline = None
        actors = self.count(lambda s: s.can_act)
        if self.holdem:
            if self.street == 3:
                self.showdown(now)
                return
            self.street += 1
            self.deal_board()
            if actors <= 1:
                for s in self.seats:
                    if s.live:
                        s.shown = True             # all-in: hands are turned up, the board is dealt out
                self.phase = "runout"
                self.next_at = now + RUNOUT_STEP
                return
            for s in self.seats:
                s.action = "" if not s.allin and s.live else s.action
            self.set_turn(self.nxt(self.dealer, lambda s: s.can_act), now, STREET_PAUSE)
            return
        # Five-card draw
        if self.street == 0:
            self.phase = "draw"
            self.set_turn(self.nxt(self.dealer, lambda s: s.live and s.drew is None), now, STREET_PAUSE)
            return
        self.showdown(now)

    # ------------------------------------------------ the draw
    def do_draw(self, i, idx, now):
        s = self.seats[i]
        idx = sorted({int(k) for k in idx if isinstance(k, (int, float)) and 0 <= int(k) < len(s.cards)})[:MAX_DRAW]
        for k in idx:
            self.muck.append(s.cards[k])
        for k in idx:
            if not self.deck:                       # deck used up: shuffle the discards back in
                self.deck = [c for c in self.muck]
                self.muck = []
                random.shuffle(self.deck)
            s.cards[k] = self.deck.pop()
        s.drew = len(idx)
        s.action = f"Changes {len(idx)}" if idx else "Stands pat"
        self.ev["card"] += 1
        self.cache = {}
        nxt = self.nxt(i, lambda o: o.live and o.drew is None)
        if nxt is not None:
            self.set_turn(nxt, now)
            return
        # everybody has drawn: second betting round
        self.street = 1
        self.phase = "betting"
        if self.count(lambda o: o.can_act) >= 2:
            self.set_turn(self.nxt(self.dealer, lambda o: o.can_act), now, STREET_PAUSE)
        else:
            for o in self.seats:
                if o.live:
                    o.shown = True
            self.to_act = None
            self.phase = "runout"
            self.street = 3                         # nothing left to deal: straight to the showdown
            self.next_at = now + RUNOUT_STEP

    # ------------------------------------------------ end of a hand
    def fold_win(self, now):
        w = next(s for s in self.seats if s.live)
        pot = self.pot_total()
        w.chips += pot
        w.won = pot
        self.collect()
        self.to_act = None
        self.deadline = None
        self.result = {"text": f"{w.name} wins {pot:,} – everyone else folded",
                       "pots": [{"amount": pot, "winners": [self.seats.index(w)], "hand": ""}]}
        self.ev["win"] += 1
        self.phase = "showdown"
        self.next_at = now + FOLD_PAUSE

    def side_pots(self):
        contrib = [s.total for s in self.seats]
        levels = sorted({s.total for s in self.seats if s.live and s.total > 0})
        pots, prev = [], 0
        for lvl in levels:
            amount = sum(min(c, lvl) - min(c, prev) for c in contrib)
            elig = [i for i, s in enumerate(self.seats) if s.live and s.total >= lvl]
            if amount > 0:
                if pots and pots[-1]["eligible"] == elig:
                    pots[-1]["amount"] += amount
                else:
                    pots.append({"amount": amount, "eligible": elig})
            prev = lvl
        extra = sum(max(0, c - prev) for c in contrib)
        if extra and pots:
            pots[-1]["amount"] += extra
        return pots

    def showdown(self, now):
        self.collect()
        self.to_act = None
        self.deadline = None
        scores = {}
        for i, s in enumerate(self.seats):
            if s.live:
                s.shown = True
                scores[i] = evaluate(s.cards + self.board)
        pots_out = []
        order = [(self.dealer + k) % len(self.seats) for k in range(1, len(self.seats) + 1)]
        for pot in self.side_pots():
            elig = pot["eligible"]
            best = max(scores[i] for i in elig)
            winners = [i for i in order if i in elig and scores[i] == best]
            share, odd = divmod(pot["amount"], len(winners))
            for k, i in enumerate(winners):
                win = share + (1 if k < odd else 0)
                self.seats[i].chips += win
                self.seats[i].won += win
            pots_out.append({"amount": pot["amount"], "winners": winners, "hand": describe(best)})
        main = pots_out[0] if pots_out else None
        if main:
            names = " and ".join(self.seats[i].name for i in main["winners"])
            verb = "split" if len(main["winners"]) > 1 else "wins"
            text = f"{names} {verb} {main['amount']:,} with {main['hand']}"
            for p in pots_out[1:]:
                text += f" · side pot {p['amount']:,}: {' and '.join(self.seats[i].name for i in p['winners'])}"
        else:
            text = ""
        self.result = {"text": text, "pots": pots_out}
        for i, s in enumerate(self.seats):
            if i in scores:
                s.action = describe(scores[i])
        self.ev["win"] += 1
        self.phase = "showdown"
        self.next_at = now + SHOWDOWN_PAUSE

    # ------------------------------------------------ players coming and going
    def seat_of(self, pid):
        return next((i for i, s in enumerate(self.seats) if s.pid == pid), None)

    def input(self, pid, data):
        i = self.seat_of(pid)
        if i is None or self.to_act != i or self.seats[i].left:
            return
        now = time.monotonic()
        action = data.get("action")
        if self.phase == "draw" and action == "draw":
            cards = data.get("cards") or []
            self.do_draw(i, cards if isinstance(cards, list) else [], now)
        elif self.phase == "betting" and action in ("fold", "check", "call", "raise", "allin"):
            try:
                to = int(data.get("to") or 0)
            except (TypeError, ValueError):
                to = 0
            self.act(i, action, to, now)

    def quit(self, pid):
        i = self.seat_of(pid)
        if i is None:
            return
        s = self.seats[i]
        s.left = True
        if not self.running or not s.live:
            return
        now = time.monotonic()
        if self.phase in ("betting", "draw") and self.to_act == i:
            if self.phase == "draw":
                s.folded = True
                s.action = "Left"
                if self.count(lambda o: o.live) == 1:
                    self.fold_win(now)
                else:
                    self.do_draw_skip(i, now)
            else:
                self.act(i, "fold", 0, now)
                s.action = "Left"
        else:
            s.folded = True
            s.action = "Left"
            if self.count(lambda o: o.live) == 1 and self.phase in ("betting", "draw", "runout"):
                self.fold_win(now)

    def do_draw_skip(self, i, now):
        nxt = self.nxt(i, lambda o: o.live and o.drew is None)
        if nxt is not None:
            self.set_turn(nxt, now)
        else:
            self.street = 1
            self.phase = "betting"
            if self.count(lambda o: o.can_act) >= 2:
                self.set_turn(self.nxt(self.dealer, lambda o: o.can_act), now)
            else:
                self.phase = "runout"
                self.street = 3
                self.next_at = now + RUNOUT_STEP

    def remove(self, pid):
        self.quit(pid)

    def can_drop_in(self):
        return self.running and len([s for s in self.seats if not s.left]) < MAX_SEATS

    def drop_in(self, pid):
        p = self.room.players.get(pid)
        s = Seat(pid, p.name if p else "?", p.color if p else "#fff", self.settings["chips"])
        s.waiting = True
        self.seats.append(s)

    # ------------------------------------------------ chance to win (Monte Carlo)
    def equity(self, i, reveal, sims=SIMS):
        """Share of the pot seat i would win on average, dealing the unknown cards at random.
        reveal=True: every hand is known (Demo); otherwise only i's own cards and the board."""
        live = [j for j, s in enumerate(self.seats) if s.live]
        if i not in live:
            return 0.0
        if len(live) == 1:
            return 1.0
        key = ("eq", i, reveal, self.hand_no, self.street, self.phase, tuple(self.board),
               tuple(tuple(self.seats[j].cards) for j in live), tuple(self.seats[j].drew for j in live))
        if key in self.cache:
            return self.cache[key]
        known = {j: list(self.seats[j].cards) for j in live if j == i or reveal}
        used = set(self.board)
        for cs in known.values():
            used.update(cs)
        pool = [c for c in range(52) if c not in used]
        to_draw = not self.holdem and self.street == 0
        plans = {}
        wins = 0.0
        for _ in range(sims):
            random.shuffle(pool)
            k = 0
            best, winners = None, []
            hands = {}
            for j in live:
                if j in known:
                    cs = known[j]
                else:
                    n = 2 if self.holdem else 5
                    cs = pool[k:k + n]
                    k += n
                if to_draw and self.seats[j].drew is None:
                    if j in known:
                        if j not in plans:
                            plans[j] = discard_plan(cs)[0]
                        disc = plans[j]
                    else:
                        disc = discard_plan(cs)[0]
                    cs = [c for t, c in enumerate(cs) if t not in disc] + pool[k:k + len(disc)]
                    k += len(disc)
                hands[j] = cs
            board = self.board
            if self.holdem and len(board) < 5:
                board = board + pool[k:k + 5 - len(board)]
            for j in live:
                sc = evaluate(hands[j] + board)
                if best is None or sc > best:
                    best, winners = sc, [j]
                elif sc == best:
                    winners.append(j)
            if i in winners:
                wins += 1.0 / len(winners)
        eq = wins / sims
        self.cache[key] = eq
        return eq

    def improve_chance(self, i, disc, sims=SIMS):
        """Five-card draw: chance that changing these cards improves the hand's category."""
        s = self.seats[i]
        before = evaluate(s.cards)[0]
        if not disc:
            return 0.0
        key = ("imp", tuple(s.cards), tuple(disc))
        if key in self.cache:
            return self.cache[key]
        pool = [c for c in range(52) if c not in s.cards]
        keep = [c for t, c in enumerate(s.cards) if t not in disc]
        better = 0
        for _ in range(sims):
            if evaluate(keep + random.sample(pool, len(disc)))[0] > before:
                better += 1
        self.cache[key] = better / sims
        return self.cache[key]

    # ------------------------------------------------ decisions (computer players and advice)
    def decide(self, i, eq, style=1.0):
        s = self.seats[i]
        o = self.options(i)
        pot = self.pot_total()
        opp = self.count(lambda x: x.live) - 1
        fair = 1.0 / (opp + 1)
        need = o["to_call"] / (pot + o["to_call"]) if o["to_call"] else 0.0
        strong = eq >= min(0.86, (fair * 1.8 + 0.12) * style)
        good = eq >= (fair * 1.25 + 0.04) * style
        pct = f"{int(eq * 100 + 0.5)}%"

        def size(frac):
            amount = self.current_bet + max(self.min_raise, int(pot * frac))
            amount = max(o["min_to"], min(o["max_to"], amount))
            step = max(1, self.sb)
            return min(o["max_to"], int(round(amount / step) * step)) or o["max_to"]

        if o["to_call"] == 0:
            if strong and o["can_raise"]:
                return "raise", size(0.65), f"About {pct} to win against {opp}: strong – {o['word'].lower()} to build the pot."
            if good and o["can_raise"]:
                return "raise", size(0.4), f"About {pct} to win against {opp}: better than average – a small {o['word'].lower()}."
            return "check", 0, f"About {pct} to win against {opp}: nothing to pay, so check and see."
        if strong and o["can_raise"]:
            return "raise", size(0.8), (f"About {pct} to win, the call costs {o['to_call']} for a pot of {pot:,} "
                                        f"(needs {int(need * 100 + 0.5)}%): raise.")
        if eq >= need + 0.03 * style:
            return "call", 0, (f"About {pct} to win; calling {o['to_call']} into {pot:,} needs only "
                               f"{int(need * 100 + 0.5)}%: call.")
        if o["to_call"] <= self.bb and eq >= fair * 0.6:
            return "call", 0, f"About {pct} to win and it's cheap ({o['to_call']}): call and see."
        return "fold", 0, (f"About {pct} to win, but calling {o['to_call']} into {pot:,} needs "
                           f"{int(need * 100 + 0.5)}%: fold.")

    def bot_act(self, i, now):
        s = self.seats[i]
        if self.phase == "draw":
            self.do_draw(i, discard_plan(s.cards)[0], now)
            return
        eq = self.equity(i, reveal=False, sims=220)
        action, to, _ = self.decide(i, eq, s.style)
        o = self.options(i)
        r = random.random()
        if action == "check" and o["can_raise"] and r < 0.07:
            action, to = "raise", o["min_to"]                       # a little bluff now and then
        elif action == "fold" and o["to_call"] <= self.bb * 2 and r < 0.12:
            action = "call"                                        # stubborn sometimes
        if action == "raise" and to >= o["max_to"] * 0.7:
            to = o["max_to"]                                       # most of the stack anyway: all in
        self.act(i, action, to, now)

    def advice(self, i, reveal):
        s = self.seats[i]
        if not s.live:
            return None
        cards = s.cards
        if self.holdem and not self.board:
            hand = describe_start(cards)
        else:
            hand = describe(evaluate(cards + self.board))
        eq = self.equity(i, reveal)
        out = {"hand": hand, "eq": round(eq, 3), "opp": self.count(lambda x: x.live) - 1}
        if self.phase == "draw" and s.drew is None:
            disc, why = discard_plan(cards)
            out["discard"] = disc
            out["text"] = why
            if disc:
                out["improve"] = round(self.improve_chance(i, disc, 400), 3)
        elif self.phase == "betting" and self.to_act == i:
            action, to, why = self.decide(i, eq)
            o = self.options(i)
            out.update({"suggest": action, "to": to, "text": why,
                        "need": round(o["to_call"] / (self.pot_total() + o["to_call"]), 3) if o["to_call"] else 0})
        return out

    # ------------------------------------------------ state for browsers
    def snapshot(self):
        return self.snapshot_for(None)

    def snapshot_for(self, pid):
        now = time.monotonic()
        mode = self.settings["mode"]
        demo = mode == "demo"
        me = self.seat_of(pid) if pid is not None else None
        seats = []
        for j, s in enumerate(self.seats):
            visible = bool(s.cards) and (j == me or demo or s.shown) and not (s.folded and j != me and not demo)
            hand = ""
            if visible and s.cards and (not self.holdem or self.board or j == me or demo):
                hand = describe(evaluate(s.cards + self.board)) if (self.board or not self.holdem) \
                    else describe_start(s.cards)
            seats.append({
                "pid": s.pid, "name": s.name, "color": s.color, "bot": s.bot, "chips": s.chips,
                "bet": s.bet, "total": s.total, "folded": s.folded, "allin": s.allin,
                "out": s.out, "left": s.left, "waiting": s.waiting, "action": s.action,
                "n": len(s.cards), "cards": s.cards if visible else None, "hand": hand if visible else "",
                "drew": s.drew, "won": s.won, "shown": s.shown,
            })
        state = {
            "variant": self.settings["variant"], "mode": mode, "phase": self.phase,
            "hand": self.hand_no, "hands": self.settings["hands"], "street": self.street,
            "board": self.board, "dealer": self.dealer, "to_act": self.to_act, "me": me,
            "seats": seats, "pot": self.pot_total(), "current_bet": self.current_bet,
            "raises": self.raises, "cap": self.settings["cap"], "sb": self.sb, "bb": self.bb,
            "countdown": max(0, math.ceil(self.next_at - now)) if self.phase == "countdown" else 0,
            "turn_left": max(0, math.ceil(self.deadline - now)) if self.deadline else None,
            "timer": self.settings["timer"], "result": self.result, "max_draw": MAX_DRAW,
            "ev": dict(self.ev),
        }
        if me is not None and self.to_act == me and self.phase == "betting":
            state["options"] = self.options(me)
        if self.running and me is not None and mode in ("advice", "demo") and self.phase in ("betting", "draw"):
            state["advice"] = self.advice(me, demo)
        if self.running and demo and self.phase in ("betting", "draw", "runout"):
            state["equity"] = {j: round(self.equity(j, True), 3) for j, s in enumerate(self.seats) if s.live}
        return state
