// Asteroids – browser part (vector drawing, HUD, sounds, controls).
// Rules and physics run on the server (games/asteroids.py).
(() => {
  let size = 600, scale = 0.6, sizedFor = "";
  const seen = new Set();          // explosions already heard
  let beatAt = 0, beatHigh = false;

  function resize(api) {
    const reserve = matchMedia("(pointer: coarse)").matches ? 255 : 170;
    const availW = Math.min(window.innerWidth - 32, 960);
    const availH = window.innerHeight - reserve;
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

  // the classic Asteroids ship: a narrow "A" with a cross bar
  function drawShip(ctx, s, color, isMe, t) {
    if (s.inv && Math.floor(t * 8) % 2) return;   // blink while invulnerable
    ctx.save();
    ctx.translate(s.x * scale, s.y * scale);
    ctx.rotate(s.a);
    const k = scale * 1.1;
    ctx.scale(k, k);
    ctx.strokeStyle = color;
    ctx.lineWidth = 2 / k;
    ctx.lineJoin = "round";
    ctx.shadowColor = color;
    ctx.shadowBlur = isMe ? 10 : 6;
    ctx.beginPath();
    ctx.moveTo(16, 0); ctx.lineTo(-12, -10); ctx.moveTo(16, 0); ctx.lineTo(-12, 10);
    ctx.moveTo(-7, -7.5); ctx.lineTo(-7, 7.5);
    ctx.stroke();
    if (s.thrust && Math.random() < .8) {
      ctx.strokeStyle = "#fde68a";
      ctx.shadowColor = "#fbbf24";
      ctx.beginPath();
      ctx.moveTo(-7, -4); ctx.lineTo(-15 - Math.random() * 8, 0); ctx.lineTo(-7, 4);
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawRock(ctx, rock) {
    const [x, y, r, seedR, rot] = rock;
    let s = seedR;
    const rand = () => (s = (s * 16807) % 2147483647) / 2147483647;
    const n = r > 30 ? 11 : 9;
    ctx.save();
    ctx.translate(x * scale, y * scale);
    ctx.rotate(rot);
    ctx.strokeStyle = "#e5e7eb";
    ctx.shadowColor = "#9ca3af";
    ctx.shadowBlur = 5;
    ctx.lineWidth = Math.max(1.3, 1.8 * scale);
    ctx.beginPath();
    for (let i = 0; i < n; i++) {
      const ang = i * Math.PI * 2 / n, rr = r * (0.7 + rand() * 0.4) * scale;
      const px = Math.cos(ang) * rr, py = Math.sin(ang) * rr;
      i ? ctx.lineTo(px, py) : ctx.moveTo(px, py);
    }
    ctx.closePath();
    ctx.stroke();
    ctx.restore();
  }

  function drawUfo(ctx, u) {
    const w = u.r * 1.6 * scale, h = u.r * 0.55 * scale;
    ctx.save();
    ctx.translate(u.x * scale, u.y * scale);
    ctx.strokeStyle = "#f87171";
    ctx.shadowColor = "#ef4444";
    ctx.shadowBlur = 8;
    ctx.lineWidth = Math.max(1.3, 1.8 * scale);
    ctx.beginPath();
    ctx.moveTo(-w, 0); ctx.lineTo(w, 0);
    ctx.lineTo(w * .55, h); ctx.lineTo(-w * .55, h); ctx.closePath();
    ctx.moveTo(-w, 0); ctx.lineTo(-w * .55, -h); ctx.lineTo(w * .55, -h); ctx.lineTo(w, 0);
    ctx.moveTo(-w * .3, -h); ctx.lineTo(-w * .2, -h * 2); ctx.lineTo(w * .2, -h * 2); ctx.lineTo(w * .3, -h);
    ctx.stroke();
    ctx.restore();
  }

  function drawBoom(ctx, b) {
    const [x, y, age, kind] = b;
    const k = Math.min(1, age / 1.0);
    const spread = kind === "rock1" ? .45 : kind === "rock2" ? .7 : 1;
    const n = kind.startsWith("rock") ? 8 : 14;
    ctx.save();
    ctx.globalAlpha = 1 - k;
    ctx.fillStyle = ctx.strokeStyle = kind === "ufo" ? "#fca5a5" : "#ffffff";
    ctx.shadowColor = "#fbbf24";
    ctx.shadowBlur = 8;
    ctx.lineWidth = Math.max(1.2, 2 * scale);
    let s = Math.floor(x * 7 + y * 13) || 1;
    const r = () => (s = (s * 16807) % 2147483647) / 2147483647;
    ctx.beginPath();
    for (let i = 0; i < n; i++) {
      const ang = r() * Math.PI * 2, d = (30 + r() * 60) * spread * k;
      if (kind.startsWith("rock")) {
        ctx.moveTo((x + Math.cos(ang) * d) * scale + 1.5, (y + Math.sin(ang) * d) * scale);
        ctx.arc((x + Math.cos(ang) * d) * scale, (y + Math.sin(ang) * d) * scale, 1.5, 0, Math.PI * 2);
      } else {
        const d2 = d + 6 + r() * 10;
        ctx.moveTo((x + Math.cos(ang) * d) * scale, (y + Math.sin(ang) * d) * scale);
        ctx.lineTo((x + Math.cos(ang) * d2) * scale, (y + Math.sin(ang) * d2) * scale);
      }
    }
    kind.startsWith("rock") ? ctx.fill() : ctx.stroke();
    ctx.restore();
  }

  const fmt = n => n.toLocaleString("it-IT");

  function render(api) {
    resize(api);
    const st = api.st(), me = api.me(), g = st.game, ctx = api.ctx;
    const players = Object.fromEntries(st.players.map(p => [p.id, p]));
    const t = performance.now() / 1000;

    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, size, size);

    for (const rock of g.rocks) drawRock(ctx, rock);
    if (g.ufo) drawUfo(ctx, g.ufo);

    for (const [x, y, owner] of g.bullets) {
      const p = players[owner];
      ctx.fillStyle = owner === 0 ? "#f87171" : (p ? p.color : "#fff");
      ctx.shadowColor = ctx.fillStyle;
      ctx.shadowBlur = 6;
      ctx.beginPath();
      ctx.arc(x * scale, y * scale, Math.max(1.8, 2.6 * scale), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.shadowBlur = 0;
    for (const b of g.booms) drawBoom(ctx, b);

    const order = [...g.ships].sort((a, b) => (a.id === me) - (b.id === me));
    for (const s of order) {
      const p = players[s.id];
      if (!p || !s.alive || s.hyper) continue;
      drawShip(ctx, s, g.ships.length > 1 ? p.color : "#ffffff", s.id === me, t);
      if (g.ships.length > 1) {
        ctx.font = `600 ${Math.max(10, Math.round(13 * scale + 3))}px system-ui, sans-serif`;
        ctx.textAlign = "center";
        ctx.textBaseline = "bottom";
        ctx.fillStyle = s.id === me ? "#fff" : p.color;
        ctx.fillText(s.id === me ? "you" : p.name, s.x * scale, (s.y - 22) * scale);
      }
    }

    // HUD: score and lives per player, wave
    const sorted = [...g.ships].sort((a, b) => b.score - a.score);
    api.$("chips").innerHTML = sorted.map(s => {
      const p = players[s.id];
      if (!p) return "";
      const gone = !s.alive && (s.lives <= 0 || s.out);
      const lives = s.lives > 0 ? `<span style="opacity:.75">${"▲".repeat(Math.min(s.lives, 6))}${s.lives > 6 ? "+" : ""}</span>` : "";
      return `<span class="chip${gone ? " dead" : ""}${s.id === me ? " me" : ""}">
        <span class="dot" style="background:${p.color}"></span>${api.esc(p.name)} <b>${fmt(s.score)}</b> ${lives}</span>`;
    }).join("");
    api.$("timer").textContent = g.wave ? `Wave ${g.wave}` : "";

    // centre message
    let big = "", small = "", huge = false, dim = false;
    const mine = g.ships.find(s => s.id === me);
    if (st.state === "lobby" && st.results) {
      big = st.results.title; dim = true;
    } else if (g.phase === "countdown") {
      big = g.countdown; huge = true;
      small = g.ships.length > 1 ? "Clear the rocks together" : "Clear the rocks";
    } else if (mine && !mine.alive && mine.lives <= 0) {
      big = "Out of ships"; small = "Watching the others… (Exit to leave the match)"; dim = true;
    } else if (mine && !mine.alive) {
      big = "Ship lost";
      small = mine.respawn ? `${mine.lives} left · back in ${mine.respawn.toFixed(1)} s` : `${mine.lives} left · waiting for a clear spot`;
    } else if (g.wave_in != null) {
      big = `Wave ${g.wave + 1}`; small = "Get ready";
    } else if (mine && mine.hyper) {
      small = "In hyperspace…";
    }
    api.setMessage(big, small, huge, dim);
  }

  function sounds(api, prev, next) {
    const me = api.me(), pg = prev.game, ng = next.game;
    if (!pg || !ng || !ng.ships) return false;
    const mineB = g => (g.bullets || []).filter(b => b[2] === me).length;
    if (ng.phase === "playing" && mineB(ng) > mineB(pg)) api.tone(1500, 0, .09, "square", .03, 400);   // pew
    let crashed = false;
    const mine = ng.ships.find(s => s.id === me);
    for (const b of ng.booms || []) {
      const key = `${b[0]},${b[1]},${b[3]}`;
      if (seen.has(key) || b[2] > .35) continue;
      seen.add(key);
      if (b[3] === "rock3") api.tone(110, 0, .35, "sawtooth", .07, 40);
      else if (b[3] === "rock2") api.tone(170, 0, .25, "sawtooth", .06, 60);
      else if (b[3] === "rock1") api.tone(260, 0, .15, "sawtooth", .05, 90);
      else { api.tone(160, 0, .6, "sawtooth", .09, 30); api.tone(90, .02, .6, "square", .05, 25); }
      if (mine && !mine.alive && Math.abs(mine.x - b[0]) < 1 && Math.abs(mine.y - b[1]) < 1) crashed = true;
    }
    if (seen.size > 300) seen.clear();
    const was = (pg.ships || []).find(s => s.id === me);
    if (was && mine && mine.lives > was.lives && mine.alive) {                  // extra ship
      [880, 1175, 1568].forEach((f, i) => api.tone(f, i * .09, .12, "triangle", .08));
    }
    if (mine && !mine.out) {
      if (ng.phase === "countdown" && ng.countdown !== pg.countdown) api.play("tick");
      if (pg.phase === "countdown" && ng.phase === "playing") api.play("go");
    }
    // the classic two-note heartbeat, faster as the field empties
    if (ng.phase === "playing" && ng.rocks.length) {
      const now = performance.now();
      const gap = Math.max(260, Math.min(1000, 220 + ng.rocks.length * 45));
      if (now - beatAt > gap) {
        beatAt = now;
        beatHigh = !beatHigh;
        api.tone(beatHigh ? 62 : 55, 0, .1, "square", .05);
      }
    }
    return crashed;
  }

  function liveInfo(st) {
    return st.game.wave ? `wave ${st.game.wave}` : "starting";
  }

  function status(st, pid) {
    const s = st.game.ships.find(x => x.id === pid);
    if (!s) return "";
    if (s.alive) return `${fmt(s.score)} pts · ${s.lives} ships`;
    return s.lives > 0 ? "respawning" : "out of ships";
  }

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
  window.GAMES.asteroids = { render, sounds, liveInfo, status, controls, onResize() { sizedFor = ""; } };
})();
