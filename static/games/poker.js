// Poker – browser part: the table, the cards, the action buttons, the advice box, sounds and the manual.
// Rules, betting and the computer players run on the server (games/poker.py); each browser only ever
// receives its own cards (all of them in Demo mode).
(() => {
  const SUIT = ["♠", "♥", "♦", "♣"];
  const RANK = { 11: "J", 12: "Q", 13: "K", 14: "A" };
  const rankOf = c => Math.floor(c / 4) + 2;
  const suitOf = c => c % 4;
  const label = c => (RANK[rankOf(c)] || String(rankOf(c)));
  const red = c => suitOf(c) === 1 || suitOf(c) === 2;

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

  function resize(api) {
    const upright = window.innerWidth < 700 && window.innerHeight > window.innerWidth;
    const { w: availW, h: availH } = api.space(1100, 150);
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

  // ------------------------------------------------------------------ drawing helpers
  function rrect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
  }

  // a card centred on (x, y) in table units; card = number, or null for a face-down card
  function drawCard(ctx, card, x, y, w, h, opt = {}) {
    const X = (x - w / 2) * k, Y = (y - h / 2 - (opt.lift || 0)) * k, Wd = w * k, Ht = h * k, r = Math.max(2, 6 * k);
    ctx.save();
    ctx.globalAlpha = opt.dim ? 0.45 : 1;
    ctx.shadowColor = "rgba(0,0,0,.45)"; ctx.shadowBlur = 6 * k; ctx.shadowOffsetY = 2 * k;
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
      ctx.strokeStyle = opt.selected ? "#f59e0b" : "#cbd5e1"; ctx.lineWidth = opt.selected ? Math.max(2, 4 * k) : Math.max(1, k);
      ctx.stroke();
      const col = red(card) ? "#dc2626" : "#111827";
      ctx.fillStyle = col;
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
      ctx.font = `800 ${Math.max(8, 12 * k)}px system-ui, sans-serif`;
      ctx.textAlign = "center"; ctx.textBaseline = "bottom";
      ctx.fillText("CHANGE", X + Wd / 2, Y - 3 * k);
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
    text(ctx, amount.toLocaleString(), x + 14, y - 2, 15, "#fef3c7", 700, "left");
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
      const t = a * Math.PI / 180;
      out[j] = { x: L.cx + L.rx * Math.cos(t), y: L.cy + L.ry * Math.sin(t), rel };
    }
    return out;
  }

  // ------------------------------------------------------------------ render
  function render(api) {
    const st = api.st(), g = st.game, ctx = api.ctx, me = g.me;
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
    const showdown = g.phase === "showdown";
    const winners = new Set(showdown && g.result ? g.result.pots.flatMap(p => p.winners) : []);

    // community cards (Hold'em) or the deck (draw)
    if (g.variant === "holdem") {
      const [w, h] = L.bcard;
      for (let i = 0; i < 5; i++) {
        const x = L.cx + (i - 2) * (w + 8);
        if (g.board[i] !== undefined) drawCard(ctx, g.board[i], x, L.boardY, w, h);
        else { ctx.save(); rrect(ctx, (x - w / 2) * k, (L.boardY - h / 2) * k, w * k, h * k, 6 * k);
               ctx.strokeStyle = "rgba(255,255,255,.15)"; ctx.lineWidth = Math.max(1, 1.5 * k); ctx.stroke(); ctx.restore(); }
      }
    } else if (g.phase !== "over") {
      for (let i = 0; i < 3; i++) drawCard(ctx, null, L.cx - 2 * i, L.boardY - 2 * i, L.bcard[0], L.bcard[1]);
      if (g.phase === "draw") text(ctx, `DRAW · change up to ${g.max_draw}`, L.cx, L.boardY + L.bcard[1] / 2 + 16, 14, "#fde68a", 700);
    }

    // pot and the hand's result
    const pot = g.pot;
    if (pot && !(showdown && g.result)) text(ctx, `Pot ${pot.toLocaleString()}`, L.cx, L.potY, 20, "#fef3c7", 800);
    if (showdown && g.result) {
      const p0 = g.result.pots[0];
      const names = p0 ? p0.winners.map(i => i === g.me ? "You" : g.seats[i].name).join(" & ") : "";
      if (p0) text(ctx, `${names} ${p0.winners.length > 1 ? "split" : (p0.winners[0] === g.me ? "win" : "wins")} ${p0.amount.toLocaleString()}`,
                   L.cx, L.potY + 26, 16, "#fde68a", 800);
      if (p0 && p0.hand) text(ctx, p0.hand, L.cx, L.potY + 46, 13, "#fde68a", 600);
    }

    // seats
    hits = [];
    g.seats.forEach((s, j) => drawSeat(ctx, api, g, s, j, pos[j], winners.has(j)));

    // dealer button
    if (g.dealer != null && g.dealer >= 0 && pos[g.dealer]) {
      // beside the dealer's name plate, on the side facing the middle of the table
      const p = pos[g.dealer];
      const bx = p.x < L.cx - 40 ? p.x + L.pw / 2 + 16 : p.x - L.pw / 2 - 16, by = p.y - L.ph / 4;
      ctx.beginPath(); ctx.arc(bx * k, by * k, 12 * k, 0, Math.PI * 2);
      ctx.fillStyle = "#f8fafc"; ctx.fill(); ctx.strokeStyle = "#111"; ctx.lineWidth = Math.max(1, k); ctx.stroke();
      text(ctx, "D", bx, by + 1, 13, "#111", 900);
    }

    // HUD
    api.$("chips").innerHTML = "";
    const name = g.variant === "holdem" ? "Hold'em" : "Draw";
    api.$("timer").textContent = g.hand ? `${name} · hand ${g.hand}${g.hands ? "/" + g.hands : ""}` : name;

    // centre message
    let big = "", small = "", huge = false, dim = false;
    if (st.state === "lobby" && st.results) { big = st.results.title; dim = true; }
    else if (g.phase === "countdown") { big = "Shuffling…"; small = g.variant === "holdem" ? "Texas Hold'em" : "Five-card draw"; }
    api.setMessage(big, small, huge, dim);

    renderPanel(api, g);
  }

  function wrapText(ctx, s, x, y, maxW, size, color) {
    ctx.font = `600 ${Math.max(9, size * k)}px system-ui, sans-serif`;
    const words = s.split(" "), lines = [];
    let line = "";
    for (const w of words) {
      const t = line ? line + " " + w : w;
      if (ctx.measureText(t).width > maxW * k && line) { lines.push(line); line = w; } else line = t;
    }
    if (line) lines.push(line);
    lines.slice(0, 3).forEach((l, i) => text(ctx, l, x, y + i * (size + 5), size, color, 600));
  }

  function drawSeat(ctx, api, g, s, j, p, isWinner) {
    const mine = j === g.me;
    const turn = g.to_act === j && (g.phase === "betting" || g.phase === "draw");
    const dx = L.cx - p.x, dy = L.cy - p.y, d = Math.hypot(dx, dy) || 1, ux = dx / d, uy = dy / d;
    const gone = s.out || s.left;

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
          drawCard(ctx, card, x, L.myY, w, h, { dim: s.folded, selected, lift: selected ? 14 : 0 });
          if (advised) {
            ctx.save();
            rrect(ctx, (x - w / 2 - 3) * k, (L.myY - h / 2 - 3) * k, (w + 6) * k, (h + 6) * k, 8 * k);
            ctx.setLineDash([5 * k, 4 * k]); ctx.strokeStyle = "#60a5fa"; ctx.lineWidth = Math.max(1.5, 2.5 * k); ctx.stroke();
            ctx.restore();
            text(ctx, "change?", x, L.myY - h / 2 - 12, 11, "#93c5fd", 800);
          }
          hits.push({ i, x: (x - w / 2) * k, y: (L.myY - h / 2 - 14) * k, w: w * k, h: (h + 14) * k });
        }
        if (s.hand) text(ctx, s.hand, p.x, p.y + L.ph / 2 + 12 * L.fs, 14, "#e2e8f0", 700);
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
          drawCard(ctx, s.cards ? s.cards[i] : null, x, cy, w, h, { dim: s.folded });
        }
      }
    }

    // bet in front of the seat
    if (s.bet && !gone) {
      if (mine) chipStack(ctx, L.cx + (s.n * (L.big[0] + 8)) / 2 + 22, L.myY + 30, s.bet);
      else chipStack(ctx, p.x + ux * (128 + Math.abs(ux) * 60) - 10, p.y + uy * 118, s.bet);
    }

    // name plate
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
    const nm = (mine ? "You" : s.name) + (s.bot ? " 🤖" : "");
    text(ctx, nm.length > 13 ? nm.slice(0, 12) + "…" : nm, X + 24, Y + lh * 0.95, 15, "#f1f5f9", 700, "left");
    text(ctx, gone ? (s.left ? "left" : "out") : s.chips.toLocaleString(), X + 12, Y + lh * 2.05, 15, "#fde68a", 800, "left");
    const act = s.waiting ? "joins next hand" : s.allin && !s.action.startsWith("All") ? "All-in" : s.action;
    const maxc = L === TALL ? 19 : 24;
    if (act) text(ctx, act.length > maxc ? act.slice(0, maxc - 1) + "…" : act, X + 12, Y + lh * 3.0, 12,
                  isWinner ? "#facc15" : "#94a3b8", 600, "left");
    ctx.restore();

    // whose turn: a shrinking bar under the plate
    if (turn && g.turn_left != null && g.timer) {
      const f = Math.max(0, Math.min(1, g.turn_left / g.timer));
      ctx.fillStyle = f < 0.25 ? "#ef4444" : "#4ade80";
      ctx.fillRect((X + 8) * k, (Y + ph - 4) * k, (pw - 16) * f * k, 3 * k);
    }
    if (turn && s.bot) text(ctx, "thinking…", X + pw - 10, Y + lh * 2.05, 11, "#94a3b8", 600, "right");

    // Demo: everybody's chance to win
    const eq = g.equity && g.equity[j];
    if (eq != null && !s.folded) {
      const tx = X + pw - 8, ty = Y - 2;
      const t = `${Math.round(eq * 100)}%`;
      ctx.font = `800 ${Math.max(9, 13 * k)}px system-ui, sans-serif`;
      const tw = ctx.measureText(t).width / k + 12;
      rrect(ctx, (tx - tw) * k, (ty - 10) * k, tw * k, 20 * k, 9 * k);
      ctx.fillStyle = "#1d4ed8"; ctx.fill();
      text(ctx, t, tx - tw / 2, ty, 13, "#fff", 800);
    }
    // what a winner won
    if (isWinner && s.won) text(ctx, `+${s.won.toLocaleString()}`, p.x, Y - 12, 18, "#facc15", 900);
  }

  // ------------------------------------------------------------------ the action panel (HTML)
  const btn = (act, txt, cls = "", extra = "") => `<button data-act="${act}" class="${cls}" ${extra}>${txt}</button>`;

  function renderPanel(api, g) {
    const panel = api.$("gamePanel");
    // keep the panel the same height all match long (the table would jump otherwise)
    const upright = window.innerWidth < 700 && window.innerHeight > window.innerWidth;
    const minH = document.body.classList.contains("landscape") || upright ? "" : (g.mode === "normal" ? "190px" : "300px");
    if (panel.style.minHeight !== minH) { panel.style.minHeight = minH; sizedFor = ""; }
    if (!g.seats.length || api.st().state !== "match") {
      if (panel.innerHTML) panel.innerHTML = "";
      panel.style.minHeight = ""; panelKey = ""; return;
    }
    const me = g.me, mySeat = me != null ? g.seats[me] : null;
    const myTurn = me != null && g.to_act === me;
    const o = g.options;
    const handKey = `${g.hand}:${g.phase}:${g.to_act}`;
    if (selFor !== handKey) { sel = new Set(); selFor = handKey; }
    if (o) amount = Math.max(o.min_to, Math.min(o.max_to, amount || o.min_to));

    const key = JSON.stringify([g.phase, g.to_act, g.hand, o, g.advice, myTurn && g.phase === "draw" ? [...sel] : 0,
                                g.cap, g.raises, g.pot, mySeat && mySeat.chips, g.seats.map(s => s.action)]);
    const timeLeft = g.turn_left != null ? ` · ${g.turn_left}s` : "";
    if (key === panelKey) {
      const t = panel.querySelector("#pkTime"); if (t) t.textContent = timeLeft;
      return;
    }
    panelKey = key;

    const info = [`Blinds ${g.sb}/${g.bb}`, `Raises ${g.raises}/${g.cap || "∞"}`].join(" · ");
    let head = "", actions = "";
    const who = g.to_act != null ? g.seats[g.to_act] : null;
    if (g.phase === "showdown") head = g.result ? g.result.text : "";
    else if (myTurn && g.phase === "betting") head = o.to_call ? `Your turn – ${o.to_call.toLocaleString()} to call` : "Your turn";
    else if (myTurn && g.phase === "draw") head = `Your turn – tap the cards to change (up to ${g.max_draw})`;
    else if (who) head = who.bot ? `${who.name} is thinking…` : `Waiting for ${who.name}…`;
    else if (g.phase === "runout") head = "All-in – dealing the rest of the cards";
    else if (mySeat && mySeat.waiting) head = "You'll be dealt in at the next hand";
    if (mySeat && (mySeat.out || mySeat.left)) head = mySeat.out ? "You're out of chips – watching the table" : head;

    if (myTurn && g.phase === "betting" && o) {
      const callTxt = o.to_call ? (o.call < o.to_call ? `All-in ${(mySeat.bet + o.call).toLocaleString()}` : `Call ${o.to_call.toLocaleString()}`) : "Check";
      actions = `<div class="pk-row">${btn("fold", "Fold <small>F</small>", "danger")}${btn(o.to_call ? "call" : "check", `${callTxt} <small>C</small>`, "primary")}</div>`;
      if (o.can_raise) {
        const step = Math.max(1, g.sb);
        actions += `<div class="pk-row pk-raise">
          <input id="pkAmt" type="range" min="${o.min_to}" max="${o.max_to}" step="${step}" value="${amount}" aria-label="Amount">
          ${btn("raise", `${o.word} ${o.word === "Raise" ? "to " : ""}<b id="pkAmtTxt">${amount.toLocaleString()}</b> <small>R</small>`)}</div>
          <div class="pk-row pk-quick">${btn("amt-min", "Min")}${btn("amt-half", "½ pot")}${btn("amt-pot", "Pot")}${btn("allin", "All-in <small>A</small>")}</div>`;
      } else if (o.capped) {
        actions += `<div class="hint">Raise cap reached: ${g.cap} raises this round – call or fold.</div>`;
      }
    } else if (myTurn && g.phase === "draw") {
      const n = sel.size;
      actions = `<div class="pk-row">${btn("draw", n ? `Change ${n} card${n > 1 ? "s" : ""} <small>Enter</small>` : "Keep all (stand pat) <small>Enter</small>", "primary")}</div>`;
    }

    // advice
    let adv = "";
    const a = g.advice;
    if (a) {
      const pct = Math.round(a.eq * 100);
      const sugg = a.suggest ? { fold: "Fold", check: "Check", call: "Call", raise: o && o.word === "Bet" ? `Bet ${a.to}` : `Raise to ${a.to}` }[a.suggest] : "";
      adv = `<div class="pk-adv">
        <div><b>${api.esc(a.hand)}</b> · chance to win <b>${pct}%</b> against ${a.opp} player${a.opp === 1 ? "" : "s"}</div>
        <div class="pk-bar"><span style="width:${pct}%"></span>${a.need ? `<i style="left:${Math.round(a.need * 100)}%" title="needed to call"></i>` : ""}</div>
        ${a.text ? `<div>${sugg ? `<b>Advice: ${api.esc(sugg)}.</b> ` : "<b>Advice:</b> "}${api.esc(a.text)}</div>` : ""}
        ${a.improve != null ? `<div>Chance to improve with this change: <b>${Math.round(a.improve * 100)}%</b></div>` : ""}
        ${myTurn && (a.suggest || a.discard) ? `<div class="pk-row">${btn("follow", "Follow the advice <small>H</small>")}</div>` : ""}
      </div>`;
    }

    panel.innerHTML = `<style>
        body.landscape #gamePanel { padding-top: 92px; }
        .pk-wrap { display: flex; flex-direction: column; gap: 6px; min-height: 120px; font-size: 14px; }
        .pk-head { font-weight: 700; font-size: 15px; } .pk-info { color: var(--muted); font-size: 12px; }
        .pk-row { display: flex; gap: 6px; flex-wrap: wrap; } .pk-row button { flex: 1 1 0; padding: 10px 8px; font-size: 15px; }
        .pk-row button small { opacity: .5; font-size: 11px; margin-left: 4px; }
        .pk-raise input { flex: 2 1 160px; accent-color: var(--accent); } .pk-quick button { padding: 6px; font-size: 13px; }
        .pk-adv { background: rgba(29, 78, 216, .16); border-left: 3px solid #3b82f6; border-radius: 8px; padding: 8px 10px;
                  display: flex; flex-direction: column; gap: 5px; font-size: 13px; line-height: 1.35; }
        .pk-bar { position: relative; height: 8px; background: rgba(255,255,255,.12); border-radius: 4px; overflow: hidden; }
        .pk-bar span { position: absolute; inset: 0 auto 0 0; background: #3b82f6; }
        .pk-bar i { position: absolute; top: -2px; bottom: -2px; width: 3px; background: #facc15; }
      </style>
      <div class="pk-wrap">
        <div class="pk-head">${api.esc(head)}<span id="pkTime" class="pk-info">${timeLeft}</span></div>
        <div class="pk-info">${info}${g.pot ? ` · Pot ${g.pot.toLocaleString()}` : ""}</div>
        ${actions}${adv}
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
      const t = panel.querySelector("#pkAmtTxt"); if (t) t.textContent = amount.toLocaleString();
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
    const t = api.$("gamePanel").querySelector("#pkAmtTxt"); if (t) t.textContent = amount.toLocaleString();
  }

  function act(api, what) {
    const g = api.st().game, o = g.options, mySeat = g.me != null ? g.seats[g.me] : null;
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

  // keyboard: F fold · C / Space check-call · R raise · A all-in · ↑↓ amount · 1-5 pick cards · Enter draw · H advice
  function onKey(api, key) {
    const g = api.st().game;
    if (!g || g.me == null || g.to_act !== g.me) return false;
    const k2 = key.toLowerCase();
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
    for (const h of hits) {
      if (x >= h.x && x <= h.x + h.w && y >= h.y && y <= h.y + h.h) { toggle(api, h.i); return; }
    }
  }

  // ------------------------------------------------------------------ sounds
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
    const g = st.game;
    return g.hand ? `hand ${g.hand}${g.hands ? " of " + g.hands : ""}` : "starting";
  }
  function status(st, pid) {
    const s = st.game.seats.find(x => x.pid === pid);
    if (!s) return "";
    return s.out ? "out of chips" : `${s.chips.toLocaleString()} chips`;
  }

  // ------------------------------------------------------------------ the manual
  function cardsHtml(list) {
    return `<span class="pk-cards">${list.split(" ").map(t => {
      const r = t.slice(0, -1), s = t.slice(-1);
      const sym = { s: "♠", h: "♥", d: "♦", c: "♣" }[s];
      return `<span class="pkc${s === "h" || s === "d" ? " r" : ""}">${r}${sym}</span>`;
    }).join("")}</span>`;
  }

  function manual(api, settings) {
    const v = settings.variant, cap = settings.cap, bb = settings.blinds;
    const RANKS = [
      ["Royal flush", "A K Q J 10 of the same suit – the best hand there is.", "As Ks Qs Js 10s", "1 in 649,740"],
      ["Straight flush", "Five in a row, all the same suit.", "9h 8h 7h 6h 5h", "1 in 72,193"],
      ["Four of a kind", "Four cards of the same rank.", "Kc Kd Kh Ks 2d", "1 in 4,165"],
      ["Full house", "Three of a kind plus a pair.", "Qs Qd Qh 3c 3d", "1 in 694"],
      ["Flush", "Five cards of the same suit, in any order.", "Ah 9h 7h 4h 2h", "1 in 509"],
      ["Straight", "Five in a row, mixed suits. The Ace can be high (10-J-Q-K-A) or low (A-2-3-4-5).", "10d 9c 8s 7h 6d", "1 in 255"],
      ["Three of a kind", "Three cards of the same rank.", "7s 7d 7c Kh 2h", "1 in 47"],
      ["Two pair", "Two different pairs.", "Js Jd 4c 4h Ah", "1 in 21"],
      ["One pair", "Two cards of the same rank.", "6s 6d Kc 9h 2h", "1 in 2.4"],
      ["High card", "None of the above: your highest card counts.", "As Jd 8c 6h 2h", "1 in 2"],
    ];
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
    return `<style>
        .pk-cards { display: inline-flex; gap: 3px; white-space: nowrap; }
        .pkc { display: inline-block; min-width: 30px; padding: 2px 4px; border-radius: 5px; background: #fdfdfb; color: #111827;
               font-weight: 800; font-size: 14px; text-align: center; border: 1px solid #cbd5e1; }
        .pkc.r { color: #dc2626; }
        .pk-rank { width: 100%; border-collapse: collapse; font-size: 14px; }
        .pk-rank td { padding: 6px 6px; border-bottom: 1px solid var(--line); vertical-align: top; }
        .pk-rank td:first-child { font-weight: 800; color: var(--muted); }
        .pk-rank .odds { color: var(--muted); font-size: 12px; white-space: nowrap; }
        @media (max-width: 600px) { .pk-rank .odds { display: none; } .pkc { min-width: 24px; font-size: 12px; } }
      </style>
      <p><b>Goal:</b> win chips. You win a hand by holding the best cards at the end (the <i>showdown</i>), or by betting so that everybody else gives up (<i>folds</i>). The match ends after the set number of hands – the player with most chips wins – or when one player has all the chips.</p>

      <h3>Ranking of hands (best first)</h3>
      <table class="pk-rank">${RANKS.map((r, i) => `<tr><td>${i + 1}</td><td><b>${r[0]}</b><br>${r[1]}</td>
        <td>${cardsHtml(r[2])}</td><td class="odds">${r[3]}</td></tr>`).join("")}</table>
      <p style="font-size:12px;color:var(--muted)">Right-hand column: how often five random cards make that hand.</p>

      <h3>Ties</h3>
      <ul>
        <li>Same kind of hand: the higher cards win – a pair of Kings beats a pair of Queens; a flush with an Ace beats a flush with a King.</li>
        <li>Still equal: the remaining cards (<i>kickers</i>) decide, from the highest down: ${cardsHtml("Ah Ad Kc 7h 4s")} beats ${cardsHtml("As Ac Qd Jh 10s")}.</li>
        <li>Suits never break a tie. Exactly equal hands split the pot.</li>
        <li>In a straight the Ace can be low (A-2-3-4-5, the lowest straight) or high (10-J-Q-K-A), but not in the middle (Q-K-A-2-3 is no straight).</li>
      </ul>

      ${v === "draw" ? draw + holdem : holdem + draw}

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

      <h3>Modes in this room</h3>
      <ul>
        <li><b>Normal</b> – you only see your own cards, like a real table.</li>
        <li><b>Advice</b> – a blue box tells you what you hold, your <i>chance to win</i> (the server deals the unknown cards thousands of times and counts), the price of calling, a suggested move and in draw which cards to change. <i>Follow the advice</i> plays it for you.</li>
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
        <li><b>Keyboard:</b> F fold · C or Space check/call · R bet/raise · A all-in · ↑ ↓ change the amount · H follow the advice · in draw: 1–5 pick cards, Enter to change · Esc to leave.</li>
        <li><b>Draw:</b> tap or click your cards to mark the ones to change.</li>
      </ul>`;
  }

  const tools = [{ id: "rules", label: "📖", title: "How to play (rules and hand ranking)", key: "?" }];
  function onTool(api, id) { if (id === "rules") api.openManual(); }

  const controls = {
    hold: false, swipe: false, keys: {}, pad: { buttons: [] },
    help: "F fold · C check/call · R raise · A all-in · ↑↓ amount · H advice · Esc to exit",
  };

  window.GAMES = window.GAMES || {};
  window.GAMES.poker = {
    render(api) { wire(api); render(api); }, sounds, liveInfo, status, controls, tools, onTool, manual,
    onKey, onPointer, onResize() { sizedFor = ""; },
  };
})();
