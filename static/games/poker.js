// Poker – browser part: the table, the cards, the action buttons, the advice box, the end-of-hand summary,
// sounds and the manual, in English or Italian (each player's own choice in the room).
// Rules, betting and the computer players run on the server (games/poker.py). The server sends no sentences:
// actions, hands, results and advice arrive as codes and numbers and are worded here.
(() => {
  const SUIT = ["♠", "♥", "♦", "♣"];
  const RANK = { 11: "J", 12: "Q", 13: "K", 14: "A" };
  const rankOf = c => Math.floor(c / 4) + 2;
  const suitOf = c => c % 4;
  const label = c => (RANK[rankOf(c)] || String(rankOf(c)));
  const red = c => suitOf(c) === 1 || suitOf(c) === 2;

  // ================================================================== words, in two languages
  let LANG = "en";
  // same rule as the page (api.lang): the player's choice, else the browser's language
  function langNow() {
    let v = null;
    try { v = localStorage.getItem("ui.lang"); } catch (e) {}
    if (v === "en" || v === "it") return v;
    return (navigator.language || "").toLowerCase().startsWith("it") ? "it" : "en";
  }
  const fmt = n => Number(n || 0).toLocaleString(LANG === "it" ? "it-IT" : "en-US");
  const pct = x => `${Math.round(x * 100)}%`;

  const NAMES = {
    en: { 2: "Two", 3: "Three", 4: "Four", 5: "Five", 6: "Six", 7: "Seven", 8: "Eight", 9: "Nine", 10: "Ten",
          11: "Jack", 12: "Queen", 13: "King", 14: "Ace" },
    it: { 2: "Due", 3: "Tre", 4: "Quattro", 5: "Cinque", 6: "Sei", 7: "Sette", 8: "Otto", 9: "Nove", 10: "Dieci",
          11: "Fante", 12: "Donna", 13: "Re", 14: "Asso" },
  };
  const PLURALS = { en: { 6: "Sixes" }, it: { 11: "Fanti", 12: "Donne", 14: "Assi" } };
  const rn = r => NAMES[LANG][r];
  const rp = r => (PLURALS[LANG][r] || (LANG === "en" ? NAMES.en[r] + "s" : NAMES.it[r]));
  // Italian "al / alla / all'" before a card name (Scala al Re, alla Donna, all'Asso)
  const al = r => (r === 12 ? "alla " : (r === 14 || r === 8) ? "all'" : "al ") + rn(r);

  const CATS = {
    en: ["High card", "One pair", "Two pair", "Three of a kind", "Straight", "Flush", "Full house", "Four of a kind", "Straight flush"],
    it: ["Carta alta", "Coppia", "Doppia coppia", "Tris", "Scala", "Colore", "Full", "Poker", "Scala reale"],
  };

  // a hand code from the server -> words.  ["S", hi, lo, suited] = two Hold'em cards before the flop
  function handName(h) {
    if (!h || !h.length) return "";
    const it = LANG === "it";
    if (h[0] === "S") {
      if (h[1] === h[2]) return it ? `Coppia di ${rp(h[1])}` : `Pair of ${rp(h[1])}`;
      return `${rn(h[1])}-${rn(h[2])}${h[3] ? (it ? " dello stesso seme" : " suited") : ""}`;
    }
    const [c, a, b] = h;
    if (it) {
      return [
        () => `Carta alta: ${rn(a)}`, () => `Coppia di ${rp(a)}`, () => `Doppia coppia, ${rp(a)} e ${rp(b)}`,
        () => `Tris di ${rp(a)}`, () => `Scala ${al(a)}`, () => `Colore ${al(a)}`, () => `Full di ${rp(a)} e ${rp(b)}`,
        () => `Poker di ${rp(a)}`, () => (a === 14 ? "Scala reale massima" : `Scala reale ${al(a)}`),
      ][c]();
    }
    return [
      () => `${rn(a)} high`, () => `Pair of ${rp(a)}`, () => `Two pair, ${rp(a)} and ${rp(b)}`,
      () => `Three ${rp(a)}`, () => `Straight, ${rn(a)} high`, () => `Flush, ${rn(a)} high`,
      () => `Full house, ${rp(a)} full of ${rp(b)}`, () => `Four ${rp(a)}`,
      () => (a === 14 ? "Royal flush" : `Straight flush, ${rn(a)} high`),
    ][c]();
  }

  // why the winner beat the next best hand
  function whyWon(w, l) {
    const it = LANG === "it";
    if (!l) return "";
    let i = 0;
    while (i < w.length && w[i] === l[i]) i++;
    if (i >= w.length) return it ? "Mani identiche: il piatto si divide." : "Identical hands: the pot is split.";
    if (i === 0) return it ? `${CATS.it[w[0]]} batte ${CATS.it[l[0]].toLowerCase()}.` : `${CATS.en[w[0]]} beats ${CATS.en[l[0]].toLowerCase()}.`;
    if (i === 1 || handName(w) !== handName(l))
      return it ? `${handName(w)} batte ${handName(l).toLowerCase()}.` : `${handName(w)} beats ${handName(l).toLowerCase()}.`;
    const cat = w[0];
    let what;
    if (cat === 2 && i === 2) what = it ? "la seconda coppia" : "the second pair";
    else if (cat === 6) what = it ? "la coppia del full" : "the pair";
    else if (cat === 5 || cat === 0) what = it ? "la carta successiva" : "the next card";
    else what = it ? "la carta di spareggio (kicker)" : "the kicker";
    return it ? `Stessa mano (${handName(w).toLowerCase()}): decide ${what}, ${rn(w[i])} batte ${rn(l[i])}.`
              : `Same hand (${handName(w).toLowerCase()}): ${what} decides – ${rn(w[i])} beats ${rn(l[i])}.`;
  }

  const ACT = {
    en: { sb: "Small blind {n}", bb: "Big blind {n}", fold: "Fold", check: "Check", call: "Call {n}", bet: "Bet {n}",
          raise: "Raise to {n}", allin: "All-in {n}", draw: "Changes {n}", pat: "Stands pat", left: "Left" },
    it: { sb: "Piccolo buio {n}", bb: "Grande buio {n}", fold: "Lascia", check: "Bussa", call: "Vede {n}", bet: "Punta {n}",
          raise: "Rilancia a {n}", allin: "All-in {n}", draw: "Cambia {n}", pat: "Servito", left: "Uscito" },
  };
  function actName(a) {
    if (!a) return "";
    if (a[0] === "hand") return handName(a.slice(1));
    return (ACT[LANG][a[0]] || "").replace("{n}", fmt(a[1]));
  }

  const TX = {
    en: {
      fold: "Fold", check: "Check", call: "Call {n}", allinN: "All-in {n}", bet: "Bet", raiseTo: "Raise to", allin: "All-in",
      min: "Min", half: "½ pot", pot: "Pot", potN: "Pot {n}", blinds: "Blinds", raises: "Raises",
      yourTurn: "Your turn", toCall: "Your turn – {n} to call", pick: "Your turn – tap the cards to change (up to {n})",
      thinking: "{name} is thinking…", waitingFor: "Waiting for {name}…", runout: "All-in – dealing the rest of the cards",
      joinNext: "You'll be dealt in at the next hand", outChips: "You're out of chips – watching the table",
      cap: "Raise cap reached: {n} raises this round – call or fold.",
      change1: "Change 1 card", changeN: "Change {n} cards", keepAll: "Keep all (stand pat)",
      follow: "Follow the advice", advice: "Advice", chance: "chance to win <b>{p}</b> against {o}",
      opp1: "1 player", oppN: "{n} players", improve: "Chance to improve with this change: <b>{p}</b>",
      shuffling: "Shuffling…", holdem: "Texas Hold'em", draw: "Five-card draw", short: { holdem: "Hold'em", draw: "Draw" },
      handN: "hand {n}", drawLabel: "DRAW · change up to {n}", you: "You", out: "out", left: "left", joins: "joins next hand",
      thinkingShort: "thinking…", changeQ: "change?", CHANGE: "CHANGE",
      wins: "{who} wins {n}", youWin: "You win {n}", split: "{who} split {n}", with: "with {h}",
      foldWin: "{who} wins {n} – everyone else folded. Cards are not shown.",
      side: "Side pot {n}", next: "Next hand", nextIn: "next hand in {n} s", ready: "{a}/{b} ready",
      waitOthers: "Waiting for the others…", last: "Last hand", hide: "Hide", resultOf: "Hand {n} – result",
      why: "Why", allinTag: "All-in", keys: "F fold · C check/call · R raise · A all-in · ↑↓ amount · H advice · Enter continue / next hand · ? rules · Esc exit",
      liveHand: "hand {n}{of}", of: " of {n}", chips: "{n} chips", outOf: "out of chips", starting: "starting",
      inPot: "in pot {n}", cont: "Continue", willDo: "{name} will: {act}", reasoning: "Reasoning:",
      history: "This hand", showHistory: "Show the moves of this hand", hideHistory: "Hide the moves",
      stages: { holdem: ["Pre-flop", "Flop", "Turn", "River"], draw: ["Before the draw", "After the draw"], drawStage: "Draw" },
      deckShort: "Deck {lo}–A ({n} cards)",
      terms: "📘 Terms", hideTerms: "Hide the terms", tapHint: "Tip: tap a move badge or the D button on the table to see what it means.",
      facts: "Dealer: <b>{d}</b> · play goes <b>clockwise</b> (to the left) · first to speak this round: <b>{f}</b>",
      factsDraw: "Dealer: <b>{d}</b> · play goes <b>clockwise</b> (to the left)",
    },
    it: {
      fold: "Lascia", check: "Bussa", call: "Vedi {n}", allinN: "All-in {n}", bet: "Punta", raiseTo: "Rilancia a", allin: "All-in",
      min: "Min", half: "½ piatto", pot: "Piatto", potN: "Piatto {n}", blinds: "Bui", raises: "Rilanci",
      yourTurn: "Tocca a te", toCall: "Tocca a te – {n} per vedere", pick: "Tocca a te – tocca le carte da cambiare (massimo {n})",
      thinking: "{name} sta pensando…", waitingFor: "In attesa di {name}…", runout: "All-in – si scoprono le carte che mancano",
      joinNext: "Entrerai in gioco dalla prossima mano", outChips: "Hai finito le fiches – guardi la partita",
      cap: "Limite di rilanci raggiunto: {n} in questo giro – puoi vedere o lasciare.",
      change1: "Cambia 1 carta", changeN: "Cambia {n} carte", keepAll: "Tieni tutto (servito)",
      follow: "Segui il consiglio", advice: "Consiglio", chance: "probabilità di vincere <b>{p}</b> contro {o}",
      opp1: "1 avversario", oppN: "{n} avversari", improve: "Probabilità di migliorare con questo cambio: <b>{p}</b>",
      shuffling: "Si mescola…", holdem: "Texas Hold'em", draw: "Poker classico a 5 carte", short: { holdem: "Hold'em", draw: "Classico" },
      handN: "mano {n}", drawLabel: "CAMBIO · massimo {n} carte", you: "Tu", out: "fuori", left: "uscito", joins: "entra alla prossima",
      thinkingShort: "pensa…", changeQ: "cambiare?", CHANGE: "CAMBIA",
      wins: "{who} vince {n}", youWin: "Vinci {n}", split: "{who} si dividono {n}", with: "con {h}",
      foldWin: "{who} vince {n} – gli altri hanno lasciato. Le carte non si mostrano.",
      side: "Piatto laterale {n}", next: "Prossima mano", nextIn: "prossima mano tra {n} s", ready: "{a}/{b} pronti",
      waitOthers: "In attesa degli altri…", last: "Mano precedente", hide: "Nascondi", resultOf: "Mano {n} – risultato",
      why: "Perché", allinTag: "All-in", keys: "F lascia · C bussa/vedi · R rilancia · A all-in · ↑↓ importo · H consiglio · Invio continua / prossima mano · ? regole · Esc esci",
      liveHand: "mano {n}{of}", of: " di {n}", chips: "{n} fiches", outOf: "senza fiches", starting: "in partenza",
      inPot: "nel piatto {n}", cont: "Continua", willDo: "{name} farà: {act}", reasoning: "Ragionamento:",
      history: "Questa mano", showHistory: "Mostra le mosse di questa mano", hideHistory: "Nascondi le mosse",
      stages: { holdem: ["Pre-flop", "Flop", "Turn", "River"], draw: ["Prima del cambio", "Dopo il cambio"], drawStage: "Cambio" },
      deckShort: "Mazzo {lo}–A ({n} carte)",
      terms: "📘 Termini", hideTerms: "Nascondi i termini", tapHint: "Suggerimento: tocca un badge di una mossa o il bottone D sul tavolo per sapere cosa significa.",
      facts: "Cartaro: <b>{d}</b> · si gioca in <b>senso orario</b> (verso sinistra) · parla per primo in questo giro: <b>{f}</b>",
      factsDraw: "Cartaro: <b>{d}</b> · si gioca in <b>senso orario</b> (verso sinistra)",
    },
  };
  const t = (key, vars = {}) => {
    let s = TX[LANG][key] ?? TX.en[key] ?? key;
    for (const [k2, v] of Object.entries(vars)) s = s.replaceAll(`{${k2}}`, v);
    return s;
  };

  const WHY = {
    en: {
      bet_strong: "About {p} to win against {o}: strong – {w} to build the pot.",
      bet_good: "About {p} to win against {o}: better than average – a small {w}.",
      check: "About {p} to win against {o}: nothing to pay, so check and see.",
      raise_strong: "About {p} to win; the call costs {c} for a pot of {pot} (needs {need}): raise.",
      call: "About {p} to win; calling {c} into {pot} needs only {need}: call.",
      call_cheap: "About {p} to win and it's cheap ({c}): call and see.",
      fold: "About {p} to win, but calling {c} into {pot} needs {need}: fold.",
      bluff: "About {p} to win against {o}: not much, but a small bet now and then keeps the others guessing (a bluff).",
      stubborn: "About {p} to win: not really enough, but the call is cheap ({c}) – a stubborn call.",
      made: "{h} – a made hand: keep all five (stand pat).",
      trips: "Keep the three {r}, change the other two.",
      twopair: "Keep both pairs, change the odd card: 1 chance in 11 to make a full house.",
      flush4: "Four cards of the same suit: change the fifth, about 1 chance in 5 to make a flush.",
      pair: "Keep the pair of {r} and change three cards.",
      straight4: "Four in a row, open at both ends: change the fifth, about 1 chance in 6 for a straight.",
      high: "Nothing yet: keep your highest card ({r1}) and change four.",
      wbet: "bet", wraise: "raise",
    },
    it: {
      bet_strong: "Circa {p} di vincere contro {o}: mano forte – {w} per far crescere il piatto.",
      bet_good: "Circa {p} di vincere contro {o}: meglio della media – una piccola puntata.",
      check: "Circa {p} di vincere contro {o}: non c'è niente da pagare, quindi bussa e guarda.",
      raise_strong: "Circa {p} di vincere; vedere costa {c} per un piatto di {pot} (serve il {need}): rilancia.",
      call: "Circa {p} di vincere; vedere {c} su un piatto di {pot} richiede solo il {need}: vedi.",
      call_cheap: "Circa {p} di vincere e costa poco ({c}): vedi e guarda.",
      fold: "Circa {p} di vincere, ma vedere {c} su un piatto di {pot} richiede il {need}: lascia.",
      bluff: "Circa {p} di vincere contro {o}: poco, ma una piccola puntata ogni tanto confonde gli avversari (bluff).",
      stubborn: "Circa {p} di vincere: non basterebbe, ma vedere costa poco ({c}) – una chiamata ostinata.",
      made: "{h} – mano fatta: tieni tutte e cinque le carte (servito).",
      trips: "Tieni il tris di {r} e cambia le altre due.",
      twopair: "Tieni le due coppie e cambia la carta spaiata: 1 possibilità su 11 di fare full.",
      flush4: "Quattro carte dello stesso seme: cambia la quinta, circa 1 possibilità su 5 di fare colore.",
      pair: "Tieni la coppia di {r} e cambia tre carte.",
      straight4: "Quattro carte in fila, aperte ai due lati: cambia la quinta, circa 1 possibilità su 6 di fare scala.",
      high: "Ancora niente: tieni la carta più alta ({r1}) e cambiane quattro.",
      wbet: "punta", wraise: "rilancia",
    },
  };
  function whyText(why) {
    if (!why || !why.length) return "";
    const [code, x] = why;
    let s = WHY[LANG][code] || WHY.en[code] || "";
    const opp = n => (n === 1 ? t("opp1") : t("oppN", { n }));
    if (x && typeof x === "object") {
      s = s.replace("{p}", pct(x.eq)).replace("{o}", opp(x.opp)).replace("{c}", fmt(x.call))
           .replace("{pot}", fmt(x.pot)).replace("{need}", pct(x.need))
           .replace("{w}", WHY[LANG][x.word === "bet" ? "wbet" : "wraise"]);
    } else if (code === "made") s = s.replace("{h}", handName(why.slice(1)));
    else s = s.replace("{r1}", rn(why[1] || 2)).replace("{r}", rp(why[1] || 2));
    return s;
  }

  // ================================================================== glossary: the words of the game
  // code -> [term, explanation]; the codes are the same as the move badges, so tapping a badge explains it
  const GLOSS = {
    en: {
      dealer: ["Dealer (D)", "The player who deals this hand, marked by the D button. The button moves one seat clockwise every hand. After the first betting round the dealer always speaks last – the best seat."],
      sb: ["Small blind", "A forced bet by the first player after the dealer, half of the big blind, put in before seeing the cards (“blind”). It starts the pot. Called “buio” in Italian."],
      bb: ["Big blind", "A forced bet by the second player after the dealer, twice the small blind. It is the bet everybody must match in the first round; the big blind speaks last in that round and may still raise. Called “controbuio” in Italian."],
      direction: ["Order of play", "Play goes clockwise: after you, the player on your left speaks. The cards are dealt the same way."],
      first: ["Who speaks first", "In the first betting round: the player after the big blind. In the later rounds (and in the draw): the first player still in after the dealer."],
      check: ["Check", "Pass without betting. Only possible when nobody has bet yet in this round."],
      bet: ["Bet", "Be the first to put chips in during this round (“open”). The others must at least call to stay in."],
      call: ["Call", "Put in just enough to match the highest bet and stay in the hand."],
      raise: ["Raise", "Match the highest bet and add more. The minimum raise equals the last increase. After a raise the others must call again (or raise, or fold)."],
      cap: ["Raise cap", "After the first bet only a limited number of raises are allowed in each betting round; then you can only call or fold."],
      fold: ["Fold", "Give up the hand. The chips you already put in stay in the pot."],
      allin: ["All-in", "Bet all your chips. You stay in until the showdown for what you put in; extra chips the others bet go to a side pot."],
      draw: ["Change cards", "Five-card draw: after the first betting round each player may throw away up to 4 cards and get new ones."],
      pat: ["Stand pat", "Change no cards. It usually means a made hand… or a bluff."],
      pot: ["Pot", "All the chips bet in this hand. The best hand at the showdown wins it – or the last player left when all the others fold."],
      side: ["Side pot", "When someone is all-in, the chips the others keep betting form a separate pot that only they can win."],
      hand: ["Showdown", "After the last betting round the remaining players show their cards; the best five-card hand wins."],
      kicker: ["Kicker", "When two hands are the same (e.g. both a pair of Kings), the highest remaining card decides."],
      odds: ["Pot odds", "Price of a call compared with the pot: calling 20 to win 100 is worth it if you win more than 20% of the time."],
      shortdeck: ["Italian deck", "Lowest card = 11 − number of players (4 players: 7 to Ace). Flush beats full house; A-7-8-9-10 is the lowest straight."],
      left: ["Left", "The player has left the match."],
    },
    it: {
      dealer: ["Cartaro (D)", "Chi distribuisce le carte in questa mano, segnato dal bottone D. Il bottone passa al giocatore successivo (in senso orario) a ogni mano. Dopo il primo giro il cartaro parla sempre per ultimo – il posto migliore."],
      sb: ["Buio (piccolo buio)", "Puntata obbligatoria del primo giocatore dopo il cartaro, metà del controbuio, messa prima di vedere le carte («al buio»). Fa partire il piatto."],
      bb: ["Controbuio (grande buio)", "Puntata obbligatoria del secondo giocatore dopo il cartaro, il doppio del buio. È la puntata che tutti devono pareggiare nel primo giro; chi l'ha messa parla per ultimo in quel giro e può ancora rilanciare."],
      direction: ["Senso di gioco", "Si gioca in senso orario: dopo di te parla il giocatore alla tua sinistra. Anche le carte si distribuiscono così."],
      first: ["Chi parla per primo", "Nel primo giro di puntate: il giocatore dopo il controbuio. Nei giri successivi (e nel cambio): il primo giocatore ancora in gioco dopo il cartaro."],
      check: ["Bussa", "Passi la parola senza puntare (detto anche «parola», in inglese check). Si può solo se in questo giro nessuno ha ancora puntato."],
      bet: ["Punta (apri)", "Sei il primo a mettere fiches in questo giro («apro»). Gli altri, per restare in gioco, devono almeno vedere."],
      call: ["Vedi (sto)", "Metti quanto serve per pareggiare la puntata più alta e resti in gioco (si dice anche «sto», «chiamo» – in inglese call)."],
      raise: ["Rilancia", "Pareggi la puntata più alta e aggiungi. Il rilancio minimo è uguale all'ultimo aumento. Dopo un rilancio gli altri devono vedere di nuovo (o rilanciare, o lasciare)."],
      cap: ["Limite di rilanci", "Dopo la prima puntata, in ogni giro si può rilanciare solo un certo numero di volte; poi si può solo vedere o lasciare."],
      fold: ["Lascia (passo)", "Abbandoni la mano (si dice anche «passo», «mi ritiro» – in inglese fold). Le fiches già messe restano nel piatto."],
      allin: ["All-in", "Punti tutte le tue fiches. Resti in gioco fino allo showdown per quello che hai messo; le fiches in più degli altri vanno in un piatto laterale."],
      draw: ["Cambio", "Poker classico: dopo il primo giro di puntate ognuno può scartare fino a 4 carte e riceverne altrettante nuove."],
      pat: ["Servito", "Non cambi nessuna carta. Di solito vuol dire una mano già fatta… oppure un bluff."],
      pot: ["Piatto", "Tutte le fiches puntate nella mano. Lo vince la mano migliore allo showdown – o l'ultimo rimasto quando tutti gli altri lasciano."],
      side: ["Piatto laterale", "Quando qualcuno è all-in, le fiches che gli altri continuano a puntare formano un piatto a parte che solo loro possono vincere."],
      hand: ["Showdown", "Dopo l'ultimo giro di puntate chi è rimasto mostra le carte; vince la miglior mano di cinque carte."],
      kicker: ["Kicker (carta di spareggio)", "Quando due mani sono uguali (per esempio entrambe una coppia di Re), decide la carta più alta tra le rimanenti."],
      odds: ["Pot odds (quota del piatto)", "Il prezzo per vedere rispetto al piatto: vedere 20 per vincere 100 conviene se vinci più del 20% delle volte."],
      shortdeck: ["Mazzo all'italiana", "Carta più bassa = 11 − numero di giocatori (in 4: dal 7 all'Asso). Il colore batte il full; A-7-8-9-10 è la scala più bassa."],
      left: ["Uscito", "Il giocatore ha lasciato la partita."],
    },
  };
  const GLOSS_ORDER = ["dealer", "direction", "first", "sb", "bb", "check", "bet", "call", "raise", "cap", "fold", "allin",
                       "draw", "pat", "pot", "side", "hand", "kicker", "odds", "shortdeck"];
  const glossCode = c => ({ sb: "sb", bb: "bb", fold: "fold", check: "check", call: "call", bet: "bet", raise: "raise",
                            allin: "allin", draw: "draw", pat: "pat", left: "left", hand: "hand" })[c] || c;
  let explain = null;            // a term tapped on the table, explained in the panel
  let showGloss = false;         // the glossary is open
  let tips = [];                 // tappable things on the table: badges, the D button, the pot

  // ================================================================== table geometry
  // two table shapes: wide (PCs, sideways phones) and tall (phones held upright)
  // pw/ph: name plate size, fs: text size factor (the tall table is shown smaller, so its text is bigger)
  const WIDE = { W: 1000, H: 640, cx: 500, cy: 282, rx: 418, ry: 232, fx: 385, fy: 205, boardY: 232, potY: 312,
                 myY: 410, big: [66, 92], small: [40, 56], tiny: [30, 42], bcard: [60, 84], pw: 160, ph: 66, fs: 1 };
  const TALL = { W: 600, H: 900, cx: 300, cy: 395, rx: 210, ry: 340, fx: 222, fy: 318, boardY: 345, potY: 430,
                 myY: 590, big: [80, 112], small: [46, 64], tiny: [36, 50], bcard: [64, 90], pw: 176, ph: 84, fs: 1.3 };
  let L = WIDE, k = 1, cw = 1000, ch = 620, sizedFor = "";
  let hits = [];                 // my cards on screen, for picking cards to change (draw)
  let sel = new Set();           // cards picked to change
  let selFor = "";               // which hand/phase the selection belongs to
  let amount = 0;                // raise amount chosen with the slider
  let panelKey = "";
  let showLast = false;          // the "Last hand" box is open
  let showLog = true;            // the moves of this hand are listed

  function resize(api) {
    const upright = window.innerWidth < 700 && window.innerHeight > window.innerWidth;
    let { w: availW, h: availH } = api.space(1100, 150);
    const panel = api.$("gamePanel"), fixed = parseInt(panel.style.minHeight) || 0;
    if (fixed && panel.offsetHeight > fixed) availH += panel.offsetHeight - fixed;   // a longer panel just scrolls
    L = upright || availW / Math.max(1, availH) < 0.95 ? TALL : WIDE;
    const ratio = L.W / L.H;
    const w = upright ? Math.max(260, Math.floor(availW))                    // full width, the page scrolls
                      : Math.max(260, Math.floor(Math.min(availW, availH * ratio)));
    const key = `${w}:${L.W}:${window.devicePixelRatio || 1}`;
    if (key === sizedFor) return;
    sizedFor = key;
    cw = w; ch = Math.round(w / ratio); k = cw / L.W;
    const dpr = window.devicePixelRatio || 1;
    api.canvas.style.width = cw + "px"; api.canvas.style.height = ch + "px";
    api.canvas.width = cw * dpr; api.canvas.height = ch * dpr;
    api.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  // ================================================================== drawing helpers
  function rrect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
  }

  // a card centred on (x, y) in table units; card = number, or null for a face-down card
  function drawCard(ctx, card, x, y, w, h, opt = {}) {
    const X = (x - w / 2) * k, Y = (y - h / 2 - (opt.lift || 0)) * k, Wd = w * k, Ht = h * k, r = Math.max(2, 6 * k);
    ctx.save();
    ctx.globalAlpha = opt.dim ? 0.4 : 1;
    ctx.shadowColor = opt.glow ? "#facc15" : "rgba(0,0,0,.45)"; ctx.shadowBlur = (opt.glow ? 14 : 6) * k; ctx.shadowOffsetY = 2 * k;
    rrect(ctx, X, Y, Wd, Ht, r);
    if (card === null || card === undefined) {
      ctx.fillStyle = "#1e3a8a"; ctx.fill();
      ctx.shadowColor = "transparent";
      ctx.strokeStyle = "#f8fafc"; ctx.lineWidth = Math.max(1, 2 * k); ctx.stroke();
      ctx.save(); rrect(ctx, X + 3 * k, Y + 3 * k, Wd - 6 * k, Ht - 6 * k, r); ctx.clip();
      ctx.strokeStyle = "rgba(147,197,253,.45)"; ctx.lineWidth = Math.max(1, 1.2 * k);
      for (let d = -Ht; d < Wd + Ht; d += 8 * k) {
        ctx.beginPath(); ctx.moveTo(X + d, Y); ctx.lineTo(X + d - Ht, Y + Ht); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(X + d - Ht, Y); ctx.lineTo(X + d, Y + Ht); ctx.stroke();
      }
      ctx.restore();
    } else {
      ctx.fillStyle = "#fdfdfb"; ctx.fill();
      ctx.shadowColor = "transparent";
      ctx.strokeStyle = opt.selected ? "#f59e0b" : opt.glow ? "#facc15" : "#cbd5e1";
      ctx.lineWidth = opt.selected || opt.glow ? Math.max(2, 4 * k) : Math.max(1, k);
      ctx.stroke();
      ctx.fillStyle = red(card) ? "#dc2626" : "#111827";
      ctx.textAlign = "left"; ctx.textBaseline = "top";
      const fs = Math.max(8, h * 0.27 * k);
      ctx.font = `800 ${fs}px system-ui, sans-serif`;
      ctx.fillText(label(card), X + w * 0.1 * k, Y + h * 0.05 * k);
      ctx.font = `${Math.max(7, h * 0.22 * k)}px system-ui, sans-serif`;
      ctx.fillText(SUIT[suitOf(card)], X + w * 0.1 * k, Y + h * 0.05 * k + fs * 0.95);
      ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.font = `${Math.max(10, h * 0.42 * k)}px system-ui, sans-serif`;
      ctx.fillText(SUIT[suitOf(card)], X + Wd * 0.58, Y + Ht * 0.62);
    }
    if (opt.selected) {
      ctx.fillStyle = "#f59e0b";
      ctx.font = `800 ${Math.max(8, 12 * L.fs * k)}px system-ui, sans-serif`;
      ctx.textAlign = "center"; ctx.textBaseline = "bottom";
      ctx.fillText(t("CHANGE"), X + Wd / 2, Y - 3 * k);
    }
    ctx.restore();
  }

  function text(ctx, s, x, y, size, color, weight = 600, align = "center", base = "middle") {
    ctx.font = `${weight} ${Math.max(9, size * L.fs * k)}px system-ui, sans-serif`;
    ctx.fillStyle = color; ctx.textAlign = align; ctx.textBaseline = base;
    ctx.fillText(s, x * k, y * k);
  }

  function chipStack(ctx, x, y, amount) {
    if (!amount) return;
    const n = Math.min(5, 1 + Math.floor(Math.log10(amount + 1)));
    for (let i = 0; i < n; i++) {
      ctx.beginPath();
      ctx.ellipse(x * k, (y - i * 3) * k, 9 * k, 5 * k, 0, 0, Math.PI * 2);
      ctx.fillStyle = ["#ef4444", "#3b82f6", "#22c55e", "#f59e0b", "#a855f7"][i]; ctx.fill();
      ctx.strokeStyle = "#fff"; ctx.lineWidth = Math.max(1, k); ctx.stroke();
    }
    text(ctx, fmt(amount), x + 14, y - 2, 15, "#fef3c7", 700, "left");
  }

  // where each seat sits: me at the bottom, the others round the top in playing order (clockwise)
  function places(g) {
    const n = g.seats.length, base = g.me != null ? g.me : 0;
    const out = [];
    for (let j = 0; j < n; j++) {
      const rel = (j - base + n) % n;
      let a;
      if (rel === 0) a = 90;
      else if (n === 2) a = 270;
      else a = 165 + 210 * (rel - 1) / (n - 2);
      const r = a * Math.PI / 180;
      out[j] = { x: L.cx + L.rx * Math.cos(r), y: L.cy + L.ry * Math.sin(r), rel };
    }
    return out;
  }

  // ================================================================== render
  function render(api) {
    LANG = api.lang ? api.lang() : "en";
    const st = api.st(), g = st.game, ctx = api.ctx;
    resize(api);
    ctx.clearRect(0, 0, cw, ch);
    ctx.fillStyle = "#0b1220"; ctx.fillRect(0, 0, cw, ch);

    // felt
    ctx.save();
    ctx.beginPath(); ctx.ellipse(L.cx * k, L.cy * k, (L.fx + 22) * k, (L.fy + 22) * k, 0, 0, Math.PI * 2);
    ctx.fillStyle = "#5b3a1e"; ctx.fill();
    ctx.beginPath(); ctx.ellipse(L.cx * k, L.cy * k, L.fx * k, L.fy * k, 0, 0, Math.PI * 2);
    const grad = ctx.createRadialGradient(L.cx * k, L.cy * k, 20 * k, L.cx * k, L.cy * k, L.fx * k);
    grad.addColorStop(0, "#15803d"); grad.addColorStop(1, "#0b4f27");
    ctx.fillStyle = grad; ctx.fill();
    ctx.restore();

    const pos = places(g);
    const showdown = g.phase === "showdown" && g.result;
    const winners = new Set(showdown ? g.result.pots.flatMap(p => p.winners) : []);
    // at the showdown: each shown hand's best five cards, the main winner's are highlighted
    const best = {};
    if (showdown && !g.result.fold) for (const h of g.result.shown) best[h.seat] = new Set(h.best);
    const mainWinner = showdown && !g.result.fold ? g.result.pots[0].winners[0] : null;

    // community cards (Hold'em) or the deck (draw)
    if (g.variant === "holdem") {
      const [w, h] = L.bcard;
      for (let i = 0; i < 5; i++) {
        const x = L.cx + (i - 2) * (w + 8);
        const c = g.board[i];
        if (c !== undefined) {
          const used = mainWinner != null && best[mainWinner] && best[mainWinner].has(c);
          drawCard(ctx, c, x, L.boardY, w, h, { glow: used, dim: mainWinner != null && !used, lift: used ? 6 : 0 });
        } else {
          ctx.save(); rrect(ctx, (x - w / 2) * k, (L.boardY - h / 2) * k, w * k, h * k, 6 * k);
          ctx.strokeStyle = "rgba(255,255,255,.15)"; ctx.lineWidth = Math.max(1, 1.5 * k); ctx.stroke(); ctx.restore();
        }
      }
    } else if (g.phase !== "over") {
      for (let i = 0; i < 3; i++) drawCard(ctx, null, L.cx - 2 * i, L.boardY - 2 * i, L.bcard[0], L.bcard[1]);
      if (g.phase === "draw") text(ctx, t("drawLabel", { n: g.max_draw }), L.cx, L.boardY + L.bcard[1] / 2 + 16, 14, "#fde68a", 700);
    }

    // pot, or the result of the hand
    if (showdown) {
      const p0 = g.result.pots[0];
      const ws = p0.winners;
      const names = ws.map(i => (i === g.me ? t("you") : g.seats[i].name)).join(" & ");
      const line = ws.length > 1 ? t("split", { who: names, n: fmt(p0.amount) })
                 : ws[0] === g.me ? t("youWin", { n: fmt(p0.amount) }) : t("wins", { who: names, n: fmt(p0.amount) });
      text(ctx, line, L.cx, L.potY + 4, 18, "#fde68a", 800);
      if (p0.ev) text(ctx, handName(p0.ev), L.cx, L.potY + 26, 14, "#fde68a", 600);
    } else if (g.pot) {
      text(ctx, t("potN", { n: fmt(g.pot) }), L.cx, L.potY, 20, "#fef3c7", 800);
    }

    // seats
    hits = [];
    tips = [{ code: "pot", x: (L.cx - 90) * k, y: (L.potY - 18) * k, w: 180 * k, h: 36 * k }];
    g.seats.forEach((s, j) => drawSeat(ctx, g, s, j, pos[j], winners.has(j), best[j]));

    // dealer button, beside the dealer's name plate on the side facing the middle
    if (g.dealer != null && g.dealer >= 0 && pos[g.dealer]) {
      const p = pos[g.dealer];
      const bx = p.x < L.cx - 40 ? p.x + L.pw / 2 + 16 : p.x - L.pw / 2 - 16, by = p.y - L.ph / 4;
      ctx.beginPath(); ctx.arc(bx * k, by * k, 12 * k, 0, Math.PI * 2);
      ctx.fillStyle = "#f8fafc"; ctx.fill(); ctx.strokeStyle = "#111"; ctx.lineWidth = Math.max(1, k); ctx.stroke();
      text(ctx, "D", bx, by + 1, 12, "#111", 900);
      tips.push({ code: "dealer", x: (bx - 20) * k, y: (by - 20) * k, w: 40 * k, h: 40 * k });
    }

    // top bar and keys line
    api.$("chips").innerHTML = "";
    const short = t("short")[g.variant] || "";
    api.$("timer").textContent = g.hand ? `${short} · ${t("handN", { n: g.hand + (g.hands ? "/" + g.hands : "") })}` : short;
    api.$("keysHelp").textContent = t("keys");

    // centre message
    let big = "", small = "", huge = false, dim = false;
    if (st.state === "lobby" && st.results) {
      big = (st.results.titles && st.results.titles[LANG]) || st.results.title; dim = true;
    } else if (g.phase === "countdown") { big = t("shuffling"); small = t(g.variant); }
    api.setMessage(big, small, huge, dim);

    renderPanel(api, g);
  }

  function drawSeat(ctx, g, s, j, p, isWinner, bestSet) {
    const mine = j === g.me;
    const turn = g.to_act === j && (g.phase === "betting" || g.phase === "draw");
    const dx = L.cx - p.x, dy = L.cy - p.y, d = Math.hypot(dx, dy) || 1, ux = dx / d, uy = dy / d;
    const gone = s.out || s.left;
    const cardOpt = c => bestSet ? { glow: isWinner && bestSet.has(c), dim: !bestSet.has(c) } : { dim: s.folded };

    // cards
    if (s.n && !gone) {
      if (mine) {
        const [w, h] = L.big;
        const gap = s.n === 5 ? 6 : 10;
        const total = s.n * w + (s.n - 1) * gap;
        const picking = g.phase === "draw" && turn;
        for (let i = 0; i < s.n; i++) {
          const x = L.cx - total / 2 + w / 2 + i * (w + gap);
          const card = s.cards ? s.cards[i] : null;
          const selected = picking && sel.has(i);
          const advised = g.advice && g.advice.discard && g.advice.discard.includes(i) && picking && !sel.size;
          drawCard(ctx, card, x, L.myY, w, h, Object.assign(cardOpt(card), { selected, lift: selected ? 14 : 0 }));
          if (advised) {
            ctx.save();
            rrect(ctx, (x - w / 2 - 3) * k, (L.myY - h / 2 - 3) * k, (w + 6) * k, (h + 6) * k, 8 * k);
            ctx.setLineDash([5 * k, 4 * k]); ctx.strokeStyle = "#60a5fa"; ctx.lineWidth = Math.max(1.5, 2.5 * k); ctx.stroke();
            ctx.restore();
            text(ctx, t("changeQ"), x, L.myY - h / 2 - 12, 11, "#93c5fd", 800);
          }
          hits.push({ i, x: (x - w / 2) * k, y: (L.myY - h / 2 - 14) * k, w: w * k, h: (h + 14) * k });
        }
        if (s.hand) text(ctx, handName(s.hand), p.x, p.y + L.ph / 2 + 12 * L.fs, 14, "#e2e8f0", 700);
      } else {
        const [w, h] = s.n === 5 ? L.tiny : L.small;
        const step = s.n === 5 ? w * 0.62 : w * 0.78;
        let cx, cy;
        if (L === TALL) {             // tall table: cards just above (lower seats) or below (upper seats) the plate
          cx = p.x;
          cy = p.y < L.cy ? p.y + L.ph / 2 + h / 2 + 6 : p.y - L.ph / 2 - h / 2 - 6;
        } else {
          const off = 64 + Math.abs(ux) * 58;
          cx = p.x + ux * off; cy = p.y + uy * off;
        }
        for (let i = 0; i < s.n; i++) {
          const x = cx - (s.n - 1) * step / 2 + i * step;
          const c = s.cards ? s.cards[i] : null;
          drawCard(ctx, c, x, cy, w, h, c == null ? { dim: s.folded } : cardOpt(c));
        }
      }
    }

    // bet in front of the seat
    if (s.bet && !gone) {
      if (mine) chipStack(ctx, L.cx + (s.n * (L.big[0] + 8)) / 2 + 22, L.myY + 30, s.bet);
      else if (L === TALL) {        // tall table: chips just inside the name plate, clear of the pot
        const side = p.x < L.cx - 20 ? 1 : p.x > L.cx + 20 ? -1 : 0;
        if (side) chipStack(ctx, p.x + side * (L.pw / 2 + 18) - (side < 0 ? 40 : 0), p.y + L.ph / 2 + 4, s.bet);
        else chipStack(ctx, p.x + L.pw / 2 + 14, p.y, s.bet);
      } else chipStack(ctx, p.x + ux * (128 + Math.abs(ux) * 95) - 10, p.y + uy * 118, s.bet);
    }

    // name plate: name / chips / last action (or hand at the showdown)
    const pw = L.pw, ph = L.ph, X = p.x - pw / 2, Y = p.y - ph / 2, lh = ph / 3.4;
    ctx.save();
    ctx.globalAlpha = gone ? 0.35 : s.folded ? 0.55 : 1;
    rrect(ctx, X * k, Y * k, pw * k, ph * k, 10 * k);
    ctx.fillStyle = mine ? "#1f2937" : "#111827"; ctx.fill();
    ctx.lineWidth = Math.max(1.5, (turn || isWinner ? 3 : 1.5) * k);
    ctx.strokeStyle = isWinner ? "#facc15" : turn ? "#4ade80" : "rgba(255,255,255,.18)";
    if (turn || isWinner) { ctx.shadowColor = ctx.strokeStyle; ctx.shadowBlur = 12 * k; }
    ctx.stroke();
    ctx.restore();
    ctx.save();
    ctx.globalAlpha = gone ? 0.45 : s.folded ? 0.6 : 1;
    ctx.beginPath(); ctx.arc((X + 14) * k, (Y + lh * 0.95) * k, 5 * L.fs * k, 0, Math.PI * 2); ctx.fillStyle = s.color; ctx.fill();
    const nm = (mine ? t("you") : s.name) + (s.bot ? " 🤖" : "");
    text(ctx, nm.length > 13 ? nm.slice(0, 12) + "…" : nm, X + 24, Y + lh * 0.95, 15, "#f1f5f9", 700, "left");
    text(ctx, gone ? (s.left ? t("left") : t("out")) : fmt(s.chips), X + 12, Y + lh * 2.05, 15, "#fde68a", 800, "left");
    if (s.waiting) text(ctx, t("joins"), X + 12, Y + lh * 3.0, 12, "#94a3b8", 600, "left");
    else if (s.total && !gone) text(ctx, t("inPot", { n: fmt(s.total) }), X + 12, Y + lh * 3.0, 12, "#94a3b8", 600, "left");
    ctx.restore();

    // what they did last: a coloured badge on top of the name plate (dashed: a computer move about to happen)
    const pend = g.pending && g.pending.seat === j ? g.pending.act : null;
    const shown = pend || (s.allin && !(s.act && (s.act[0] === "allin" || s.act[0] === "hand")) ? ["allin", s.total] : s.act);
    if (shown && !gone) {
      const r = badge(ctx, shown, X + 4, Y, pw * 0.86, !!pend, isWinner);
      tips.push(Object.assign({ code: glossCode(shown[0]) }, r));
    }

    // whose turn: a shrinking bar under the plate
    if (turn && g.turn_left != null && g.timer) {
      const f = Math.max(0, Math.min(1, g.turn_left / g.timer));
      ctx.fillStyle = f < 0.25 ? "#ef4444" : "#4ade80";
      ctx.fillRect((X + 8) * k, (Y + ph - 4) * k, (pw - 16) * f * k, 3 * k);
    }
    if (turn && s.bot) text(ctx, t("thinkingShort"), X + pw - 10, Y + lh * 2.05, 11, "#94a3b8", 600, "right");

    // Demo: everybody's chance to win
    const eq = g.equity && g.equity[j];
    if (eq != null && !s.folded) {
      const tx = X + pw - 8, ty = Y - 2;
      const tt = pct(eq);
      ctx.font = `800 ${Math.max(9, 13 * L.fs * k)}px system-ui, sans-serif`;
      const tw = ctx.measureText(tt).width / k + 12;
      rrect(ctx, (tx - tw) * k, (ty - 10 * L.fs) * k, tw * k, 20 * L.fs * k, 9 * k);
      ctx.fillStyle = "#1d4ed8"; ctx.fill();
      text(ctx, tt, tx - tw / 2, ty, 13, "#fff", 800);
    }
    // what a winner won
    if (isWinner && s.won) text(ctx, `+${fmt(s.won)}`, p.x, Y - 12 * L.fs, 18, "#facc15", 900);
  }

  const BADGE = { sb: "#475569", bb: "#475569", fold: "#4b5563", check: "#15803d", call: "#1d4ed8", bet: "#c2410c",
                  raise: "#c2410c", allin: "#b91c1c", draw: "#6d28d9", pat: "#6d28d9", left: "#4b5563", hand: "#a16207" };
  function badge(ctx, a, x, y, maxW, pending, win) {
    let s = (pending ? "→ " : "") + actName(a);
    const fs = 13 * L.fs * k;
    ctx.save();
    ctx.font = `800 ${Math.max(9, fs)}px system-ui, sans-serif`;
    while (ctx.measureText(s).width > (maxW - 14) * k && s.length > 4) s = s.slice(0, -2) + "…";
    const w = ctx.measureText(s).width / k + 14, h = 21 * L.fs;
    rrect(ctx, x * k, (y - h * 0.62) * k, w * k, h * k, 9 * k);
    ctx.fillStyle = win && a[0] === "hand" ? "#ca8a04" : (BADGE[a[0]] || "#334155");
    ctx.fill();
    if (pending) { ctx.setLineDash([4 * k, 3 * k]); ctx.strokeStyle = "#fde68a"; ctx.lineWidth = Math.max(1.5, 2 * k); ctx.stroke(); }
    ctx.fillStyle = "#fff"; ctx.textAlign = "left"; ctx.textBaseline = "middle";
    ctx.fillText(s, (x + 7) * k, (y - h * 0.62 + h / 2) * k);
    ctx.restore();
    return { x: x * k - 4, y: (y - h * 0.62) * k - 4, w: w * k + 8, h: h * k + 8 };
  }

  // ================================================================== the panel (HTML)
  const btn = (act, txt, cls = "", extra = "") => `<button data-act="${act}" class="${cls}" ${extra}>${txt}</button>`;
  const kbd = s => ` <small>${s}</small>`;

  function miniCards(list, bestSet, winner) {
    return `<span class="pk-cards">${(list || []).map(c =>
      `<span class="pkc${red(c) ? " r" : ""}${bestSet && !bestSet.has(c) ? " off" : ""}${winner && bestSet && bestSet.has(c) ? " w" : ""}">${label(c)}${SUIT[suitOf(c)]}</span>`).join("")}</span>`;
  }

  // who speaks first in the current round: after the big blind in the first round, otherwise after the dealer
  function firstToSpeak(g) {
    const n = g.seats.length;
    if (!n || g.dealer == null || g.dealer < 0 || !["betting", "draw"].includes(g.phase)) return null;
    const live = j => g.seats[j].n && !g.seats[j].folded && !g.seats[j].out && !g.seats[j].left;
    let from = g.dealer;
    if (g.phase === "betting" && g.street === 0) {
      const bb = (g.log || []).find(e => e[2] && e[2][0] === "bb");
      if (bb) from = bb[0];
    }
    for (let k2 = 1; k2 <= n; k2++) { const j = (from + k2) % n; if (live(j)) return j; }
    return null;
  }

  // every move of this hand, grouped by betting round
  function historyHtml(api, g) {
    const st = TX[LANG].stages;
    const stageName = s => s === "draw" ? st.drawStage : (g.variant === "holdem" ? st.holdem[s] : st.draw[s]) || "";
    const groups = [];
    for (const [seat, stage, a] of g.log) {
      if (!groups.length || groups[groups.length - 1].stage !== stage) groups.push({ stage, items: [] });
      const who = seat === g.me ? t("you") : api.esc(g.seats[seat].name);
      groups[groups.length - 1].items.push(`<span class="pk-mv"><i style="background:${BADGE[a[0]] || "#334155"}"></i>${who}: ${actName(a)}</span>`);
    }
    return groups.map(gr => `<div><b>${stageName(gr.stage)}</b> ${gr.items.join(" ")}</div>`).join("");
  }

  // the summary of a finished hand: who won what, with which hand, and why; every hand shown, best first
  function summary(api, res, seats, board, me) {
    const name = i => (i === me ? t("you") : api.esc(seats[i].name));
    let html = "";
    res.pots.forEach((p, n) => {
      const who = p.winners.map(name).join(" & ");
      const line = p.winners.length > 1 ? t("split", { who, n: fmt(p.amount) })
                 : p.winners[0] === me ? t("youWin", { n: fmt(p.amount) }) : t("wins", { who, n: fmt(p.amount) });
      if (res.fold) html += `<div class="pk-res-main">${t("foldWin", { who, n: fmt(p.amount) })}</div>`;
      else html += `<div class="${n ? "pk-res-side" : "pk-res-main"}">${n ? t("side", { n: fmt(p.amount) }) + ": " : ""}${line}
                    ${p.ev ? t("with", { h: `<b>${handName(p.ev)}</b>` }) : ""}</div>`;
    });
    if (!res.fold && res.shown && res.shown.length > 1) {
      const w0 = res.pots[0].winners[0];
      const wHand = res.shown.find(h => h.seat === w0);
      const runner = res.shown.find(h => !res.pots[0].winners.includes(h.seat));
      const why = wHand && runner ? whyWon(wHand.ev, runner.ev) : res.pots[0].winners.length > 1 ? whyWon(wHand.ev, wHand.ev) : "";
      if (why) html += `<div class="pk-why"><b>${t("why")}:</b> ${why}</div>`;
      html += `<table class="pk-shown">${res.shown.map((h, n) => {
        const won = res.pots.some(p => p.winners.includes(h.seat));
        const cards = seats[h.seat].cards || [];
        const bs = new Set(h.best);
        return `<tr class="${won ? "won" : ""}"><td>${n + 1}</td><td>${name(h.seat)}</td>
          <td>${miniCards(cards, bs, won)}${board && board.length ? ` + ${miniCards(board, bs, won)}` : ""}</td>
          <td>${handName(h.ev)}</td><td>${won && seats[h.seat].won ? "+" + fmt(seats[h.seat].won) : ""}</td></tr>`;
      }).join("")}</table>`;
    }
    return html;
  }

  const STYLE = `<style>
    .pk-wrap { display: flex; flex-direction: column; gap: 6px; font-size: 14px; }
    .pk-head { font-weight: 700; font-size: 15px; } .pk-info { color: var(--muted); font-size: 12px; font-weight: 500; }
    .pk-row { display: flex; gap: 6px; flex-wrap: wrap; } .pk-row button { flex: 1 1 0; padding: 10px 8px; font-size: 15px; }
    .pk-row button small { opacity: .5; font-size: 11px; margin-left: 4px; }
    .pk-raise input { flex: 2 1 160px; accent-color: var(--accent); } .pk-quick button { padding: 6px; font-size: 13px; }
    .pk-adv { background: rgba(29, 78, 216, .16); border-left: 3px solid #3b82f6; border-radius: 8px; padding: 8px 10px;
              display: flex; flex-direction: column; gap: 5px; font-size: 13px; line-height: 1.35; }
    .pk-bar { position: relative; height: 8px; background: rgba(255,255,255,.12); border-radius: 4px; overflow: hidden; }
    .pk-bar span { position: absolute; inset: 0 auto 0 0; background: #3b82f6; }
    .pk-bar i { position: absolute; top: -2px; bottom: -2px; width: 3px; background: #facc15; }
    .pk-res { background: rgba(250, 204, 21, .10); border-left: 3px solid #facc15; border-radius: 8px; padding: 8px 10px;
              display: flex; flex-direction: column; gap: 6px; line-height: 1.35; }
    .pk-res-main { font-size: 16px; font-weight: 700; } .pk-res-side { font-size: 13px; }
    .pk-why { font-size: 14px; }
    .pk-shown { border-collapse: collapse; font-size: 13px; width: 100%; }
    .pk-shown td { padding: 4px 4px; border-top: 1px solid var(--line); vertical-align: middle; }
    .pk-shown tr.won td { color: #fde68a; font-weight: 700; }
    .pk-cards { display: inline-flex; gap: 2px; white-space: nowrap; }
    .pkc { display: inline-block; min-width: 24px; padding: 1px 3px; border-radius: 4px; background: #fdfdfb; color: #111827;
           font-weight: 800; font-size: 12px; text-align: center; border: 1px solid #cbd5e1; }
    .pkc.r { color: #dc2626; } .pkc.off { opacity: .35; } .pkc.w { border-color: #facc15; box-shadow: 0 0 0 1px #facc15; }
    .pk-next { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
    .pk-next button { flex: 1 1 auto; padding: 10px; font-size: 15px; }
    .pk-log { font-size: 12.5px; line-height: 1.7; background: rgba(255,255,255,.04); border-radius: 8px; padding: 6px 8px; }
    .pk-log b { color: var(--muted); font-weight: 700; margin-right: 4px; }
    .pk-mv { white-space: nowrap; margin-right: 8px; } .pk-mv i { display: inline-block; width: 8px; height: 8px; border-radius: 2px; margin-right: 4px; }
    .pk-pend { border-left-color: #facc15; background: rgba(250, 204, 21, .10); }
    .pk-explain { position: relative; background: rgba(16, 185, 129, .13); border-left: 3px solid #10b981; border-radius: 8px;
                  padding: 8px 30px 8px 10px; font-size: 13.5px; line-height: 1.4; }
    .pk-x { position: absolute; top: 4px; right: 4px; padding: 2px 7px; font-size: 13px; }
    .pk-gloss { background: rgba(255,255,255,.04); border-radius: 8px; padding: 8px 10px; font-size: 13px; line-height: 1.4; }
    .pk-gloss dl { margin: 6px 0 0; } .pk-gloss dt { font-weight: 800; margin-top: 6px; } .pk-gloss dd { margin: 0; color: var(--text); opacity: .9; }
    .pk-facts { margin-bottom: 4px; }
    .pk-link { background: none; border: 0; color: var(--muted); text-decoration: underline; padding: 2px 0; font-size: 13px; align-self: flex-start; }
    body.landscape #gamePanel { padding-top: 92px; }
    @media (max-width: 600px) { .pk-shown td:first-child { display: none; } }
  </style>`;

  function renderPanel(api, g) {
    const panel = api.$("gamePanel");
    // keep the panel the same height all match long (the table would jump otherwise)
    const upright = window.innerWidth < 700 && window.innerHeight > window.innerWidth;
    const minH = document.body.classList.contains("landscape") || upright ? "" : (g.mode === "normal" ? "220px" : "300px");
    if (!g.seats.length || api.st().state !== "match") {
      if (panel.innerHTML) panel.innerHTML = "";
      panel.style.minHeight = ""; panelKey = ""; return;
    }
    if (panel.style.minHeight !== minH) { panel.style.minHeight = minH; sizedFor = ""; }
    const me = g.me, mySeat = me != null ? g.seats[me] : null;
    const myTurn = me != null && g.to_act === me;
    const o = g.options;
    const handKey = `${g.hand}:${g.phase}:${g.to_act}`;
    if (selFor !== handKey) { sel = new Set(); selFor = handKey; }
    if (o) amount = Math.max(o.min_to, Math.min(o.max_to, amount || o.min_to));

    const key = JSON.stringify([LANG, g.phase, g.to_act, g.hand, o, g.advice, myTurn && g.phase === "draw" ? [...sel] : 0,
                                g.cap, g.raises, g.pot, mySeat && mySeat.chips, g.seats.map(s => s.act), g.ready, showLast,
                                g.phase === "showdown" ? g.result : 0, g.pending, g.log && g.log.length, showLog, explain, showGloss]);
    const timeLeft = g.phase === "showdown" ? (g.pause ? ` · ${t("nextIn", { n: g.pause_left })}` : "")
                   : g.turn_left != null ? ` · ${g.turn_left}s` : "";
    if (key === panelKey) {
      const tl = panel.querySelector("#pkTime"); if (tl) tl.textContent = timeLeft;
      return;
    }
    panelKey = key;

    const deckInfo = g.deck === "short" ? " · " + t("deckShort", { lo: RANK[g.lo] || g.lo, n: (15 - g.lo) * 4 }) : "";
    const info = `${t("blinds")} ${g.sb}/${g.bb} · ${t("raises")} ${g.raises}/${g.cap || "∞"}${g.pot ? " · " + t("potN", { n: fmt(g.pot) }) : ""}${deckInfo}`;
    let head = "", body = "";
    const who = g.to_act != null ? g.seats[g.to_act] : null;

    if (g.phase === "showdown" && g.result) {
      // the end of a hand: what happened and why, then Next hand
      head = t("resultOf", { n: g.hand });
      const iAmReady = g.ready.includes(me);
      const waitN = g.wait_for.length, readyN = g.ready.filter(j => g.wait_for.includes(j)).length;
      body = `<div class="pk-res">${summary(api, g.result, g.seats, g.board, me)}</div>
        <div class="pk-next">${me != null && g.wait_for.includes(me)
          ? btn("ready", iAmReady ? t("waitOthers") : `${t("next")} ▶${kbd("N")}`, iAmReady ? "" : "primary", iAmReady ? "disabled" : "") : ""}
          ${waitN > 1 ? `<span class="pk-info">${t("ready", { a: readyN, b: waitN })}</span>` : ""}</div>`;
    } else {
      if (myTurn && g.phase === "betting") head = o.to_call ? t("toCall", { n: fmt(o.to_call) }) : t("yourTurn");
      else if (myTurn && g.phase === "draw") head = t("pick", { n: g.max_draw });
      else if (who) head = who.bot ? t("thinking", { name: who.name }) : t("waitingFor", { name: who.name });
      else if (g.phase === "runout") head = t("runout");
      else if (mySeat && mySeat.waiting) head = t("joinNext");
      if (mySeat && mySeat.out) head = t("outChips");

      // step by step: the computer's next move, waiting for Continue
      if (g.pending) {
        const ps = g.seats[g.pending.seat];
        head = t("willDo", { name: ps.name, act: actName(g.pending.act) });
        const why = whyText(g.pending.why);
        body += `<div class="pk-adv pk-pend">${why ? `<div><b>${t("reasoning")}</b> ${api.esc(why)}</div>` : ""}
          <div class="pk-row">${btn("continue", `${t("cont")} ▶${kbd("Enter")}`, "primary")}</div></div>`;
      }

      if (myTurn && g.phase === "betting" && o) {
        const callTxt = o.to_call ? (o.call < o.to_call ? t("allinN", { n: fmt(mySeat.bet + o.call) }) : t("call", { n: fmt(o.to_call) })) : t("check");
        body += `<div class="pk-row">${btn("fold", t("fold") + kbd("F"), "danger")}${btn(o.to_call ? "call" : "check", callTxt + kbd("C"), "primary")}</div>`;
        if (o.can_raise) {
          const step = Math.max(1, g.sb);
          const word = o.word === "Bet" ? t("bet") : t("raiseTo");
          body += `<div class="pk-row pk-raise">
            <input id="pkAmt" type="range" min="${o.min_to}" max="${o.max_to}" step="${step}" value="${amount}" aria-label="Amount">
            ${btn("raise", `${word} <b id="pkAmtTxt">${fmt(amount)}</b>${kbd("R")}`)}</div>
            <div class="pk-row pk-quick">${btn("amt-min", t("min"))}${btn("amt-half", t("half"))}${btn("amt-pot", t("pot"))}${btn("allin", t("allin") + kbd("A"))}</div>`;
        } else if (o.capped) {
          body += `<div class="hint">${t("cap", { n: g.cap })}</div>`;
        }
      } else if (myTurn && g.phase === "draw") {
        const n = sel.size;
        body += `<div class="pk-row">${btn("draw", (n ? (n === 1 ? t("change1") : t("changeN", { n })) : t("keepAll")) + kbd("Enter"), "primary")}</div>`;
      }

      // advice
      const a = g.advice;
      if (a) {
        const sugg = a.suggest ? { fold: t("fold"), check: t("check"), call: t("call", { n: fmt(o ? o.to_call : 0) }),
                                   raise: `${o && o.word === "Bet" ? t("bet") : t("raiseTo")} ${fmt(a.to)}` }[a.suggest] : "";
        const opp = a.opp === 1 ? t("opp1") : t("oppN", { n: a.opp });
        const why = whyText(a.why);
        body += `<div class="pk-adv">
          <div><b>${handName(a.hand)}</b> · ${t("chance", { p: pct(a.eq), o: opp })}</div>
          <div class="pk-bar"><span style="width:${Math.round(a.eq * 100)}%"></span>${a.need ? `<i style="left:${Math.round(a.need * 100)}%"></i>` : ""}</div>
          ${why ? `<div><b>${t("advice")}${sugg ? ": " + api.esc(sugg) : ""}.</b> ${api.esc(why)}</div>` : ""}
          ${a.improve != null ? `<div>${t("improve", { p: pct(a.improve) })}</div>` : ""}
          ${myTurn && (a.suggest || a.discard) ? `<div class="pk-row">${btn("follow", t("follow") + kbd("H"))}</div>` : ""}
        </div>`;
      }

      // the moves of this hand, round by round
      if (g.log && g.log.length) {
        body += `<button class="pk-link" data-act="log">${showLog ? t("hideHistory") : t("showHistory")}</button>`;
        if (showLog) body += `<div class="pk-log">${historyHtml(api, g)}</div>`;
      }

      // the previous hand, to look at again
      if (g.last && g.last.result) {
        body += `<button class="pk-link" data-act="last">${showLast ? t("hide") : t("last")}</button>`;
        if (showLast) {
          const L2 = g.last;
          body += `<div class="pk-res"><div class="pk-info">${t("resultOf", { n: L2.hand })}</div>
                   ${summary(api, L2.result, L2.seats.map(s => Object.assign({}, s)), L2.board, me)}</div>`;
        }
      }
    }

    // a word tapped on the table, and the glossary with this table's facts
    let terms = "";
    if (explain && GLOSS[LANG][explain]) {
      const [term, txt] = GLOSS[LANG][explain];
      terms += `<div class="pk-explain"><button class="pk-x" data-act="explain-close" aria-label="close">✕</button><b>${term}</b> – ${txt}</div>`;
    }
    terms += `<button class="pk-link" data-act="gloss">${showGloss ? t("hideTerms") : t("terms")}</button>`;
    if (showGloss) {
      const dealer = g.dealer != null && g.dealer >= 0 ? (g.dealer === me ? t("you") : api.esc(g.seats[g.dealer].name)) : "–";
      const f = firstToSpeak(g);
      const fName = f == null ? "–" : f === me ? t("you") : api.esc(g.seats[f].name);
      terms += `<div class="pk-gloss"><div class="pk-facts">${f == null ? t("factsDraw", { d: dealer }) : t("facts", { d: dealer, f: fName })}</div>
        <div class="pk-info">${t("tapHint")}</div>
        <dl>${GLOSS_ORDER.map(c => `<dt>${GLOSS[LANG][c][0]}</dt><dd>${GLOSS[LANG][c][1]}</dd>`).join("")}</dl></div>`;
    }

    panel.innerHTML = `${STYLE}
      <div class="pk-wrap">
        <div class="pk-head">${api.esc(head)}<span id="pkTime" class="pk-info">${timeLeft}</span></div>
        <div class="pk-info">${info}</div>
        ${body}${terms}
      </div>`;
  }

  // panel clicks and slider
  let wired = false;
  function wire(api) {
    if (wired) return;
    wired = true;
    const panel = api.$("gamePanel");
    panel.addEventListener("input", e => {
      if (e.target.id !== "pkAmt") return;
      amount = +e.target.value;
      const tl = panel.querySelector("#pkAmtTxt"); if (tl) tl.textContent = fmt(amount);
    });
    panel.addEventListener("click", e => {
      const b = e.target.closest("button[data-act]");
      if (!b) return;
      b.blur();
      act(api, b.dataset.act);
    });
  }

  function setAmount(api, v) {
    const g = api.st().game, o = g.options;
    if (!o) return;
    amount = Math.max(o.min_to, Math.min(o.max_to, Math.round(v / Math.max(1, g.sb)) * Math.max(1, g.sb)));
    const s = api.$("gamePanel").querySelector("#pkAmt"); if (s) s.value = amount;
    const tl = api.$("gamePanel").querySelector("#pkAmtTxt"); if (tl) tl.textContent = fmt(amount);
  }

  function act(api, what) {
    const g = api.st().game, o = g.options;
    if (what === "last") { showLast = !showLast; render(api); return true; }
    if (what === "log") { showLog = !showLog; render(api); return true; }
    if (what === "gloss") { showGloss = !showGloss; render(api); return true; }
    if (what === "explain-close") { explain = null; render(api); return true; }
    if (what === "continue") { if (g.pending) api.input({ action: "continue" }); return true; }
    if (what === "ready") { if (g.phase === "showdown") api.input({ action: "ready" }); return true; }
    if (g.to_act !== g.me || g.me == null) return false;
    if (g.phase === "draw") {
      if (what === "draw") { api.input({ action: "draw", cards: [...sel] }); return true; }
      if (what === "follow" && g.advice && g.advice.discard) { api.input({ action: "draw", cards: g.advice.discard }); return true; }
      return false;
    }
    if (!o) return false;
    const pot = g.pot;
    switch (what) {
      case "fold": case "check": case "call": case "allin": api.input({ action: what }); return true;
      case "raise": if (o.can_raise) api.input({ action: "raise", to: amount }); return o.can_raise;
      case "amt-min": setAmount(api, o.min_to); return true;
      case "amt-half": setAmount(api, g.current_bet + Math.max(o.min_to - g.current_bet, pot / 2)); return true;
      case "amt-pot": setAmount(api, g.current_bet + Math.max(o.min_to - g.current_bet, pot + o.to_call)); return true;
      case "follow": {
        const a = g.advice;
        if (!a || !a.suggest) return false;
        if (a.suggest === "raise") api.input({ action: "raise", to: a.to });
        else api.input({ action: a.suggest });
        return true;
      }
    }
    return false;
  }

  // keyboard: F fold · C / Space check-call · R raise · A all-in · ↑↓ amount · 1-5 pick cards · Enter draw ·
  //           H advice · N / Enter next hand · ? rules (top-bar tool)
  function onKey(api, key) {
    const g = api.st().game;
    if (!g || g.me == null) return false;
    const k2 = key.toLowerCase();
    if (g.phase === "showdown") {
      if (k2 === "n" || key === "Enter" || key === " ") return act(api, "ready");
      return false;
    }
    if (g.pending && (key === "Enter" || key === " " || k2 === "n")) return act(api, "continue");
    if (g.to_act !== g.me) return false;
    if (g.phase === "draw") {
      if (/^[1-5]$/.test(k2)) { toggle(api, +k2 - 1); return true; }
      if (key === "Enter" || k2 === "d") return act(api, "draw");
      if (k2 === "h") return act(api, "follow");
      return false;
    }
    const o = g.options;
    if (!o) return false;
    if (k2 === "f") return act(api, "fold");
    if (k2 === "c" || key === " ") return act(api, o.to_call ? "call" : "check");
    if (k2 === "r") return act(api, "raise");
    if (k2 === "a") return act(api, "allin");
    if (k2 === "h") return act(api, "follow");
    if (key === "ArrowUp") { setAmount(api, amount + g.bb); return true; }
    if (key === "ArrowDown") { setAmount(api, amount - g.bb); return true; }
    return false;
  }

  function toggle(api, i) {
    const g = api.st().game;
    if (g.phase !== "draw" || g.to_act !== g.me) return;
    if (sel.has(i)) sel.delete(i);
    else if (sel.size < g.max_draw) sel.add(i);
    render(api);
  }

  function onPointer(api, x, y) {
    const g = api.st().game;
    if (g.phase === "draw" && g.to_act === g.me) {
      for (const h of hits) {
        if (x >= h.x && x <= h.x + h.w && y >= h.y && y <= h.y + h.h) { toggle(api, h.i); return; }
      }
    }
    // a badge, the D button or the pot: explain the word in the panel
    for (let n = tips.length - 1; n >= 0; n--) {
      const h = tips[n];
      if (x >= h.x && x <= h.x + h.w && y >= h.y && y <= h.y + h.h && GLOSS[LANG][h.code]) {
        explain = explain === h.code ? null : h.code;
        render(api);
        const box = api.$("gamePanel").querySelector(".pk-explain");
        if (box) box.scrollIntoView({ block: "nearest", behavior: "smooth" });
        return;
      }
    }
  }

  // ================================================================== sounds
  function sounds(api, prev, next) {
    const pg = prev.game, ng = next.game;
    if (!pg || !ng || !pg.ev || !ng.ev) return false;
    const a = pg.ev, b = ng.ev;
    if (b.deal > a.deal) for (let i = 0; i < 4; i++) api.tone(1800 - i * 120, i * .05, .03, "square", .025);
    if (b.card > a.card) api.tone(1500, 0, .04, "triangle", .05);
    if (b.chips > a.chips) { api.tone(2400, 0, .04, "square", .03); api.tone(2900, .05, .04, "square", .03); }
    if (b.allin > a.allin) for (let i = 0; i < 5; i++) api.tone(2200 + i * 150, i * .04, .04, "square", .03);
    if (b.check > a.check) { api.tone(180, 0, .05, "sine", .12); api.tone(170, .09, .05, "sine", .1); }
    if (b.fold > a.fold) api.tone(500, 0, .18, "sine", .04, 180);
    if (b.win > a.win && ng.result) {
      const mine = ng.result.pots.some(p => p.winners.includes(ng.me));
      if (mine) [523, 659, 784, 1047].forEach((f, i) => api.tone(f, i * .1, .14, "triangle", .1));
      else api.tone(440, 0, .15, "triangle", .06);
    }
    if (ng.to_act === ng.me && ng.me != null && (pg.to_act !== ng.me || b.turn > a.turn) &&
        (ng.phase === "betting" || ng.phase === "draw")) {
      api.tone(880, 0, .1, "sine", .09); api.tone(1320, .1, .14, "sine", .08);
    }
    return false;
  }

  function liveInfo(st) {
    LANG = langNow();
    const g = st.game;
    return g.hand ? t("liveHand", { n: g.hand, of: g.hands ? t("of", { n: g.hands }) : "" }) : t("starting");
  }
  function status(st, pid) {
    LANG = langNow();
    const s = st.game.seats.find(x => x.pid === pid);
    if (!s) return "";
    return s.out ? t("outOf") : t("chips", { n: fmt(s.chips) });
  }

  // ================================================================== the manual (English / Italian)
  function cardsHtml(list) {
    return `<span class="pk-cards">${list.split(" ").map(tk => {
      const r = tk.slice(0, -1), s = tk.slice(-1);
      const sym = { s: "♠", h: "♥", d: "♦", c: "♣" }[s];
      return `<span class="pkc${s === "h" || s === "d" ? " r" : ""}">${r}${sym}</span>`;
    }).join("")}</span>`;
  }
  const MANUAL_STYLE = `<style>
      .pk-cards { display: inline-flex; gap: 3px; white-space: nowrap; }
      .pkc { display: inline-block; min-width: 30px; padding: 2px 4px; border-radius: 5px; background: #fdfdfb; color: #111827;
             font-weight: 800; font-size: 14px; text-align: center; border: 1px solid #cbd5e1; }
      .pkc.r { color: #dc2626; }
      .pk-rank { width: 100%; border-collapse: collapse; font-size: 14px; }
      .pk-rank td { padding: 6px 6px; border-bottom: 1px solid var(--line); vertical-align: top; }
      .pk-rank td:first-child { font-weight: 800; color: var(--muted); }
      .pk-rank .odds { color: var(--muted); font-size: 12px; white-space: nowrap; }
      .pk-gl dt { font-weight: 800; margin-top: 8px; } .pk-gl dd { margin: 2px 0 0 0; }
      @media (max-width: 600px) { .pk-rank .odds { display: none; } .pkc { min-width: 24px; font-size: 12px; } }
    </style>`;
  const EXAMPLES = ["As Ks Qs Js 10s", "9h 8h 7h 6h 5h", "Kc Kd Kh Ks 2d", "Qs Qd Qh 3c 3d", "Ah 9h 7h 4h 2h",
                    "10d 9c 8s 7h 6d", "7s 7d 7c Kh 2h", "Js Jd 4c 4h Ah", "6s 6d Kc 9h 2h", "As Jd 8c 6h 2h"];
  const ODDS = ["649,740", "72,193", "4,165", "694", "509", "255", "47", "21", "2.4", "2"];
  function rankTable(rows, oddsWord, short) {
    let order = rows.map((r, i) => [r, i]);
    if (short) { const f = order[4]; order[4] = order[3]; order[3] = f; }       // Italian deck: flush above full house
    return `<table class="pk-rank">${order.map(([r, i], n) => `<tr><td>${n + 1}</td><td><b>${r[0]}</b><br>${r[1]}</td>
      <td>${cardsHtml(EXAMPLES[i])}</td><td class="odds">${short ? "" : oddsWord.replace("{n}", LANG === "it" ? ODDS[i].replace(",", ".").replace(/\.(\d)$/, ",$1") : ODDS[i])}</td></tr>`).join("")}</table>`;
  }

  function manualEn(settings) {
    const v = settings.variant, cap = settings.cap, bb = settings.blinds;
    const holdem = `
      <h3>Texas Hold'em – how a hand goes</h3>
      <ol>
        <li><b>Blinds.</b> The two players after the dealer button (D) put in forced bets: the small blind and the big blind (${bb / 2} and ${bb} here).</li>
        <li><b>Two private cards</b> each, face down. Then the first betting round, starting with the player after the big blind.</li>
        <li><b>The flop:</b> three shared cards are turned face up in the middle. Betting round.</li>
        <li><b>The turn:</b> a fourth shared card. Betting round.</li>
        <li><b>The river:</b> the fifth and last shared card. Last betting round.</li>
        <li><b>Showdown:</b> each remaining player makes the best five-card hand from their two cards plus the five on the table (any combination: both, one or even none of their own). The best hand takes the pot.</li>
      </ol>
      <p>After the first round, betting always starts with the first player still in after the dealer. The button moves one seat each hand.</p>`;
    const draw = `
      <h3>Five-card draw – how a hand goes</h3>
      <ol>
        <li><b>Blinds:</b> the two players after the dealer button put in the small and big blind (${bb / 2} and ${bb} here).</li>
        <li><b>Five private cards</b> each. First betting round, starting after the big blind.</li>
        <li><b>The draw:</b> in turn, each player still in may change up to 4 cards: tap the ones to throw away and press <i>Change</i>, or keep all five (“stand pat”). Other players can see how many cards you changed – that tells them something!</li>
        <li><b>Second betting round</b>, starting with the first player after the dealer.</li>
        <li><b>Showdown:</b> the best five-card hand wins the pot.</li>
      </ol>`;
    return `${MANUAL_STYLE}
      <p><b>Goal:</b> win chips. You win a hand by holding the best cards at the end (the <i>showdown</i>), or by betting so that everybody else gives up (<i>folds</i>). The match ends after the set number of hands – the player with most chips wins – or when one player has all the chips.</p>
      <h3>Ranking of hands (best first)</h3>
      ${rankTable([
        ["Royal flush", "A K Q J 10 of the same suit – the best hand there is."],
        ["Straight flush", "Five in a row, all the same suit."],
        ["Four of a kind", "Four cards of the same rank."],
        ["Full house", "Three of a kind plus a pair."],
        ["Flush", "Five cards of the same suit, in any order."],
        ["Straight", "Five in a row, mixed suits. The Ace can be high (10-J-Q-K-A) or low (A-2-3-4-5)."],
        ["Three of a kind", "Three cards of the same rank."],
        ["Two pair", "Two different pairs."],
        ["One pair", "Two cards of the same rank."],
        ["High card", "None of the above: your highest card counts."],
      ], "1 in {n}", settings.deck === "short")}
      <p style="font-size:12px;color:var(--muted)">${settings.deck === "short" ? "This room plays the Italian short deck: see below." : "Right-hand column: how often five random cards make that hand (52 cards)."}</p>
      <h3>The Italian deck (short)</h3>
      <p>${settings.deck === "short" ? "<b>This room uses it.</b> " : "Optional, in the room settings (Deck). "}The lowest card is <b>11 minus the number of players</b>: with 4 players the deck goes from the 7 to the Ace (32 cards), with 5 from the 6, with 6 from the 5, with 3 from the 8, with 2 from the 9. With fewer cards some hands change value:</p>
      <ul>
        <li><b>A flush beats a full house</b> – in the short deck flushes are rarer.</li>
        <li>The Ace also closes the <b>lowest straight</b> with the lowest cards: with 4 players A-7-8-9-10.</li>
      </ul>
      <h3>Ties</h3>
      <ul>
        <li>Same kind of hand: the higher cards win – a pair of Kings beats a pair of Queens; a flush with an Ace beats a flush with a King.</li>
        <li>Still equal: the remaining cards (<i>kickers</i>) decide, from the highest down: ${cardsHtml("Ah Ad Kc 7h 4s")} beats ${cardsHtml("As Ac Qd Jh 10s")}.</li>
        <li>Suits never break a tie. Exactly equal hands split the pot.</li>
        <li>In a straight the Ace can be low (A-2-3-4-5, the lowest straight) or high (10-J-Q-K-A), but not in the middle (Q-K-A-2-3 is no straight).</li>
      </ul>
      ${v === "draw" ? draw + holdem : holdem + draw}
      <h3>Words of the game</h3>
      <dl class="pk-gl">${GLOSS_ORDER.map(c => `<dt>${GLOSS.en[c][0]}</dt><dd>${GLOSS.en[c][1]}</dd>`).join("")}</dl>
      <h3>Betting</h3>
      <ul>
        <li><b>Check</b> – pass without betting (only when nobody has bet in this round).</li>
        <li><b>Bet</b> – put chips in first; the others must match it to stay in.</li>
        <li><b>Call</b> – match the current bet.</li>
        <li><b>Raise</b> – match it and add more. The minimum raise is the size of the last bet or raise (at least the big blind).</li>
        <li><b>Fold</b> – give up the hand; the chips you already put in stay in the pot.</li>
        <li><b>All-in</b> – bet all your chips. You can never be forced out because you can't match a bet: you stay in for what you have, and the extra chips the others bet go into a <i>side pot</i> that only they can win.</li>
        <li><b>Raise cap:</b> ${cap ? `after the first bet, at most <b>${cap} raises</b> per betting round in this room. Then you can only call or fold.` : "this room has no cap on raises."}</li>
        <li>A round ends when everybody still in has put in the same amount (or is all-in).</li>
        <li>If you run out of time you check when you can, otherwise you fold.</li>
      </ul>
      <h3>After each hand</h3>
      <p>The result stays on screen (${settings.pause ? settings.pause + " seconds" : "until everybody is ready"}): who won, with which hand, <i>why</i> it beat the others, and every hand shown – the five cards that count are highlighted. Press <b>Next hand</b> when you're ready; during the next hand, <b>Last hand</b> shows it again.</p>
      <h3>Modes in this room</h3>
      <ul>
        <li><b>Normal</b> – you only see your own cards, like a real table.</li>
        <li><b>Advice</b> – a blue box tells you what you hold, your <i>chance to win</i> (the server deals the unknown cards hundreds of times and counts), the price of calling, a suggested move and in draw which cards to change. <i>Follow the advice</i> plays it for you.</li>
        <li><b>Demo</b> – a learning table: all cards are face up, every player shows a chance-to-win badge, and everybody gets advice.</li>
      </ul>
      <p><b>Pot odds</b>, the idea behind the advice: if calling costs 20 and the pot already holds 80, you pay 20 to win 100 – worth it if you win more than 20 times in 100 (20%). The yellow mark on the advice bar shows that price; the blue bar your chance.</p>
      <h3>Tips for beginners</h3>
      <ul>
        <li>Play few hands, but play them firmly: fold weak starting cards and bet your good ones.</li>
        <li>Hold'em: pairs and two high cards (A, K, Q, J), especially of the same suit, are good starts.</li>
        <li>Your position matters: acting last, you see what the others do first.</li>
        <li>Don't chase draws (four to a flush or straight) if calling costs much more than the pot odds allow.</li>
        <li>Watch how many cards others change in draw: standing pat usually means a made hand… or a bluff.</li>
      </ul>
      <h3>Controls</h3>
      <ul>
        <li><b>Buttons</b> under the table (beside it on a sideways phone). Drag the slider or use Min / ½ pot / Pot / All-in to choose a bet.</li>
        <li><b>Keyboard:</b> F fold · C or Space check/call · R bet/raise · A all-in · ↑ ↓ change the amount · H follow the advice · N next hand · in draw: 1–5 pick cards, Enter to change · Esc to leave.</li>
        <li><b>Draw:</b> tap or click your cards to mark the ones to change.</li>
        <li><b>Step by step</b> (room setting, playing alone): each computer move is announced – with its reasoning in Advice and Demo – and waits for <b>Continue</b> (Enter).</li>
        <li><b>Language:</b> English or Italiano, in the room screen (each player chooses their own).</li>
      </ul>`;
  }

  function manualIt(settings) {
    const v = settings.variant, cap = settings.cap, bb = settings.blinds;
    const holdem = `
      <h3>Texas Hold'em – come si svolge una mano</h3>
      <ol>
        <li><b>I bui.</b> I due giocatori dopo il bottone del mazziere (D) mettono le puntate obbligatorie: il piccolo buio e il grande buio (qui ${bb / 2} e ${bb}).</li>
        <li><b>Due carte private</b> a testa, coperte. Poi il primo giro di puntate, a partire dal giocatore dopo il grande buio.</li>
        <li><b>Il flop:</b> tre carte comuni vengono scoperte al centro del tavolo. Giro di puntate.</li>
        <li><b>Il turn:</b> una quarta carta comune. Giro di puntate.</li>
        <li><b>Il river:</b> la quinta e ultima carta comune. Ultimo giro di puntate.</li>
        <li><b>Lo showdown (si mostrano le carte):</b> ogni giocatore rimasto forma la miglior mano di cinque carte con le sue due più le cinque sul tavolo (in qualunque combinazione: tutte e due, una sola o anche nessuna delle sue). La mano migliore vince il piatto.</li>
      </ol>
      <p>Dopo il primo giro si comincia sempre dal primo giocatore ancora in gioco dopo il mazziere. Il bottone si sposta di un posto a ogni mano.</p>`;
    const draw = `
      <h3>Poker classico a 5 carte – come si svolge una mano</h3>
      <ol>
        <li><b>I bui:</b> i due giocatori dopo il bottone del mazziere mettono il piccolo e il grande buio (qui ${bb / 2} e ${bb}).</li>
        <li><b>Cinque carte private</b> a testa. Primo giro di puntate, dopo il grande buio.</li>
        <li><b>Il cambio:</b> a turno, chi è ancora in gioco può cambiare fino a 4 carte: tocca quelle da scartare e premi <i>Cambia</i>, oppure tienile tutte (“servito”). Gli altri vedono quante carte hai cambiato – e questo dice qualcosa!</li>
        <li><b>Secondo giro di puntate</b>, dal primo giocatore dopo il mazziere.</li>
        <li><b>Showdown:</b> la miglior mano di cinque carte vince il piatto.</li>
      </ol>`;
    return `${MANUAL_STYLE}
      <p><b>Scopo:</b> vincere fiches. Vinci una mano avendo le carte migliori alla fine (lo <i>showdown</i>), oppure puntando in modo che tutti gli altri rinuncino (<i>lasciano</i>). La partita finisce dopo il numero di mani stabilito – vince chi ha più fiches – oppure quando un giocatore ha tutte le fiches.</p>
      <h3>Valore delle mani (dalla migliore)</h3>
      ${rankTable([
        ["Scala reale massima", "A K Q J 10 dello stesso seme – la mano migliore in assoluto."],
        ["Scala reale", "Cinque carte in fila, tutte dello stesso seme."],
        ["Poker", "Quattro carte dello stesso valore."],
        ["Full", "Un tris più una coppia."],
        ["Colore", "Cinque carte dello stesso seme, in qualunque ordine."],
        ["Scala", "Cinque carte in fila, di semi diversi. L'Asso può essere alto (10-J-Q-K-A) o basso (A-2-3-4-5)."],
        ["Tris", "Tre carte dello stesso valore."],
        ["Doppia coppia", "Due coppie diverse."],
        ["Coppia", "Due carte dello stesso valore."],
        ["Carta alta", "Niente di tutto ciò: conta la carta più alta."],
      ], "1 su {n}", settings.deck === "short")}
      <p style="font-size:12px;color:var(--muted)">${settings.deck === "short" ? "Questa stanza gioca con il mazzo corto all'italiana: vedi sotto." : "Colonna a destra: quanto spesso cinque carte a caso formano quella mano (52 carte)."}</p>
      <h3>Il mazzo all'italiana (corto)</h3>
      <p>${settings.deck === "short" ? "<b>Questa stanza lo usa.</b> " : "Facoltativo, nelle impostazioni della stanza (Mazzo). "}La carta più bassa è <b>11 meno il numero di giocatori</b>: in 4 si gioca dal 7 all'Asso (32 carte), in 5 dal 6, in 6 dal 5, in 3 dall'8, in 2 dal 9. Con meno carte alcune mani cambiano valore:</p>
      <ul>
        <li><b>Il colore batte il full</b> – con il mazzo corto il colore è più raro.</li>
        <li>L'Asso chiude anche la <b>scala più bassa</b> con le carte più basse: in 4 giocatori A-7-8-9-10.</li>
      </ul>
      <h3>Parità</h3>
      <ul>
        <li>Stesso tipo di mano: vincono le carte più alte – una coppia di Re batte una coppia di Donne; un colore con l'Asso batte un colore con il Re.</li>
        <li>Ancora pari: decidono le carte restanti (<i>kicker</i>, carte di spareggio), dalla più alta: ${cardsHtml("Ah Ad Kc 7h 4s")} batte ${cardsHtml("As Ac Qd Jh 10s")}.</li>
        <li>I semi non contano mai per lo spareggio. Mani esattamente uguali si dividono il piatto.</li>
        <li>Nella scala l'Asso può essere basso (A-2-3-4-5, la scala più bassa) o alto (10-J-Q-K-A), ma non in mezzo (Q-K-A-2-3 non è una scala).</li>
        <li>Le figure sono indicate con le lettere inglesi: J = Fante, Q = Donna, K = Re, A = Asso.</li>
      </ul>
      ${v === "draw" ? draw + holdem : holdem + draw}
      <h3>Le parole del gioco</h3>
      <dl class="pk-gl">${GLOSS_ORDER.map(c => `<dt>${GLOSS.it[c][0]}</dt><dd>${GLOSS.it[c][1]}</dd>`).join("")}</dl>
      <h3>Le puntate</h3>
      <ul>
        <li><b>Bussa</b> (check) – passi senza puntare (solo se nessuno ha puntato in questo giro).</li>
        <li><b>Punta</b> (bet) – metti per primo delle fiches; gli altri devono pareggiare per restare in gioco.</li>
        <li><b>Vedi</b> (call) – pareggi la puntata attuale.</li>
        <li><b>Rilancia</b> (raise) – pareggi e aggiungi. Il rilancio minimo è pari all'ultima puntata o rilancio (almeno il grande buio).</li>
        <li><b>Lascia</b> (fold) – rinunci alla mano; le fiches già messe restano nel piatto.</li>
        <li><b>All-in</b> – punti tutte le tue fiches. Non puoi mai essere escluso perché non riesci a pareggiare: resti in gioco per quello che hai, e le fiches in più degli altri vanno in un <i>piatto laterale</i> che solo loro possono vincere.</li>
        <li><b>Limite di rilanci:</b> ${cap ? `dopo la prima puntata, al massimo <b>${cap} rilanci</b> per giro in questa stanza. Poi puoi solo vedere o lasciare.` : "in questa stanza non c'è limite ai rilanci."}</li>
        <li>Un giro finisce quando tutti quelli ancora in gioco hanno messo la stessa cifra (o sono all-in).</li>
        <li>Se finisce il tempo, bussi se puoi, altrimenti lasci la mano.</li>
      </ul>
      <h3>Dopo ogni mano</h3>
      <p>Il risultato resta sullo schermo (${settings.pause ? settings.pause + " secondi" : "finché tutti sono pronti"}): chi ha vinto, con quale mano, <i>perché</i> ha battuto le altre, e tutte le mani mostrate – le cinque carte che contano sono evidenziate. Premi <b>Prossima mano</b> quando sei pronto; durante la mano seguente <b>Mano precedente</b> la mostra di nuovo.</p>
      <h3>Modalità della stanza</h3>
      <ul>
        <li><b>Normale</b> – vedi solo le tue carte, come a un tavolo vero.</li>
        <li><b>Consigli</b> – un riquadro blu ti dice cosa hai, la <i>probabilità di vincere</i> (il server distribuisce centinaia di volte le carte che non conosci e conta), quanto costa vedere, la mossa consigliata e, nel classico, quali carte cambiare. <i>Segui il consiglio</i> la gioca per te.</li>
        <li><b>Demo</b> – un tavolo per imparare: tutte le carte sono scoperte, ogni giocatore mostra la sua probabilità di vincere e tutti ricevono consigli.</li>
      </ul>
      <p><b>Le pot odds</b> (quota del piatto), l'idea dietro i consigli: se vedere costa 20 e nel piatto ci sono già 80, paghi 20 per vincere 100 – conviene se vinci più di 20 volte su 100 (20%). Il segno giallo sulla barra dei consigli indica quel prezzo; la barra blu la tua probabilità.</p>
      <h3>Consigli per chi comincia</h3>
      <ul>
        <li>Gioca poche mani, ma giocale con decisione: lascia le carte iniziali deboli e punta su quelle buone.</li>
        <li>Hold'em: le coppie e due carte alte (A, K, Q, J), soprattutto dello stesso seme, sono buone partenze.</li>
        <li>La posizione conta: parlando per ultimo vedi prima cosa fanno gli altri.</li>
        <li>Non inseguire i progetti (quattro carte per colore o scala) se vedere costa molto più di quanto permettono le pot odds.</li>
        <li>Nel classico guarda quante carte cambiano gli altri: chi è servito di solito ha una mano fatta… oppure bluffa.</li>
      </ul>
      <h3>Comandi</h3>
      <ul>
        <li><b>Pulsanti</b> sotto il tavolo (di fianco sul telefono girato). Trascina il cursore o usa Min / ½ piatto / Piatto / All-in per scegliere la puntata.</li>
        <li><b>Tastiera:</b> F lascia · C o Spazio bussa/vedi · R punta/rilancia · A all-in · ↑ ↓ cambia l'importo · H segui il consiglio · N prossima mano · nel classico: 1–5 scegli le carte, Invio per cambiare · Esc per uscire.</li>
        <li><b>Cambio:</b> tocca o clicca le tue carte per segnare quelle da cambiare.</li>
        <li><b>Passo passo</b> (impostazione della stanza, giocando da solo): ogni mossa del computer viene annunciata – con il ragionamento in Consigli e Demo – e aspetta <b>Continua</b> (Invio).</li>
        <li><b>Lingua:</b> English o Italiano, nella schermata della stanza (ogni giocatore sceglie la sua).</li>
      </ul>`;
  }

  function manual(api, settings) {
    LANG = api.lang ? api.lang() : "en";
    return LANG === "it" ? manualIt(settings) : manualEn(settings);
  }

  const tools = [{ id: "rules", label: "📖", title: "How to play · Come si gioca", key: "?" }];
  function onTool(api, id) { if (id === "rules") api.openManual(); }

  const controls = { hold: false, swipe: false, keys: {}, pad: { buttons: [] }, help: "" };

  window.GAMES = window.GAMES || {};
  window.GAMES.poker = {
    render(api) { wire(api); render(api); }, sounds,
    liveInfo(st) { return liveInfo(st); }, status, controls, tools, onTool, manual, languages: ["en", "it"],
    onKey, onPointer, onResize() { sizedFor = ""; },
  };
})();
