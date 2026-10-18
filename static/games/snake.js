// Snake – browser part (drawing, HUD, sounds). Rules run on the server (games/snake.py).
// Registers itself in window.GAMES; the page shell calls these functions:
//   render(api)          draw the board, HUD chips/timer and centre message
//   sounds(api, prev, next)   play game sounds by comparing two states
//   liveInfo(st)         short text for the lobby while a match is running
//   status(st, pid)      a player's status in the lobby list during a match
(() => {
  const D = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };
  let cell = 20, sizedFor = "";

  function lighten(hex, amt) {
    const n = parseInt(hex.slice(1), 16);
    const mix = v => Math.round(v + (255 - v) * amt);
    return `rgb(${mix(n >> 16)},${mix((n >> 8) & 255)},${mix(n & 255)})`;
  }

  function resize(api, g) {
    const { canvas, ctx } = api;
    const padH = matchMedia("(pointer: coarse)").matches ? 135 : 0;
    const availW = Math.min(window.innerWidth - 32, 960);
    const availH = window.innerHeight - 115 - padH;
    const c = Math.max(8, Math.floor(Math.min(availW / g.w, availH / g.h)));
    const key = `${c}:${g.w}:${g.h}:${window.innerWidth}`;
    if (key === sizedFor) return;
    sizedFor = key;
    cell = c;
    const dpr = window.devicePixelRatio || 1;
    canvas.style.width = cell * g.w + "px";
    canvas.style.height = cell * g.h + "px";
    canvas.width = cell * g.w * dpr;
    canvas.height = cell * g.h * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function roundRect(ctx, x, y, s, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + s, y, x + s, y + s, r);
    ctx.arcTo(x + s, y + s, x, y + s, r);
    ctx.arcTo(x, y + s, x, y, r);
    ctx.arcTo(x, y, x + s, y, r);
    ctx.fill();
  }

  function render(api) {
    const st = api.st(), me = api.me(), g = st.game, ctx = api.ctx;
    resize(api, g);
    const color = api.color;
    const players = Object.fromEntries(st.players.map(p => [p.id, p]));

    ctx.fillStyle = color("--board");
    ctx.fillRect(0, 0, g.w * cell, g.h * cell);
    ctx.fillStyle = color("--grid");
    for (let y = 0; y < g.h; y++)
      for (let x = y % 2; x < g.w; x += 2)
        ctx.fillRect(x * cell, y * cell, cell, cell);

    ctx.fillStyle = color("--food");
    for (const [fx, fy] of g.food) {
      ctx.beginPath();
      ctx.arc((fx + .5) * cell, (fy + .5) * cell, cell * .34, 0, Math.PI * 2);
      ctx.fill();
    }

    const gap = Math.max(1, cell * .08);
    const order = [...g.snakes].sort((a, b) => (a.id === me) - (b.id === me));   // mine on top
    for (const s of order) {
      const p = players[s.id];
      if (!s.body.length || !p) continue;
      s.body.forEach(([x, y], i) => {
        ctx.fillStyle = i === 0 ? lighten(p.color, .45) : p.color;
        roundRect(ctx, x * cell + gap, y * cell + gap, cell - gap * 2, cell * .28);
      });
      const [hx, hy] = s.body[0];
      const d = D[s.dir];
      const cx = (hx + .5) * cell, cy = (hy + .5) * cell, off = cell * .2, fwd = cell * .12;
      ctx.fillStyle = color("--bg");
      for (const k of [-1, 1]) {
        ctx.beginPath();
        ctx.arc(cx + d[0] * fwd + (d[1] ? k * off : 0), cy + d[1] * fwd + (d[0] ? k * off : 0), cell * .08, 0, Math.PI * 2);
        ctx.fill();
      }
      if (cell >= 12 && g.snakes.length > 1) {
        ctx.font = `600 ${Math.max(10, Math.round(cell * .55))}px system-ui, sans-serif`;
        ctx.textAlign = "center";
        ctx.textBaseline = "bottom";
        ctx.fillStyle = s.id === me ? "#ffffff" : lighten(p.color, .3);
        const ty = hy > 0 ? hy * cell - 2 : (hy + 1) * cell + cell * .75;
        ctx.fillText(s.id === me ? "you" : p.name, cx, ty);
      }
    }

    // HUD: score chips and timer
    const sorted = [...g.snakes].sort((a, b) => b.score - a.score);
    api.$("chips").innerHTML = sorted.map(s => {
      const p = players[s.id];
      if (!p) return "";
      const dead = g.phase === "playing" && !s.alive;
      return `<span class="chip${dead ? " dead" : ""}${s.id === me ? " me" : ""}">
        <span class="dot" style="background:${p.color}"></span>${api.esc(p.name)} <b>${s.score}</b></span>`;
    }).join("");
    const mode = st.settings.mode;
    if (mode === "endless" && g.time_left != null) {
      api.$("timer").textContent = api.fmtTime(g.time_left);
    } else if (mode === "rounds" && g.phase === "playing") {
      const inRound = g.snakes.filter(s => s.in_round);
      api.$("timer").textContent = inRound.length > 1 ? `${inRound.filter(s => s.alive).length}/${inRound.length} alive` : "";
    } else {
      api.$("timer").textContent = "";
    }

    // centre message
    let big = "", small = "", huge = false, dim = false;
    const mine = g.snakes.find(s => s.id === me);
    if (st.state === "lobby" && st.results) {
      big = st.results.title; dim = true;
    } else if (g.phase === "countdown") {
      big = g.countdown; huge = true;
      small = mode === "rounds" ? "Last snake standing" : `Free-for-all · ${st.settings.duration / 60} min`;
    } else if (g.phase === "playing" && mine && !mine.alive) {
      if (mode === "endless") {
        big = "Crashed!";
        small = mine.respawn != null ? `Back in ${Math.max(0, mine.respawn).toFixed(1)} s` : "Back in a moment";
      } else {
        big = "You're out"; small = "Watching the others… (Exit to leave the match)"; dim = true;
      }
    }
    api.setMessage(big, small, huge, dim);
  }

  function sounds(api, prev, next) {
    const me = api.me();
    const pg = prev.game, ng = next.game;
    if (!pg || !ng) return false;
    const was = (pg.snakes || []).find(s => s.id === me);
    const now = (ng.snakes || []).find(s => s.id === me);
    let crashed = false;
    if (was && now && pg.phase === "playing") {
      if (now.score > was.score) api.play("eat");
      if (was.alive && !now.alive && !now.out) { api.play("crash"); crashed = true; }
    }
    if (now && !now.out) {
      if (ng.phase === "countdown" && ng.countdown !== pg.countdown) api.play("tick");
      if (pg.phase === "countdown" && ng.phase === "playing") api.play("go");
    }
    return crashed;
  }

  function liveInfo(st) {
    const g = st.game;
    if (g.phase === "countdown") return "starting";
    if (st.settings.mode === "endless") return `${Math.floor((g.time_left || 0) / 60)}:${String((g.time_left || 0) % 60).padStart(2, "0")} left`;
    return `${g.snakes.filter(s => s.in_round && s.alive).length} still alive`;
  }

  function status(st, pid) {
    const s = st.game.snakes.find(x => x.id === pid);
    if (!s) return "";
    if (s.alive) return "playing";
    return st.settings.mode === "endless" && s.respawn != null ? "respawning" : "out";
  }

  window.GAMES = window.GAMES || {};
  window.GAMES.snake = { render, sounds, liveInfo, status, onResize() { sizedFor = ""; } };
})();
