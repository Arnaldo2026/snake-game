// Breakout – browser part (wall, paddles, balls, scores, beeps, controls).
// Rules run on the server (games/breakout.py).
(() => {
  let cw = 600, ch = 675, k = 0.75, sizedFor = "";
  // the coloured cellophane strips of the cabinet, from the top: red, orange, green, yellow
  const BANDS = ["#ef4444", "#f97316", "#22c55e", "#eab308"];
  const PADDLE_BLUE = "#38bdf8";

  function resize(api, g) {
    // touch: without the buttons the field grows, leaving a strip below it for the thumb
    const reserve = api.touchDrag() ? 215 : document.body.classList.contains("touch-ui") ? 255 : 170;
    const ratio = g.w / g.h;
    const { w: availW, h: availH } = api.space(900, reserve);
    const w = Math.max(260, Math.floor(Math.min(availW, availH * ratio)));
    const key = `${w}:${window.devicePixelRatio || 1}`;
    if (key === sizedFor) return;
    sizedFor = key;
    cw = w; ch = Math.round(w / ratio); k = cw / g.w;
    const dpr = window.devicePixelRatio || 1;
    api.canvas.style.width = cw + "px";
    api.canvas.style.height = ch + "px";
    api.canvas.width = cw * dpr;
    api.canvas.height = ch * dpr;
    api.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  const DIGITS = {
    0: ["111", "101", "101", "101", "111"], 1: ["010", "110", "010", "010", "111"],
    2: ["111", "001", "111", "100", "111"], 3: ["111", "001", "111", "001", "111"],
    4: ["101", "101", "111", "001", "001"], 5: ["111", "100", "111", "001", "111"],
    6: ["111", "100", "111", "101", "111"], 7: ["111", "001", "001", "001", "001"],
    8: ["111", "101", "111", "101", "111"], 9: ["111", "101", "111", "001", "111"],
  };
  function drawNumber(ctx, n, x, top, cell) {
    for (const d of String(n)) {
      DIGITS[d].forEach((row, r) => [...row].forEach((on, c) => {
        if (on === "1") ctx.fillRect(x + c * cell, top + r * cell, cell, cell);
      }));
      x += 4 * cell;
    }
  }

  function render(api) {
    const st = api.st(), me = api.me(), g = st.game, ctx = api.ctx;
    resize(api, g);
    const players = Object.fromEntries(st.players.map(p => [p.id, p]));
    const multi = g.players.length > 1;

    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, cw, ch);

    // side and top walls
    ctx.fillStyle = "#d4d4d4";
    const wall = Math.max(2, 4 * k);
    ctx.fillRect(0, 0, wall, ch);
    ctx.fillRect(cw - wall, 0, wall, ch);
    ctx.fillRect(0, 0, cw, wall);

    // scores at the top: mine (or the only player) in big block digits
    const mine = g.players.find(p => p.id === me) || g.players[0];
    if (mine) {
      const cell = Math.max(3, Math.round(9 * k));
      ctx.fillStyle = "#f5f5f5";
      drawNumber(ctx, mine.score, 24 * k, 22 * k, cell);
      // balls left as small squares
      for (let i = 0; i < Math.max(0, mine.lives); i++) {
        ctx.fillRect(cw - (30 + i * 22) * k, 30 * k, 12 * k, 12 * k);
      }
      ctx.font = `600 ${Math.max(10, Math.round(14 * k))}px ui-monospace, Consolas, monospace`;
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      ctx.fillStyle = "#a3a3a3";
      ctx.fillText(`WALL ${g.level}`, cw / 2, 28 * k);
    }

    // the wall of bricks
    const gap = Math.max(1, 2 * k);
    g.rows.forEach((row, r) => {
      ctx.fillStyle = BANDS[Math.min(3, Math.floor(r / 2))];
      for (let c = 0; c < row.length; c++) {
        if (row[c] === "1") ctx.fillRect(c * g.bw * k + gap / 2, (g.top + r * g.bh) * k + gap / 2, g.bw * k - gap, g.bh * k - gap);
      }
    });

    // progressive: the danger line
    if (g.danger) {
      ctx.save();
      ctx.strokeStyle = "rgba(239,68,68,.6)";
      ctx.setLineDash([8 * k, 8 * k]);
      ctx.beginPath(); ctx.moveTo(0, g.danger * k); ctx.lineTo(cw, g.danger * k); ctx.stroke();
      ctx.restore();
    }

    let shift = 0;
    // paddles: blue like the cabinet's strip when alone, player colours when several
    const dv = api.dragValue("pos");
    for (const pad of g.paddles) {
      const p = players[pad.pid];
      // my paddle goes where my finger put it, without waiting for the server
      if (pad.pid === me && pad.serverX === undefined) pad.serverX = pad.x;   // keep the server's value
      if (pad.pid === me) {
        pad.x = dv !== null ? pad.w / 2 + dv * (g.w - pad.w) : pad.serverX;
        shift = pad.x - pad.serverX;
      }
      const col = multi && p ? p.color : PADDLE_BLUE;
      ctx.save();
      if (pad.pid === me && multi) { ctx.shadowColor = col; ctx.shadowBlur = 10; }
      ctx.fillStyle = col;
      for (const y of pad.ys) {
        ctx.fillRect((pad.x - pad.w / 2) * k, (y - g.paddle_h / 2) * k, pad.w * k, g.paddle_h * k);
      }
      ctx.restore();
      if (pad.pid === me && api.dragging()) {
        // a faint line under the paddle while the finger is down
        ctx.fillStyle = "rgba(255,255,255,.28)";
        const y = (pad.ys[pad.ys.length - 1] + g.paddle_h / 2 + (multi ? 22 : 10)) * k;
        ctx.fillRect((pad.x - pad.w * 0.7) * k, y, pad.w * 1.4 * k, Math.max(2, 3 * k));
      }
      if (multi && p) {
        ctx.font = `600 ${Math.max(10, Math.round(12 * k))}px system-ui, sans-serif`;
        ctx.textAlign = "center";
        ctx.textBaseline = "top";
        ctx.fillStyle = col;
        const label = pad.pid === me ? "you" : p.name;
        const half = ctx.measureText(label).width / 2 + 3;
        ctx.fillText(label, Math.min(cw - half, Math.max(half, pad.x * k)), (pad.ys[0] + g.paddle_h) * k);
      }
    }

    // balls (a trapped cavity ball blinks gently)
    const s = g.ball_size * k;
    const t = performance.now() / 1000;
    for (const [bx, y, owner, trapped, attached] of g.balls) {
      const p = players[owner];
      const x = attached && owner === me ? bx + shift : bx;     // a ball waiting on my paddle moves with it
      ctx.globalAlpha = trapped ? (Math.sin(t * 5) > 0 ? 1 : .45) : 1;
      ctx.fillStyle = multi && p && !trapped ? p.color : "#f5f5f5";
      ctx.fillRect(x * k - s / 2, y * k - s / 2, s, s);
    }
    ctx.globalAlpha = 1;

    // scoreboard chips
    api.$("chips").innerHTML = !multi ? "" : [...g.players].sort((a, b) => b.score - a.score).map(pl => {
      const p = players[pl.id];
      if (!p) return "";
      return `<span class="chip${pl.out ? " dead" : ""}${pl.id === me ? " me" : ""}">
        <span class="dot" style="background:${p.color}"></span>${api.esc(p.name)} <b>${pl.score}</b>
        <span style="opacity:.7">${"■".repeat(Math.max(0, pl.lives))}</span></span>`;
    }).join("");
    const label = { classic: "Breakout", double: "Double", cavity: "Cavity", progressive: "Progressive" }[g.mode];
    api.$("timer").textContent = `${label} · wall ${g.level}`;

    const myPad = g.paddles.find(p => p.pid === me);
    if (myPad) api.syncLever("pos", ((myPad.serverX ?? myPad.x) - myPad.w / 2) / (g.w - myPad.w));

    let big = "", small = "", huge = false, dim = false;
    const me_ = g.players.find(p => p.id === me);
    if (st.state === "lobby" && st.results) {
      big = st.results.title; dim = true;
    } else if (g.phase === "countdown") {
      big = g.countdown; huge = true;
      small = { classic: "Break the wall", double: "Two paddles, two balls",
                cavity: "Free the trapped balls", progressive: "The wall is coming down" }[g.mode];
    } else if (me_ && me_.out) {
      big = "Out of balls"; small = "Watching the others… (Exit to leave the match)"; dim = true;
    }
    api.setMessage(big, small, huge, dim);
  }

  function sounds(api, prev, next) {
    const pe = prev.game && prev.game.ev, ne = next.game && next.game.ev;
    if (!pe || !ne) return false;
    if (ne.brick > pe.brick) api.tone([880, 740, 620, 520][ne.band] || 600, 0, .05, "square", .06);
    if (ne.paddle > pe.paddle) api.tone(330, 0, .05, "square", .07);
    if (ne.wall > pe.wall) api.tone(220, 0, .04, "square", .05);
    if (ne.lost > pe.lost) api.tone(150, 0, .4, "sawtooth", .07, 60);
    // touch screens: feel your own hits and losses
    const me = api.me();
    if (ne.paddle > pe.paddle && ne.paddle_pid === me) api.buzz(28);
    else if (ne.brick > pe.brick && ne.brick_pid === me) api.buzz(12);
    if (ne.lost > pe.lost && ne.lost_pid === me) { api.buzz([90, 60, 140]); api.flash(); }
    if (ne.level > pe.level && next.game.level > 1) [523, 659, 784, 1047].forEach((f, i) => api.tone(f, i * .1, .12, "triangle", .09));
    const g = next.game, pg = prev.game;
    if (g.phase === "countdown" && g.countdown !== pg.countdown) api.play("tick");
    if (pg.phase === "countdown" && g.phase === "playing") api.play("go");
    return false;
  }

  function liveInfo(st) { return `wall ${st.game.level}`; }
  function status(st, pid) {
    const p = st.game.players.find(x => x.id === pid);
    return p ? (p.out ? `out · ${p.score} pts` : `${p.score} pts · ${p.lives} balls`) : "";
  }

  const controls = {
    hold: true,
    swipe: false,
    keys: { ArrowLeft: "left", ArrowRight: "right", a: "left", d: "right", " ": "fire", ArrowUp: "fire" },
    landscapeSplit: 0,            // sideways: keep all buttons together on the right
    pad: {
      cols: "76px 76px 76px",
      buttons: [
        { key: "left", label: "&#9664;", col: 1, row: 1 },
        { key: "fire", label: "SERVE", col: 2, row: 1 },
        { key: "right", label: "&#9654;", col: 3, row: 1 },
        { type: "lever", horizontal: true, key: "pos", name: "paddle knob", col: 1, span: 3, row: 2 },
      ],
    },
    help: "← → move the paddle · Space to serve straight away · Esc to exit",
    // phones/tablets: drag anywhere to move, tap to serve
    drag: { key: "pos", axis: "x", gain: 1.5, tap: "fire", hint: "Drag anywhere to move the paddle · tap to serve" },
  };

  window.GAMES = window.GAMES || {};
  window.GAMES.breakout = { render, sounds, liveInfo, status, controls, onResize() { sizedFor = ""; } };
})();
