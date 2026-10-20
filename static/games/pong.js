// Pong Tennis – browser part (court, block digits, bars, ball, beeps, controls).
// Rules run on the server (games/pong.py).
(() => {
  let cw = 800, ch = 560, k = 0.8, sizedFor = "";

  function resize(api, g) {
    const reserve = api.touchDrag() ? 175 : document.body.classList.contains("touch-ui") ? 255 : 170;
    const ratio = g.w / g.h;
    const { w: availW, h: availH } = api.space(1100, reserve);
    const w = Math.max(280, Math.floor(Math.min(availW, availH * ratio)));
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

  // the chunky score digits of the early TV games (3 × 5 blocks)
  const DIGITS = {
    0: ["111", "101", "101", "101", "111"], 1: ["010", "110", "010", "010", "111"],
    2: ["111", "001", "111", "100", "111"], 3: ["111", "001", "111", "001", "111"],
    4: ["101", "101", "111", "001", "001"], 5: ["111", "100", "111", "001", "111"],
    6: ["111", "100", "111", "101", "111"], 7: ["111", "001", "001", "001", "001"],
    8: ["111", "101", "111", "101", "111"], 9: ["111", "101", "111", "001", "111"],
  };
  function drawNumber(ctx, n, cx, top, cell) {
    const s = String(n);
    const width = s.length * 4 * cell - cell;
    let x = cx - width / 2;
    for (const ch of s) {
      DIGITS[ch].forEach((row, r) => [...row].forEach((on, c) => {
        if (on === "1") ctx.fillRect(x + c * cell, top + r * cell, cell, cell);
      }));
      x += 4 * cell;
    }
  }

  function render(api) {
    const st = api.st(), me = api.me(), g = st.game, ctx = api.ctx;
    resize(api, g);
    const players = Object.fromEntries(st.players.map(p => [p.id, p]));
    const white = "#f5f5f5";

    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, cw, ch);

    // net (or the squash wall)
    ctx.fillStyle = white;
    if (g.solo) {
      ctx.fillRect(cw - g.wall * k, 0, g.wall * k, ch);
    } else {
      const dash = Math.max(4, 18 * k);
      for (let y = dash / 2; y < ch; y += dash * 2) ctx.fillRect(cw / 2 - 2 * k - 1, y, 4 * k + 2, dash);
    }

    // scores
    const cell = Math.max(4, Math.round(13 * k));
    ctx.fillStyle = white;
    if (g.solo) {
      drawNumber(ctx, g.solo_hits, cw * 0.3, cell * 2, cell);
      for (let i = 0; i < g.solo_balls; i++) ctx.fillRect(cw * 0.62 + i * cell * 2.2, cell * 3.2, cell * 1.3, cell * 1.3);
    } else {
      drawNumber(ctx, g.score[0], cw * 0.25, cell * 2, cell);
      drawNumber(ctx, g.score[1], cw * 0.75, cell * 2, cell);
    }

    // bars: mine glow a little; names under them when several people play
    const dv = api.dragValue("pos");
    for (const bar of g.bars) {
      const mine = bar.pids.includes(me);
      // my bars go where my finger put them, without waiting for the server
      if (bar.pids[0] === me && dv !== null) bar.y = bar.h / 2 + (1 - dv) * (g.h - bar.h);
      const x = (bar.x - g.bar_w / 2) * k, y = (bar.y - bar.h / 2) * k;
      if (bar.pids[0] === me && api.dragging()) {
        // a faint line beside the bar while the finger is down
        ctx.fillStyle = "rgba(255,255,255,.28)";
        const side = bar.x < g.w / 2 ? -1 : 1;
        ctx.fillRect(x + (side < 0 ? -12 * k : (g.bar_w + 9) * k), y - bar.h * 0.2 * k, Math.max(2, 3 * k), bar.h * 1.4 * k);
      }
      ctx.save();
      if (mine && st.players.length > 1) { ctx.shadowColor = "#ffffff"; ctx.shadowBlur = 10; }
      ctx.fillStyle = white;
      ctx.fillRect(x, y, g.bar_w * k, bar.h * k);
      ctx.restore();
      if (st.players.length > 1 && bar.pids.length) {
        const p = players[bar.pids[0]];
        if (p) {
          ctx.font = `600 ${Math.max(10, Math.round(13 * k))}px system-ui, sans-serif`;
          ctx.textAlign = "center";
          ctx.textBaseline = "top";
          ctx.fillStyle = p.color;
          const ty = y + bar.h * k + 4 > ch - 16 ? y - 16 : y + bar.h * k + 4;
          const label = bar.pids[0] === me ? "you" : p.name;
          const half = ctx.measureText(label).width / 2 + 3;          // keep the name inside the court
          const tx = Math.min(cw - half, Math.max(half, x + g.bar_w * k / 2));
          ctx.fillText(label, tx, ty);
        }
      }
    }

    // the square ball
    if (g.ball) {
      const s = g.ball_size * k;
      ctx.fillStyle = white;
      ctx.fillRect(g.ball[0] * k - s / 2, g.ball[1] * k - s / 2, s, s);
    }

    // scoreboard chips: the two sides
    if (g.solo) {
      api.$("chips").innerHTML = "";
      api.$("timer").textContent = "Squash practice";
    } else {
      api.$("chips").innerHTML = [0, 1].map(side => {
        const names = g.sides[side].map(pid => players[pid]).filter(Boolean);
        const mineSide = g.sides[side].includes(me);
        return `<span class="chip${mineSide ? " me" : ""}">${names.map(p =>
          `<span class="dot" style="background:${p.color}"></span>${api.esc(p.name)}`).join(" ")}
          <b>${g.score[side]}</b></span>`;
      }).join("");
      api.$("timer").textContent = `First to ${g.target}`;
    }

    // keep the knob/lever in step with my bar
    const myBar = g.bars.find(b => b.pids.includes(me));
    if (myBar) api.syncLever("pos", 1 - (myBar.y - myBar.h / 2) / (g.h - myBar.h));

    let big = "", small = "", huge = false, dim = false;
    if (st.state === "lobby" && st.results) {
      big = st.results.title; dim = true;
    } else if (g.phase === "countdown") {
      big = g.countdown; huge = true;
      if (g.solo) small = "Squash against the wall · 3 balls";
      else {
        const side = g.sides[0].includes(me) ? "left" : g.sides[1].includes(me) ? "right" : "";
        small = side ? `You play on the ${side}` : "";
      }
    }
    api.setMessage(big, small, huge, dim);
  }

  // the three classic beeps: bar, wall and point
  function sounds(api, prev, next) {
    const pg = prev.game, ng = next.game;
    if (!pg || !ng || ng.hits == null) return false;
    if (ng.hits > pg.hits) api.tone(459, 0, .05, "square", .07);
    if (ng.walls > pg.walls) api.tone(226, 0, .04, "square", .06);
    if (ng.points > pg.points) api.tone(490, 0, .26, "square", .07);
    // touch screens: feel your own hits, and the points you lose
    const me = api.me();
    if (ng.hits > pg.hits && ng.hit_pid === me) api.buzz(28);
    if (ng.points > pg.points && ng.point_to != null) {
      const mySide = ng.sides[1].includes(me) ? 1 : ng.sides[0].includes(me) ? 0 : -1;
      if (mySide >= 0 && ng.point_to !== mySide) { api.buzz([90, 60, 140]); api.flash(); }
    }
    if (ng.phase === "countdown" && ng.countdown !== pg.countdown) api.play("tick");
    return false;
  }

  function liveInfo(st) {
    const g = st.game;
    return g.solo ? "squash practice" : `${g.score[0]}–${g.score[1]}`;
  }

  function status(st, pid) {
    const g = st.game;
    if (g.sides[0].includes(pid)) return "left side";
    if (g.sides[1].includes(pid)) return "right side";
    return "";
  }

  const controls = {
    hold: true,
    swipe: false,
    keys: { ArrowUp: "up", ArrowDown: "down", w: "up", s: "down" },
    pad: {
      cols: "84px 12px 84px",
      buttons: [
        { key: "up", label: "&#9650;", col: 1, row: 1 },
        { key: "down", label: "&#9660;", col: 1, row: 2 },
        { type: "lever", key: "pos", name: "bar position", sub: "knob", col: 3, row: 1, rows: 2 },
      ],
    },
    help: "↑ ↓ (or W S) move your bar · Esc to exit",
    // phones/tablets: drag up and down anywhere to move the bar (knob value 1 = top)
    drag: { key: "pos", axis: "y", flip: true, gain: 1.6, hint: "Drag up and down anywhere to move your bar" },
  };

  window.GAMES = window.GAMES || {};
  window.GAMES.pong = { render, sounds, liveInfo, status, controls, onResize() { sizedFor = ""; } };
})();
