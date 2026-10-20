// Space Wars – browser part (vector drawing, HUD, sounds, controls).
// Rules and physics run on the server (games/spacewars.py).
(() => {
  let size = 600, scale = 0.6, sizedFor = "";
  let WW = 1000, WH = 1000, pw = 600, ph = 600;   // world width/height (arena setting), canvas size in px
  const seen = new Set();          // explosions already heard

  // a fixed sprinkle of background stars
  const field = [];
  let seed = 7;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (let i = 0; i < 90; i++) field.push([rnd() * 1000, rnd() * 1000, rnd() < .15 ? 1.6 : 0.9]);

  function resize(api) {
    // room for header + scoreboard, and below the board either the touch buttons or the keys hint
    const reserve = document.body.classList.contains("touch-ui") ? 255 : 170;
    const { w: availW, h: availH } = api.space(1100, reserve);
    const sc = Math.max(240 / WH, Math.min(availW / WW, availH / WH));
    const key = `${sc.toFixed(4)}:${WW}:${window.devicePixelRatio || 1}`;
    if (key === sizedFor) return;
    sizedFor = key;
    scale = sc;
    pw = Math.floor(WW * sc); ph = Math.floor(WH * sc);
    size = Math.min(pw, ph);
    const dpr = window.devicePixelRatio || 1;
    api.canvas.style.width = pw + "px"; api.canvas.style.height = ph + "px";
    api.canvas.width = pw * dpr; api.canvas.height = ph * dpr;
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
    if (s.reverse) {
      // retro-rockets: two small flames forward, beside the nose
      const len = 6 + Math.random() * 6;
      ctx.strokeStyle = "#a5f3fc";
      ctx.shadowColor = "#22d3ee";
      ctx.beginPath();
      ctx.moveTo(4, -6); ctx.lineTo(8 + len, -8);
      ctx.moveTo(4, 6); ctx.lineTo(8 + len, 8);
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawStar(ctx, g, t) {
    const cx = WW / 2 * scale, cy = WH / 2 * scale;
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

  // irregular vector rock, same shape on every screen (seeded)
  function drawRock(ctx, rock) {
    const [x, y, r, seedR, rot] = rock;
    let s = seedR;
    const rand = () => (s = (s * 16807) % 2147483647) / 2147483647;
    const n = 9;
    ctx.save();
    ctx.translate(x * scale, y * scale);
    ctx.rotate(rot);
    ctx.strokeStyle = "#cbd5e1";
    ctx.shadowColor = "#94a3b8";
    ctx.shadowBlur = 6;
    ctx.lineWidth = Math.max(1.3, 1.8 * scale);
    ctx.beginPath();
    for (let i = 0; i < n; i++) {
      const ang = i * Math.PI * 2 / n, rr = r * (0.72 + rand() * 0.38) * scale;
      const px = Math.cos(ang) * rr, py = Math.sin(ang) * rr;
      i ? ctx.lineTo(px, py) : ctx.moveTo(px, py);
    }
    ctx.closePath();
    ctx.stroke();
    ctx.restore();
  }

  function drawBoom(ctx, b) {
    const [x, y, age, kind] = b;
    const k = Math.min(1, age / 1.2);
    const spread = kind === "rock" ? 0.7 : 1;
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
      const ang = r() * Math.PI * 2, sp = (40 + r() * 70) * spread;
      const d1 = sp * k, d2 = d1 + 6 + r() * 10;
      ctx.moveTo((x + Math.cos(ang) * d1) * scale, (y + Math.sin(ang) * d1) * scale);
      ctx.lineTo((x + Math.cos(ang) * d2) * scale, (y + Math.sin(ang) * d2) * scale);
    }
    ctx.stroke();
    ctx.restore();
  }

  // ---------------------------------------------------------------- physics data pad
  // Same model as the server (games/spacewars.py): a = GM/r² towards the star with r ≥ soften,
  // thrust along the nose, speed capped at vmax, semi-implicit Euler with step dt. Ship mass m = 1,
  // so forces and accelerations have the same numbers. Units: u (world unit, the field is 1000 u high), s.
  let padOn = null;
  const ARROW_S = 1.2;            // accelerations drawn as 1.2 u per u/s²
  const VEL_S = 0.5;              // velocity drawn as where you'd be in 0.5 s
  const COL = { v: "#22d3ee", g: "#fb923c", t: "#f87171", n: "#e2e8f0" };

  const num = (v, d = 1) => {
    if (!isFinite(v)) return "∞";
    const a = Math.abs(v);
    if (a !== 0 && (a >= 1e5 || a < 0.01)) return v.toExponential(2).replace("e+", "e");
    return v.toFixed(d).replace("-", "−");
  };

  function accel(P, x, y) {
    if (!P.gm) return [0, 0, 0];
    const dx = WW / 2 - x, dy = WH / 2 - y;
    const r2 = Math.max(dx * dx + dy * dy, P.soften * P.soften), r = Math.sqrt(r2), a = P.gm / r2;
    return [a * dx / r, a * dy / r, a];
  }

  // coast forward with the game's own integrator (no thrust): where gravity alone takes the ship
  function predict(g, s, P) {
    let x = s.x, y = s.y, vx = s.vx, vy = s.vy;
    const pts = [[x, y]], dt = P.dt;
    let hit = null;
    for (let i = 0; i < 300; i++) {                     // 10 seconds
      const [ax, ay] = accel(P, x, y);
      vx += ax * dt; vy += ay * dt;
      const sp = Math.hypot(vx, vy);
      if (sp > P.vmax) { vx *= P.vmax / sp; vy *= P.vmax / sp; }
      x += vx * dt; y += vy * dt;
      if (P.edges === "wrap") {
        if (x < 0 || x >= WW || y < 0 || y >= WH) {
          x = ((x % WW) + WW) % WW; y = ((y % WH) + WH) % WH;
          pts.push(null);                               // jump to the other side: break the line
        }
      } else {
        const R = P.ship_r;
        if (x < R) { x = R; vx = Math.abs(vx) * .8; } else if (x > WW - R) { x = WW - R; vx = -Math.abs(vx) * .8; }
        if (y < R) { y = R; vy = Math.abs(vy) * .8; } else if (y > WH - R) { y = WH - R; vy = -Math.abs(vy) * .8; }
      }
      pts.push([x, y]);
      if (g.star && Math.hypot(x - WW / 2, y - WH / 2) < P.star_r + P.ship_r * 0.6) { hit = [x, y]; break; }
    }
    return { pts, hit };
  }

  // engine acceleration along the nose (u/s²): forward thrust, minus the weaker retro-thrust
  function engine(s, P) {
    return (s.thrust ? P.thrust : 0) - (s.reverse ? (P.reverse || 0) : 0);
  }

  function arrow(ctx, x, y, dx, dy, color, label, dashed) {
    const len = Math.hypot(dx, dy);
    if (len < 2) return;
    const max = 320;
    if (len > max) { dx *= max / len; dy *= max / len; }
    const x1 = (x + dx) * scale, y1 = (y + dy) * scale, x0 = x * scale, y0 = y * scale;
    const ang = Math.atan2(y1 - y0, x1 - x0), h = Math.max(5, 9 * scale);
    ctx.save();
    ctx.strokeStyle = ctx.fillStyle = color;
    ctx.lineWidth = Math.max(1.5, 2.2 * scale);
    if (dashed) ctx.setLineDash([5, 4]);
    ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x1 - h * Math.cos(ang - .45), y1 - h * Math.sin(ang - .45));
    ctx.lineTo(x1 - h * Math.cos(ang + .45), y1 - h * Math.sin(ang + .45));
    ctx.closePath(); ctx.fill();
    ctx.font = `700 ${Math.max(10, Math.round(13 * scale + 2))}px ui-monospace, Consolas, monospace`;
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText(label, x1 + Math.cos(ang) * 11, y1 + Math.sin(ang) * 11);
    ctx.restore();
  }

  function drawPhysics(ctx, g, s, color) {
    const P = g.phys;
    // predicted coasting path, with a dot every second
    const { pts, hit } = predict(g, s, P);
    ctx.save();
    ctx.strokeStyle = color; ctx.globalAlpha = .55;
    ctx.lineWidth = Math.max(1, 1.4 * scale);
    ctx.setLineDash([3, 5]);
    ctx.beginPath();
    let pen = false;
    pts.forEach(p => {
      if (!p) { pen = false; return; }
      pen ? ctx.lineTo(p[0] * scale, p[1] * scale) : ctx.moveTo(p[0] * scale, p[1] * scale);
      pen = true;
    });
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = color; ctx.globalAlpha = .8;
    for (let i = 30; i < pts.length; i += 30) {
      // count real steps (nulls are wrap markers)
      const p = pts.filter(Boolean)[i];
      if (p) { ctx.beginPath(); ctx.arc(p[0] * scale, p[1] * scale, Math.max(1.5, 2.2 * scale), 0, Math.PI * 2); ctx.fill(); }
    }
    if (hit) {
      ctx.globalAlpha = 1; ctx.strokeStyle = "#ef4444"; ctx.lineWidth = 2;
      const [hx, hy] = [hit[0] * scale, hit[1] * scale], k = 7;
      ctx.beginPath(); ctx.moveTo(hx - k, hy - k); ctx.lineTo(hx + k, hy + k); ctx.moveTo(hx + k, hy - k); ctx.lineTo(hx - k, hy + k); ctx.stroke();
    }
    ctx.restore();
    // vectors
    const [gx, gy] = accel(P, s.x, s.y);
    const ta = engine(s, P), tx = Math.cos(s.a) * ta, ty = Math.sin(s.a) * ta;
    arrow(ctx, s.x, s.y, s.vx * VEL_S, s.vy * VEL_S, COL.v, "v");
    if (P.gm) arrow(ctx, s.x, s.y, gx * ARROW_S, gy * ARROW_S, COL.g, "g");
    if (ta) {
      arrow(ctx, s.x, s.y, tx * ARROW_S, ty * ARROW_S, COL.t, "T");
      if (P.gm) arrow(ctx, s.x, s.y, (gx + tx) * ARROW_S, (gy + ty) * ARROW_S, COL.n, "a", true);
    }
    return !!hit;
  }

  function padHtml(api, g, s, hit) {
    const P = g.phys, mu = P.gm;
    // maths axes: x to the right, y up, origin at the star
    const rx = s.x - WW / 2, ry = WH / 2 - s.y, vx = s.vx, vy = -s.vy;
    const r = Math.hypot(rx, ry), v = Math.hypot(vx, vy);
    const th = (Math.atan2(ry, rx) * 180 / Math.PI + 360) % 360;
    const vr = r ? (rx * vx + ry * vy) / r : 0, vt = r ? (rx * vy - ry * vx) / r : 0;
    const reff = Math.max(r, P.soften);
    const ga = mu ? Math.abs(mu) / (reff * reff) : 0;
    const [gx, gy] = accel(P, s.x, s.y);
    const ta = engine(s, P), tx = Math.cos(s.a) * ta, ty = Math.sin(s.a) * ta;
    const anet = Math.hypot(gx + tx, gy + ty);
    const c = (k, t) => `<span style="color:${COL[k]}">${t}</span>`;
    const row = (a, b) => `<div style="display:flex;justify-content:space-between;gap:10px"><span>${a}</span><span>${b}</span></div>`;
    const gname = { off: "off", weak: "weak", normal: "normal", strong: "strong", negative: "repulsive" }[g.gravity] || g.gravity;
    const lines = [
      `<div style="font-weight:700;letter-spacing:1px;margin-bottom:3px">PHYSICS · your ship</div>`,
      row("GM", `${num(mu, 0)} u³/s² <span style="opacity:.6">(${gname})</span>`),
      row("r", `${num(r)} u · θ ${num(th, 0)}°${r < P.soften ? " <span style='opacity:.6'>(r<" + P.soften + ": soft)</span>" : ""}`),
      row(c("v", "v"), `${num(v)} u/s${v >= P.vmax - 0.5 ? " <span style='opacity:.6'>(limit)</span>" : ""}`),
      row(`&nbsp;&nbsp;v<sub>r</sub> · v<sub>t</sub>`, `${num(vr)} · ${num(vt)}`),
    ];
    if (mu) lines.push(row(c("g", mu > 0 ? "g = GM/r²" : "g = |GM|/r²"), `${num(ga)} u/s² ${mu > 0 ? "→ star" : "← away"}`));
    lines.push(row(c("t", "thrust T"), `${num(ta, 0)} u/s² ${ta > 0 ? "forward" : ta < 0 ? "reverse" : "off"}`));
    if (mu) lines.push(row(c("n", "|a| = |g + T|"), `${num(anet)} u/s²`));
    lines.push(row("F = m·a", `m = 1 → F = ${num(anet)}`));
    if (mu > 0) {
      const eps = v * v / 2 - mu / r, h = rx * vy - ry * vx;
      const e = Math.sqrt(Math.max(0, 1 + 2 * eps * h * h / (mu * mu)));
      lines.push(`<div style="border-top:1px solid #334155;margin:4px 0 2px"></div>`);
      lines.push(row("v<sub>circ</sub> = √(GM/r)", num(Math.sqrt(mu / r))));
      lines.push(row("v<sub>esc</sub> = √(2GM/r)", num(Math.sqrt(2 * mu / r))));
      lines.push(row("ε = v²/2 − GM/r", `${num(eps, 0)} u²/s²`));
      lines.push(row("h = r × v", `${num(h, 0)} u²/s ${h > 0 ? "⟲" : h < 0 ? "⟳" : ""}`));
      lines.push(row("e", `${num(e, 3)} ${eps < 0 ? (e < 0.02 ? "≈ circle" : "ellipse") : e > 1.0001 ? "hyperbola" : "parabola"}`));
      if (eps < 0) {
        const a = -mu / (2 * eps), rp = a * (1 - e), ra = a * (1 + e), T = 2 * Math.PI * Math.sqrt(a * a * a / mu);
        lines.push(row("a = −GM/2ε", `${num(a, 0)} u`));
        lines.push(row("peri · apo", `${num(rp, 0)} · ${num(ra, 0)} u`));
        lines.push(row("T = 2π√(a³/GM)", `${num(T)} s`));
        if (ra > WH / 2) lines.push(`<div style="opacity:.7">apoapsis beyond the screen edge${P.edges === "wrap" ? " (wraps)" : " (bounces)"}</div>`);
      } else {
        lines.push(`<div style="opacity:.7">unbound: escapes the star${P.edges === "wrap" ? " – but the edges wrap" : ""}</div>`);
      }
    } else if (mu < 0) {
      lines.push(`<div style="opacity:.7;margin-top:3px">repulsive star: no bound orbits</div>`);
    } else {
      lines.push(`<div style="opacity:.7;margin-top:3px">no gravity: straight lines (1st law)</div>`);
    }
    if (hit) lines.push(`<div style="color:#f87171;font-weight:700">✕ collision course with the star</div>`);
    lines.push(`<div style="opacity:.55;margin-top:4px;font-size:.9em">model: Δt ${num(P.dt, 4)} s · |v| ≤ ${P.vmax} · r ≥ ${P.soften} · ${P.edges}<br>
      arrows: v × 0.5 s · g, T, a × 1.2 s² · dotted: coasting path, a dot per second</div>`);
    const font = size < 520 ? 9.5 : 11.5;
    return `<div style="background:rgba(2,6,23,.78);border:1px solid #334155;border-radius:8px;padding:7px 9px;
      font:${font}px/1.35 ui-monospace,Consolas,monospace;color:#e2e8f0;width:${size < 520 ? 190 : 250}px">${lines.join("")}</div>`;
  }

  function render(api) {
    const g0 = api.st().game || {};
    if (g0.w && (g0.w !== WW || g0.h !== WH)) { WW = g0.w; WH = g0.h || 1000; sizedFor = ""; }
    resize(api);
    if (padOn === null) padOn = api.store.get("sw.pad") === "on";
    const st = api.st(), me = api.me(), g = st.game, ctx = api.ctx;
    const players = Object.fromEntries(st.players.map(p => [p.id, p]));
    const t = performance.now() / 1000;

    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, pw, ph);
    ctx.fillStyle = "rgba(255,255,255,.35)";
    for (const [x, y, r] of field) ctx.fillRect(x * WW / 1000 * scale, y * scale, r, r);

    if (g.star) drawStar(ctx, g, t);
    for (const rock of g.rocks || []) drawRock(ctx, rock);

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

    // physics data pad: vectors and path on my ship, numbers in the corner
    const myShip = g.ships.find(s => s.id === me);
    let padHTML = "";
    if (padOn && g.phys) {
      if (myShip && myShip.alive && !myShip.hyper && myShip.vx != null) {
        const hit = drawPhysics(ctx, g, myShip, (players[me] || {}).color || "#fff");
        padHTML = padHtml(api, g, myShip, hit);
      } else {
        padHTML = `<div style="background:rgba(2,6,23,.78);border:1px solid #334155;border-radius:8px;padding:7px 9px;
          font:11px ui-monospace,Consolas,monospace;color:#94a3b8">PHYSICS · waiting for your ship…</div>`;
      }
    }
    const ov = api.$("overlay");
    if (ov.innerHTML !== padHTML) ov.innerHTML = padHTML;

    // HUD
    const sorted = [...g.ships].sort((a, b) => b.points - a.points);
    api.$("chips").innerHTML = sorted.map(s => {
      const p = players[s.id];
      if (!p) return "";
      const dead = (g.phase === "playing" || g.phase === "roundover") && !s.alive;
      return `<span class="chip${dead ? " dead" : ""}${s.id === me ? " me" : ""}">
        <span class="dot" style="background:${p.color}"></span>${api.esc(p.name)} <b>${s.points}</b></span>`;
    }).join("");
    const mine = g.ships.find(s => s.id === me);
    if (g.solo) {
      const s = mine || g.ships[0];
      api.$("chips").innerHTML = "";
      api.$("timer").textContent = s
        ? `Training${g.rocks_on ? ` · asteroids ${s.points}` : ""} · crashes ${s.deaths}` : "Training";
    } else {
      api.$("timer").textContent = g.round ? `Round ${g.round} · first to ${g.target}` : "";
    }

    // centre message
    let big = "", small = "", huge = false, dim = false;
    if (st.state === "lobby" && st.results) {
      big = st.results.title; dim = true;
    } else if (g.phase === "countdown") {
      big = g.countdown; huge = true;
      small = g.solo ? "Training – fly, shoot, beat the gravity. Exit when you're done." : `Round ${g.round}`;
    } else if (g.solo && mine && !mine.alive) {
      big = "Crashed!";
      small = mine.respawn != null ? `Back in ${mine.respawn.toFixed(1)} s` : "";
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
      if (b[3] === "rock") {
        api.tone(240, 0, .3, "sawtooth", .05, 60);                      // rock breaks
      } else {
        api.tone(160, 0, .55, "sawtooth", .09, 30);                     // ship explodes
        api.tone(90, .02, .6, "square", .05, 25);
      }
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
    if (g.solo) return "training";
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
      Shift: "reverse", r: "reverse",
    },
    pad: {
      cols: "64px 64px 12px 72px 72px",
      buttons: [
        { key: "left", name: "rotate left", label: "&#10226;", col: 1, row: 1 },
        { key: "right", name: "rotate right", label: "&#10227;", col: 2, row: 1 },
        { key: "thrust", label: "&#9650;", sub: "thrust", col: 4, row: 1 },
        { key: "fire", label: "&#9679;", sub: "fire", col: 5, row: 1 },
        { key: "hyper", label: "&#10022;", sub: "hyperspace", col: 1, span: 2, row: 2 },
        { key: "reverse", label: "&#9660;", sub: "reverse", col: 4, span: 2, row: 2 },
      ],
    },
    // phones/tablets can switch (in the room) to a two-thumb layout: left thumb turns, right thumb pushes
    layouts: [{
      id: "thumbs", label: "Thumbs",
      hint: "Left thumb: turn clockwise (top) or counter-clockwise, big HYPERSPACE below. "
          + "Right thumb: thrust (top) or reverse, big FIRE below.",
      pad: {
        cols: "104px 16px 104px",
        buttons: [
          { key: "right", name: "turn clockwise", label: "&#10227;", sub: "turn", col: 1, row: 1 },
          { key: "left", name: "turn counter-clockwise", label: "&#10226;", sub: "turn", col: 1, row: 2 },
          { key: "hyper", label: "&#10022;", sub: "HYPERSPACE", col: 1, row: 3, rows: 2 },
          { key: "thrust", label: "&#9650;", sub: "thrust", col: 3, row: 1 },
          { key: "reverse", label: "&#9660;", sub: "reverse", col: 3, row: 2 },
          { key: "fire", label: "&#9679;", sub: "FIRE", col: 3, row: 3, rows: 2 },
        ],
      },
    }, {
      id: "slide", label: "Slide",
      hint: "Put a thumb down anywhere on the screen and slide it. Left half: up turns clockwise, down "
          + "counter-clockwise. Right half: up thrust, down reverse; a quick tap fires. "
          + "Back to where you started = let go. Small buttons for HYPERSPACE and FIRE stay at the bottom.",
      // left half / right half of the screen: slide up or down from where the thumb lands
      sticks: {
        left: { up: "right", down: "left", upLabel: "⟳", downLabel: "⟲" },
        right: { up: "thrust", down: "reverse", tap: "fire", upLabel: "▲", downLabel: "▼" },
      },
      pad: {
        cols: "88px 16px 88px",
        buttons: [
          { key: "hyper", label: "&#10022;", sub: "hyperspace", col: 1, row: 1 },
          { key: "fire", label: "&#9679;", sub: "fire", col: 3, row: 1 },
        ],
      },
    }],
    help: "← → rotate · ↑ thrust · Shift reverse · Space fire · ↓ hyperspace · I physics data · Esc to exit",
  };
  // a button in the top bar (and the I key) opens the physics data pad
  const tools = [{ id: "pad", label: "📐", title: "Physics data pad (I)", key: "i" }];
  function onTool(api, id) {
    if (id !== "pad") return;
    padOn = !padOn;
    api.store.set("sw.pad", padOn ? "on" : "off");
  }
  const toolOn = id => id === "pad" && !!padOn;

  window.GAMES = window.GAMES || {};
  window.GAMES.spacewars = { render, sounds, liveInfo, status, controls, tools, onTool, toolOn,
    onResize() { sizedFor = ""; } };
})();
