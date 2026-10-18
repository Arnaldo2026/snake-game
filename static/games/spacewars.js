// Space Wars – browser part (vector drawing, HUD, sounds, controls).
// Rules and physics run on the server (games/spacewars.py).
(() => {
  let size = 600, scale = 0.6, sizedFor = "";
  const seen = new Set();          // explosions already heard

  // a fixed sprinkle of background stars
  const field = [];
  let seed = 7;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (let i = 0; i < 90; i++) field.push([rnd() * 1000, rnd() * 1000, rnd() < .15 ? 1.6 : 0.9]);

  function resize(api) {
    const padH = matchMedia("(pointer: coarse)").matches ? 135 : 0;
    const availW = Math.min(window.innerWidth - 32, 960);
    const availH = window.innerHeight - 125 - padH;
    const s = Math.max(240, Math.floor(Math.min(availW, availH)));
    const key = `${s}:${window.devicePixelRatio || 1}`;
    if (key === sizedFor) return;
    sizedFor = key;
    size = s;
    scale = size / 1000;
    const dpr = window.devicePixelRatio || 1;
    api.canvas.style.width = api.canvas.style.height = size + "px";
    api.canvas.width = api.canvas.height = size * dpr;
    api.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  // classic wedge: nose, rear wing, notch, other rear wing
  const SHIP = [[17, 0], [-11, -10], [-6, 0], [-11, 10]];

  function drawShip(ctx, s, color, isMe) {
    ctx.save();
    ctx.translate(s.x * scale, s.y * scale);
    ctx.rotate(s.a);
    ctx.scale(scale * 1.15, scale * 1.15);
    ctx.strokeStyle = color;
    ctx.lineWidth = 2 / (scale * 1.15);          // about 2 screen pixels
    ctx.lineJoin = "round";
    ctx.shadowColor = color;
    ctx.shadowBlur = isMe ? 10 : 6;
    ctx.beginPath();
    SHIP.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    ctx.closePath();
    ctx.stroke();
    if (s.thrust) {
      const len = 12 + Math.random() * 10;
      ctx.strokeStyle = "#fde68a";
      ctx.shadowColor = "#fbbf24";
      ctx.beginPath();
      ctx.moveTo(-7, -4); ctx.lineTo(-7 - len, 0); ctx.lineTo(-7, 4);
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawStar(ctx, g, t) {
    const cx = 500 * scale, cy = 500 * scale;
    const neg = g.gravity === "negative";
    const col = neg ? "#93c5fd" : "#ffffff";
    ctx.save();
    ctx.strokeStyle = col;
    ctx.shadowColor = neg ? "#3b82f6" : "#fef3c7";
    ctx.shadowBlur = 18;
    ctx.lineWidth = Math.max(1.4, 2 * scale);
    const rays = 10;
    ctx.beginPath();
    for (let i = 0; i < rays; i++) {
      const ang = i * Math.PI * 2 / rays + t * .4;
      const len = (14 + Math.random() * 14) * scale;
      ctx.moveTo(cx + Math.cos(ang) * 4 * scale, cy + Math.sin(ang) * 4 * scale);
      ctx.lineTo(cx + Math.cos(ang) * len, cy + Math.sin(ang) * len);
    }
    ctx.stroke();
    ctx.fillStyle = col;
    ctx.beginPath();
    ctx.arc(cx, cy, 5 * scale + 1.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  function drawBoom(ctx, b) {
    const [x, y, age] = b;
    const k = Math.min(1, age / 1.2);
    ctx.save();
    ctx.globalAlpha = 1 - k;
    ctx.strokeStyle = "#ffffff";
    ctx.shadowColor = "#fbbf24";
    ctx.shadowBlur = 12;
    ctx.lineWidth = Math.max(1.2, 2 * scale);
    let s = Math.floor(x * 7 + y * 13) || 1;
    const r = () => (s = (s * 16807) % 2147483647) / 2147483647;
    ctx.beginPath();
    for (let i = 0; i < 12; i++) {
      const ang = r() * Math.PI * 2, sp = 40 + r() * 70;
      const d1 = sp * k, d2 = d1 + 6 + r() * 10;
      ctx.moveTo((x + Math.cos(ang) * d1) * scale, (y + Math.sin(ang) * d1) * scale);
      ctx.lineTo((x + Math.cos(ang) * d2) * scale, (y + Math.sin(ang) * d2) * scale);
    }
    ctx.stroke();
    ctx.restore();
  }

  function render(api) {
    resize(api);
    const st = api.st(), me = api.me(), g = st.game, ctx = api.ctx;
    const players = Object.fromEntries(st.players.map(p => [p.id, p]));
    const t = performance.now() / 1000;

    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, size, size);
    ctx.fillStyle = "rgba(255,255,255,.35)";
    for (const [x, y, r] of field) ctx.fillRect(x * scale, y * scale, r, r);

    if (g.star) drawStar(ctx, g, t);

    // torpedoes
    for (const [x, y, owner] of g.torps) {
      const p = players[owner];
      ctx.fillStyle = p ? p.color : "#fff";
      ctx.shadowColor = ctx.fillStyle;
      ctx.shadowBlur = 8;
      ctx.beginPath();
      ctx.arc(x * scale, y * scale, Math.max(2, 3 * scale), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.shadowBlur = 0;

    for (const b of g.booms) drawBoom(ctx, b);

    // ships, mine last so it's on top
    const order = [...g.ships].sort((a, b) => (a.id === me) - (b.id === me));
    for (const s of order) {
      const p = players[s.id];
      if (!p || !s.alive || s.hyper) continue;
      drawShip(ctx, s, p.color, s.id === me);
      if (g.ships.length > 1) {
        ctx.font = `600 ${Math.max(10, Math.round(13 * scale + 3))}px system-ui, sans-serif`;
        ctx.textAlign = "center";
        ctx.textBaseline = "bottom";
        ctx.fillStyle = s.id === me ? "#fff" : p.color;
        ctx.fillText(s.id === me ? "you" : p.name, s.x * scale, (s.y - 24) * scale);
      }
    }

    // HUD
    const sorted = [...g.ships].sort((a, b) => b.points - a.points);
    api.$("chips").innerHTML = sorted.map(s => {
      const p = players[s.id];
      if (!p) return "";
      const dead = (g.phase === "playing" || g.phase === "roundover") && !s.alive;
      return `<span class="chip${dead ? " dead" : ""}${s.id === me ? " me" : ""}">
        <span class="dot" style="background:${p.color}"></span>${api.esc(p.name)} <b>${s.points}</b></span>`;
    }).join("");
    api.$("timer").textContent = g.round ? `Round ${g.round} · first to ${g.target}` : "";

    // centre message
    let big = "", small = "", huge = false, dim = false;
    const mine = g.ships.find(s => s.id === me);
    if (st.state === "lobby" && st.results) {
      big = st.results.title; dim = true;
    } else if (g.phase === "countdown") {
      big = g.countdown; huge = true;
      small = `Round ${g.round}`;
    } else if (g.phase === "roundover") {
      big = g.round_msg;
      small = g.round_winner === me ? "Nice flying!" : "";
    } else if (g.phase === "playing" && mine && !mine.alive) {
      big = "Destroyed"; small = "Waiting for the round to end…";
    } else if (g.phase === "playing" && mine && mine.hyper) {
      small = "In hyperspace…";
    }
    api.setMessage(big, small, huge, dim);
  }

  function sounds(api, prev, next) {
    const me = api.me(), pg = prev.game, ng = next.game;
    if (!pg || !ng) return false;
    const mineTorps = g => (g.torps || []).filter(t => t[2] === me).length;
    if (ng.phase === "playing" && mineTorps(ng) > mineTorps(pg)) {
      api.tone(1400, 0, .12, "square", .035, 260);                      // pew
    }
    let crashed = false;
    for (const b of ng.booms || []) {
      const key = `${b[0]},${b[1]}`;
      if (seen.has(key) || b[2] > .4) continue;
      seen.add(key);
      api.tone(160, 0, .55, "sawtooth", .09, 30);                       // boom
      api.tone(90, .02, .6, "square", .05, 25);
      const mine = (ng.ships || []).find(s => s.id === me);
      if (mine && !mine.alive && Math.abs(mine.x - b[0]) < 1 && Math.abs(mine.y - b[1]) < 1) crashed = true;
    }
    if (seen.size > 200) seen.clear();
    const mine = (ng.ships || []).find(s => s.id === me);
    if (mine && !mine.out) {
      if (ng.phase === "countdown" && ng.countdown !== pg.countdown) api.play("tick");
      if (pg.phase === "countdown" && ng.phase === "playing") api.play("go");
      if (pg.phase === "playing" && ng.phase === "roundover" && ng.round_winner === me && next.state === "match") {
        api.tone(784, 0, .12, "triangle", .1); api.tone(1047, .12, .2, "triangle", .1);
      }
    }
    return crashed;
  }

  function liveInfo(st) {
    const g = st.game;
    return g.round ? `round ${g.round}, first to ${g.target}` : "starting";
  }

  function status(st, pid) {
    const s = st.game.ships.find(x => x.id === pid);
    if (!s) return "";
    return s.alive ? "flying" : "destroyed";
  }

  // hold to act: rotate, thrust and fire while the key or button is held
  const controls = {
    hold: true,
    swipe: false,
    keys: {
      ArrowLeft: "left", ArrowRight: "right", ArrowUp: "thrust", ArrowDown: "hyper", " ": "fire",
      a: "left", d: "right", w: "thrust", s: "hyper", Control: "fire", k: "fire",
    },
    pad: {
      cols: "64px 64px 12px 72px 72px",
      buttons: [
        { key: "left", name: "rotate left", label: "&#10226;", col: 1, row: 1 },
        { key: "right", name: "rotate right", label: "&#10227;", col: 2, row: 1 },
        { key: "thrust", label: "&#9650;", sub: "thrust", col: 4, row: 1 },
        { key: "fire", label: "&#9679;", sub: "fire", col: 5, row: 1 },
        { key: "hyper", label: "&#10022;", sub: "hyperspace", col: 1, span: 2, row: 2 },
      ],
    },
    help: "← → rotate · ↑ thrust · Space fire · ↓ hyperspace · Esc to exit",
  };

  window.GAMES = window.GAMES || {};
  window.GAMES.spacewars = { render, sounds, liveInfo, status, controls, onResize() { sizedFor = ""; } };
})();
