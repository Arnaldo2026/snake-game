// Battlezone – browser part: first-person wireframe 3D view, radar, warnings, arena map, sounds.
// The server simulates the battlefield from above (games/battlezone.py); this file only draws it
// from inside your own tank.
(() => {
  const GREEN = "#5dff7a", GREEN_DIM = "#2f9e48", RED = "#ff4d4d";
  const FOV = Math.PI / 3;              // 60° horizontal
  const EYE = 26;                        // eye height
  const NEAR = 8, FAR = 4200;
  let cw = 800, ch = 500, F = 700, HZ = 280, sizedFor = "";
  let engine = null, apiRef = null;
  let lastFrame = performance.now();
  const heard = new Set();
  let crack = null, crackFor = -1;

  // mountain range all round the horizon (height in screen units at the horizon), volcano at ~110°
  const profile = [];
  let seed = 23;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  { let h = 20; for (let d = 0; d < 360; d++) { h = Math.max(6, Math.min(48, h + (rnd() - 0.5) * 9)); profile.push(h); } }
  for (let d = 96; d <= 124; d++) {                     // the volcano: a cone with a flat crater
    const k = 1 - Math.abs(d - 110) / 14;
    profile[d] = Math.max(profile[d], d >= 108 && d <= 112 ? 70 : 20 + k * 52);
  }
  const VOLCANO_AZ = 110 * Math.PI / 180;
  const lava = [];                                     // eruption particles: [azimuth offset, height, vAz, vH, life]

  function resize(api) {
    const reserve = matchMedia("(pointer: coarse)").matches ? 255 : 170;
    const availW = Math.min(window.innerWidth - 32, 1100);
    const availH = window.innerHeight - reserve;
    // wide view on PCs; on a phone held upright use the spare height for a taller view
    const aspect = window.innerHeight > window.innerWidth * 1.3 ? 1.15 : 1.6;
    const w = Math.max(300, Math.floor(Math.min(availW, availH * aspect)));
    const key = `${w}:${aspect}:${window.devicePixelRatio || 1}`;
    if (key === sizedFor) return;
    sizedFor = key;
    cw = w; ch = Math.round(w / aspect);
    F = (cw / 2) / Math.tan(FOV / 2);
    HZ = ch * 0.56;
    const dpr = window.devicePixelRatio || 1;
    api.canvas.style.width = cw + "px";
    api.canvas.style.height = ch + "px";
    api.canvas.width = cw * dpr;
    api.canvas.height = ch * dpr;
  }

  // ---------------------------------------------------------- 3D helpers
  let cam = { x: 0, y: 0, a: 0, ca: 1, sa: 0 };
  function toCam(x, y, h) {                            // world -> (forward, right, height)
    const dx = x - cam.x, dy = y - cam.y;
    return [dx * cam.ca + dy * cam.sa, -dx * cam.sa + dy * cam.ca, h];
  }
  function proj(p) { return [cw / 2 + p[1] / p[0] * F, HZ - (p[2] - EYE) / p[0] * F]; }
  function seg(ctx, a, b) {                            // clipped 3D line
    if (a[0] < NEAR && b[0] < NEAR) return;
    if (a[0] < NEAR || b[0] < NEAR) {
      const t = (NEAR - a[0]) / (b[0] - a[0]);
      const c = [NEAR, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
      if (a[0] < NEAR) a = c; else b = c;
    }
    const pa = proj(a), pb = proj(b);
    ctx.moveTo(pa[0], pa[1]);
    ctx.lineTo(pb[0], pb[1]);
  }
  // draw a model: verts are [forward, right, height] relative to (x, y) with heading a
  function model(ctx, verts, edges, x, y, a, color, alpha) {
    const c = Math.cos(a), s = Math.sin(a);
    const pts = verts.map(([f, r, h]) => toCam(x + f * c - r * s, y + f * s + r * c, h));
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = color;
    ctx.beginPath();
    for (const [i, j] of edges) seg(ctx, pts[i], pts[j]);
    ctx.stroke();
    ctx.restore();
  }
  function visible(x, y, radius) {
    const p = toCam(x, y, 0);
    if (p[0] < -radius || p[0] > FAR) return null;
    if (Math.abs(p[1]) > Math.max(p[0], 1) * Math.tan(FOV / 2 + 0.15) + radius * 2) return null;
    return p[0];
  }
  const fade = d => Math.max(0.25, Math.min(1, 1.25 - d / FAR));

  // ---------------------------------------------------------- models
  const box = (f1, f2, r1, r2, h1, h2) => [[f1, r1, h1], [f2, r1, h1], [f2, r2, h1], [f1, r2, h1],
                                           [f1, r1, h2], [f2, r1, h2], [f2, r2, h2], [f1, r2, h2]];
  const BOX_E = [[0, 1], [1, 2], [2, 3], [3, 0], [4, 5], [5, 6], [6, 7], [7, 4], [0, 4], [1, 5], [2, 6], [3, 7]];
  const OBST = {
    0: { v: box(-30, 30, -30, 30, 0, 60), e: BOX_E },                                         // cube
    1: { v: [[-34, -34, 0], [34, -34, 0], [34, 34, 0], [-34, 34, 0], [0, 0, 78]],               // pyramid
         e: [[0, 1], [1, 2], [2, 3], [3, 0], [0, 4], [1, 4], [2, 4], [3, 4]] },
    2: { v: box(-26, 26, -26, 26, 0, 28), e: BOX_E },                                         // short block
  };
  function tankModel(superTank) {
    const v = [], e = [];
    const add = (verts, edges) => { const o = v.length; v.push(...verts); edges.forEach(([i, j]) => e.push([i + o, j + o])); };
    if (superTank) {
      add([[-32, -20, 0], [26, -20, 0], [26, 20, 0], [-32, 20, 0], [-26, -15, 10], [40, 0, 7], [-26, 15, 10]],
          [[0, 1], [1, 2], [2, 3], [3, 0], [0, 4], [1, 5], [2, 5], [3, 6], [4, 5], [5, 6], [6, 4]]);
      add(box(-16, 4, -9, 9, 10, 19), BOX_E);
      add([[4, -1.5, 15], [44, -1.5, 15], [44, 1.5, 15], [4, 1.5, 15]], [[0, 1], [1, 2], [2, 3]]);
    } else {
      add([[-30, -21, 0], [30, -21, 0], [30, 21, 0], [-30, 21, 0],
           [-24, -17, 12], [24, -17, 12], [24, 17, 12], [-24, 17, 12]], BOX_E);
      add([[-14, -11, 12], [8, -11, 12], [8, 11, 12], [-14, 11, 12],
           [-12, -8, 24], [5, -8, 24], [5, 8, 24], [-12, 8, 24]], BOX_E);
      add([[5, -1.5, 19], [40, -1.5, 19], [40, 1.5, 19], [5, 1.5, 19]], [[0, 1], [1, 2], [2, 3]]);
    }
    return { v, e };
  }
  const TANK = tankModel(false), SUPER = tankModel(true);
  const MISSILE = {
    v: [[-30, -5, 12], [24, -5, 12], [24, 5, 12], [-30, 5, 12], [-30, 0, 20], [24, 0, 20], [44, 0, 14],
        [-30, -14, 10], [-18, -5, 12], [-30, 14, 10], [-18, 5, 12]],
    e: [[0, 1], [1, 2], [2, 3], [3, 0], [3, 4], [0, 4], [4, 5], [1, 5], [2, 5], [1, 6], [2, 6], [5, 6],
        [0, 7], [7, 8], [3, 9], [9, 10]],
  };
  function saucerModel() {
    const v = [], e = [], n = 10;
    for (let i = 0; i < n; i++) v.push([Math.cos(i / n * Math.PI * 2) * 30, Math.sin(i / n * Math.PI * 2) * 30, 58]);
    v.push([0, 0, 72], [0, 0, 48]);
    for (let i = 0; i < n; i++) { e.push([i, (i + 1) % n], [i, n], [i, n + 1]); }
    return { v, e };
  }
  const SAUCER = saucerModel();

  // ---------------------------------------------------------- drawing
  function drawMountains(ctx, dt) {
    ctx.save();
    ctx.strokeStyle = GREEN_DIM;
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    const span = FOV / 2 + 0.12;
    let first = true;
    for (let rel = -span; rel <= span; rel += Math.PI / 180) {
      const az = cam.a + rel;
      let deg = ((az * 180 / Math.PI) % 360 + 360) % 360;
      const d0 = Math.floor(deg), d1 = (d0 + 1) % 360, k = deg - d0;
      const h = profile[d0] * (1 - k) + profile[d1] * k;
      const x = cw / 2 + Math.tan(rel) * F, y = HZ - h * ch / 500;
      first ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      first = false;
    }
    ctx.stroke();
    // horizon
    ctx.strokeStyle = GREEN;
    ctx.globalAlpha = .55;
    ctx.beginPath(); ctx.moveTo(0, HZ); ctx.lineTo(cw, HZ); ctx.stroke();
    ctx.globalAlpha = 1;

    // volcano eruption (story has it a colleague wrote this bit himself)
    if (Math.random() < dt * 6) lava.push([(Math.random() - .5) * .01, 70, (Math.random() - .5) * .02, 30 + Math.random() * 35, 0]);
    for (const p of lava) { p[0] += p[2] * dt; p[1] += p[3] * dt; p[3] -= 40 * dt; p[4] += dt; }
    while (lava.length && (lava[0][1] < 40 || lava[0][4] > 4)) lava.shift();
    const rel = Math.atan2(Math.sin(VOLCANO_AZ - cam.a), Math.cos(VOLCANO_AZ - cam.a));
    if (Math.abs(rel) < span) {
      ctx.strokeStyle = GREEN;
      ctx.beginPath();
      for (const [az, h, vaz, vh] of lava) {
        const x = cw / 2 + Math.tan(rel + az) * F, y = HZ - h * ch / 500;
        ctx.moveTo(x, y); ctx.lineTo(x - vaz * F * .05, y + vh * ch / 500 * .06);
      }
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawBoom(ctx, b) {
    const [x, y, age, kind] = b;
    const d = visible(x, y, 120);
    if (d == null) return;
    let s = Math.floor(x * 3 + y * 7) || 1;
    const r = () => (s = (s * 16807) % 2147483647) / 2147483647;
    const n = kind === "shell" ? 5 : 12;
    ctx.save();
    ctx.globalAlpha = Math.max(0, 1 - age / 1.6) * fade(d);
    ctx.strokeStyle = GREEN;
    ctx.beginPath();
    for (let i = 0; i < n; i++) {
      const ang = r() * Math.PI * 2, sp = (kind === "shell" ? 40 : 90) * (0.4 + r());
      const vz = (kind === "shell" ? 40 : 110) * (0.5 + r());
      const px = x + Math.cos(ang) * sp * age, py = y + Math.sin(ang) * sp * age;
      const h = Math.max(0, 8 + vz * age - 90 * age * age);
      const len = kind === "shell" ? 4 : 10;
      seg(ctx, toCam(px, py, h), toCam(px + Math.cos(ang + 1) * len, py + Math.sin(ang + 1) * len, h + len * .6));
    }
    ctx.stroke();
    ctx.restore();
  }

  function drawRadar(ctx, g, me, t) {
    const R = Math.max(34, Math.min(ch * 0.15, 76)), cx = cw / 2, cy = R + 10;
    const sweep = (t * Math.PI) % (Math.PI * 2);           // one turn every 2 s
    ctx.save();
    ctx.strokeStyle = RED;
    ctx.fillStyle = RED;
    ctx.lineWidth = 1.3;
    ctx.globalAlpha = .9;
    ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.stroke();
    for (let i = 0; i < 4; i++) {
      const a = i * Math.PI / 2;
      ctx.beginPath(); ctx.moveTo(cx + Math.sin(a) * R * .88, cy - Math.cos(a) * R * .88);
      ctx.lineTo(cx + Math.sin(a) * R, cy - Math.cos(a) * R); ctx.stroke();
    }
    ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + Math.sin(sweep) * R, cy - Math.cos(sweep) * R); ctx.stroke();
    // field of view wedge
    ctx.globalAlpha = .35;
    ctx.beginPath();
    ctx.moveTo(cx, cy); ctx.lineTo(cx + Math.sin(-FOV / 2) * R * .5, cy - Math.cos(-FOV / 2) * R * .5);
    ctx.moveTo(cx, cy); ctx.lineTo(cx + Math.sin(FOV / 2) * R * .5, cy - Math.cos(FOV / 2) * R * .5);
    ctx.stroke();
    // blips: the enemy (one player) or the other tanks (versus); the saucer never shows
    const targets = g.solo ? (g.enemy ? [g.enemy] : []) : g.tanks.filter(o => o.alive && o.id !== me);
    for (const o of targets) {
      const p = toCam(o.x, o.y, 0), d = Math.hypot(p[0], p[1]);
      if (d > 3000) continue;
      const rel = Math.atan2(p[1], p[0]);
      const ang = (rel + Math.PI * 2) % (Math.PI * 2);
      const since = ((sweep - ang) + Math.PI * 4) % (Math.PI * 2);
      ctx.globalAlpha = Math.max(.15, 1 - since / (Math.PI * 2));
      ctx.beginPath();
      ctx.arc(cx + Math.sin(rel) * d / 3000 * R, cy - Math.cos(rel) * d / 3000 * R, 2.6, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
    return R;
  }

  function drawMap(ctx, g, mine) {
    const m = Math.round(Math.max(56, Math.min(150, Math.min(cw, ch) * 0.22)));
    const x0 = 10, y0 = ch - m - 10, k = m / g.size;
    ctx.save();
    ctx.fillStyle = "rgba(0, 20, 6, .55)";
    ctx.fillRect(x0, y0, m, m);
    ctx.strokeStyle = GREEN_DIM;
    ctx.lineWidth = 1;
    ctx.strokeRect(x0 + .5, y0 + .5, m - 1, m - 1);
    ctx.fillStyle = GREEN_DIM;
    for (const [ox, oy, kind] of g.obstacles) {
      const s = Math.max(1.5, (kind === 2 ? 26 : 34) * 2 * k);
      ctx.fillRect(x0 + ox * k - s / 2, y0 + oy * k - s / 2, s, s);
    }
    if (mine && mine.alive) {                              // you: an arrow showing your heading
      const px = x0 + mine.x * k, py = y0 + mine.y * k, c = Math.cos(mine.a), s = Math.sin(mine.a);
      ctx.fillStyle = "#ffffff";
      ctx.beginPath();
      ctx.moveTo(px + c * 7, py + s * 7);
      ctx.lineTo(px - c * 4 - s * 4, py - s * 4 + c * 4);
      ctx.lineTo(px - c * 4 + s * 4, py - s * 4 - c * 4);
      ctx.closePath();
      ctx.fill();
      // view cone
      ctx.strokeStyle = "rgba(255,255,255,.35)";
      ctx.beginPath();
      for (const da of [-FOV / 2, FOV / 2]) {
        ctx.moveTo(px, py);
        ctx.lineTo(px + Math.cos(mine.a + da) * 22, py + Math.sin(mine.a + da) * 22);
      }
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawCrosshair(ctx, aligned) {
    const cx = cw / 2, cy = HZ - ch * 0.03, s = Math.max(10, ch * 0.05);
    ctx.save();
    ctx.strokeStyle = aligned ? RED : GREEN;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(cx, cy - s * 2.2); ctx.lineTo(cx, cy - s * .7);
    ctx.moveTo(cx, cy + s * .7); ctx.lineTo(cx, cy + s * 2.2);
    ctx.moveTo(cx - s * 1.4, cy - s * .7); ctx.lineTo(cx - s * 1.4, cy - s * 1.2); ctx.lineTo(cx - s * .6, cy - s * 1.2);
    ctx.moveTo(cx + s * 1.4, cy - s * .7); ctx.lineTo(cx + s * 1.4, cy - s * 1.2); ctx.lineTo(cx + s * .6, cy - s * 1.2);
    ctx.moveTo(cx - s * 1.4, cy + s * .7); ctx.lineTo(cx - s * 1.4, cy + s * 1.2); ctx.lineTo(cx - s * .6, cy + s * 1.2);
    ctx.moveTo(cx + s * 1.4, cy + s * .7); ctx.lineTo(cx + s * 1.4, cy + s * 1.2); ctx.lineTo(cx + s * .6, cy + s * 1.2);
    ctx.stroke();
    ctx.restore();
  }

  function drawCrack(ctx, deathNo) {
    if (crackFor !== deathNo) {                            // a new pattern for each hit
      crackFor = deathNo;
      let s = deathNo * 977 + 13;
      const r = () => (s = (s * 16807) % 2147483647) / 2147483647;
      const ox = cw * (.35 + r() * .3), oy = ch * (.4 + r() * .3);
      crack = [];
      for (let i = 0; i < 9; i++) {
        let a = r() * Math.PI * 2, x = ox, y = oy;
        const path = [[x, y]];
        for (let j = 0; j < 6; j++) {
          a += (r() - .5) * .6;
          x += Math.cos(a) * cw * .07 * (0.5 + r());
          y += Math.sin(a) * ch * .07 * (0.5 + r());
          path.push([x, y]);
        }
        crack.push(path);
      }
    }
    ctx.save();
    ctx.strokeStyle = "rgba(220,255,225,.85)";
    ctx.lineWidth = 1.3;
    ctx.beginPath();
    for (const path of crack) path.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    ctx.stroke();
    ctx.restore();
  }

  function render(api) {
    resize(api);
    const st = api.st(), me = api.me(), g = st.game, ctx = api.ctx;
    const dpr = window.devicePixelRatio || 1;
    const players = Object.fromEntries(st.players.map(p => [p.id, p]));
    const now = performance.now(), dt = Math.min(.1, (now - lastFrame) / 1000);
    lastFrame = now;
    const t = now / 1000;
    const mine = g.tanks.find(x => x.id === me) || g.tanks[0];
    if (mine) cam = { x: mine.x, y: mine.y, a: mine.a, ca: Math.cos(mine.a), sa: Math.sin(mine.a) };

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, cw, ch);
    ctx.lineWidth = 1.4;
    ctx.lineJoin = "round";
    ctx.shadowColor = GREEN;
    ctx.shadowBlur = 3;
    drawMountains(ctx, dt);

    // arena boundary: a dashed line on the ground
    ctx.save();
    ctx.strokeStyle = GREEN_DIM;
    ctx.globalAlpha = .7;
    ctx.beginPath();
    const S = g.size;
    for (const [x1, y1, x2, y2] of [[0, 0, S, 0], [S, 0, S, S], [S, S, 0, S], [0, S, 0, 0]]) {
      const n = Math.ceil(S / 120);
      for (let i = 0; i < n; i += 2) {
        const a = i / n, b = (i + 1) / n;
        const p1 = toCam(x1 + (x2 - x1) * a, y1 + (y2 - y1) * a, 0), p2 = toCam(x1 + (x2 - x1) * b, y1 + (y2 - y1) * b, 0);
        if (Math.min(p1[0], p2[0]) < FAR) seg(ctx, p1, p2);
      }
    }
    ctx.stroke();
    ctx.restore();

    // everything in the world, far to near
    const items = [];
    for (const [x, y, kind] of g.obstacles) items.push({ x, y, a: 0, m: OBST[kind], c: GREEN, r: 50 });
    if (g.enemy) items.push({ x: g.enemy.x, y: g.enemy.y, a: g.enemy.a,
      m: g.enemy.k === "missile" ? MISSILE : g.enemy.k === "super" ? SUPER : TANK, c: GREEN, r: 50 });
    if (g.saucer) items.push({ x: g.saucer.x, y: g.saucer.y, a: g.saucer.a, m: SAUCER, c: GREEN, r: 40 });
    for (const o of g.tanks) {
      if (o.id === me || !o.alive) continue;
      const p = players[o.id];
      const blink = o.inv && Math.floor(t * 8) % 2;
      if (!blink) items.push({ x: o.x, y: o.y, a: o.a, m: TANK, c: p ? p.color : GREEN, r: 50, name: p && p.name });
    }
    for (const it of items) it.d = visible(it.x, it.y, it.r);
    items.filter(it => it.d != null).sort((a, b) => b.d - a.d).forEach(it => {
      model(ctx, it.m.v, it.m.e, it.x, it.y, it.a, it.c, fade(it.d));
      if (it.name && it.d < 2500) {
        const p = toCam(it.x, it.y, 40);
        if (p[0] > NEAR) {
          const [sx, sy] = proj(p);
          ctx.save(); ctx.shadowBlur = 0; ctx.fillStyle = it.c; ctx.globalAlpha = fade(it.d);
          ctx.font = `600 ${Math.max(10, Math.round(cw / 75))}px system-ui, sans-serif`;
          ctx.textAlign = "center"; ctx.fillText(it.name, sx, sy); ctx.restore();
        }
      }
    });

    // shells: small diamonds
    ctx.save();
    ctx.strokeStyle = GREEN;
    ctx.beginPath();
    for (const [x, y, owner, a] of g.shells) {
      if (visible(x, y, 10) == null) continue;
      const c = Math.cos(a), s = Math.sin(a);
      const P = (f, r, h) => toCam(x + f * c - r * s, y + f * s + r * c, h);
      const n = P(6, 0, 18), b = P(-6, 0, 18), l = P(0, -3, 18), r = P(0, 3, 18), u = P(0, 0, 21), dn = P(0, 0, 15);
      seg(ctx, n, l); seg(ctx, l, b); seg(ctx, b, r); seg(ctx, r, n); seg(ctx, u, dn);
    }
    ctx.stroke();
    ctx.restore();
    for (const b of g.booms) drawBoom(ctx, b);
    ctx.shadowBlur = 0;

    // instruments
    const enemies = g.solo ? (g.enemy ? [g.enemy] : []) : g.tanks.filter(o => o.alive && o.id !== me);
    let aligned = false, warn = "";
    if (mine && mine.alive && enemies.length) {
      let best = null;
      for (const o of enemies) {
        const p = toCam(o.x, o.y, 0), d = Math.hypot(p[0], p[1]), rel = Math.atan2(p[1], p[0]);
        if (!best || d < best.d) best = { d, rel };
      }
      if (Math.abs(best.rel) < FOV / 2 && best.d < 2200) { warn = "ENEMY IN RANGE"; aligned = Math.abs(best.rel) < 0.05; }
      else if (Math.abs(best.rel) > Math.PI * .75) warn = "ENEMY TO REAR";
      else if (best.rel < 0) warn = "ENEMY TO LEFT";
      else warn = "ENEMY TO RIGHT";
    }
    if (mine && mine.alive) drawCrosshair(ctx, aligned);
    const R = drawRadar(ctx, g, me, t);
    const fs = Math.max(10, Math.round(cw / 62));
    ctx.font = `600 ${fs}px ui-monospace, Consolas, monospace`;
    ctx.fillStyle = RED;
    ctx.textBaseline = "top";
    ctx.textAlign = "left";
    const lines = [];
    if (warn) lines.push(warn);
    if (mine && mine.blocked && mine.alive) lines.push("MOTION BLOCKED BY OBJECT");
    lines.forEach((s, i) => ctx.fillText(s, 12, 12 + i * fs * 1.5));
    ctx.textAlign = "right";
    if (g.solo && mine) {
      ctx.fillText(`SCORE ${String(mine.score).padStart(6, "0")}`, cw - 12, 12);
      ctx.fillText(`TANKS ${"▲".repeat(Math.max(0, Math.min(mine.lives, 8)))}`, cw - 12, 12 + fs * 1.5);
    } else if (mine) {
      ctx.fillText(`KILLS ${mine.kills} / ${g.target}`, cw - 12, 12);
    }
    drawMap(ctx, g, mine);
    if (mine && !mine.alive && mine.deaths) drawCrack(ctx, mine.deaths);

    // scoreboard (versus) and status line
    api.$("chips").innerHTML = g.solo ? "" : [...g.tanks].sort((a, b) => b.kills - a.kills).map(o => {
      const p = players[o.id];
      if (!p) return "";
      return `<span class="chip${o.alive ? "" : " dead"}${o.id === me ? " me" : ""}">
        <span class="dot" style="background:${p.color}"></span>${api.esc(p.name)} <b>${o.kills}</b></span>`;
    }).join("");
    api.$("timer").textContent = g.solo ? "Battlezone" : `First to ${g.target}`;

    let big = "", small = "", huge = false, dim = false;
    if (st.state === "lobby" && st.results) {
      big = st.results.title; dim = true;
    } else if (g.phase === "countdown") {
      big = g.countdown; huge = true;
      small = g.solo ? "Enemy tanks ahead – use the radar" : "Everyone against everyone";
    } else if (mine && !mine.alive && !mine.out) {
      if (g.solo) {
        big = "Tank destroyed";
        small = mine.lives > 0 ? `${mine.lives} tank${mine.lives > 1 ? "s" : ""} left · back in ${(mine.respawn || 0).toFixed(1)} s` : "";
      } else {
        const by = players[mine.killed_by];
        big = "Tank destroyed";
        small = `${by ? `by ${by.name} · ` : ""}back in ${(mine.respawn || 0).toFixed(1)} s`;
      }
    }
    api.setMessage(big, small, huge, dim);
  }

  // ---------------------------------------------------------- sound
  function ensureEngine(api) {
    const a = api.audio();
    if (!a) return null;
    if (engine && engine.ctx === a) return engine;
    const o1 = a.createOscillator(), o2 = a.createOscillator(), gain = a.createGain(), filt = a.createBiquadFilter();
    o1.type = "sawtooth"; o1.frequency.value = 42;
    o2.type = "square"; o2.frequency.value = 63;
    filt.type = "lowpass"; filt.frequency.value = 220;
    gain.gain.value = 0;
    o1.connect(filt); o2.connect(filt); filt.connect(gain).connect(a.destination);
    o1.start(); o2.start();
    engine = { ctx: a, gain, o1 };
    return engine;
  }
  function setEngine(api, moving) {
    const e = moving ? ensureEngine(api) : engine;
    if (!e) return;
    const now = e.ctx.currentTime;
    e.gain.gain.setTargetAtTime(api.soundOn() && moving ? 0.07 : 0, now, 0.08);
    e.o1.frequency.setTargetAtTime(moving ? 52 : 42, now, 0.2);
  }

  function sounds(api, prev, next) {
    apiRef = api;
    const me = api.me(), pg = prev.game, ng = next.game;
    if (!pg || !ng || !ng.tanks) return false;
    const mine = ng.tanks.find(o => o.id === me);
    setEngine(api, !!(mine && mine.alive && mine.moving && ng.phase === "playing"));
    const count = (g, f) => (g.shells || []).filter(f).length;
    if (count(ng, s => s[2] === me) > count(pg, s => s[2] === me)) {
      api.tone(520, 0, .28, "sawtooth", .09, 70);                     // your cannon
    }
    if (count(ng, s => s[2] !== me) > count(pg, s => s[2] !== me) && mine && mine.alive) {
      api.tone(980, 0, .1, "square", .05); api.tone(740, .12, .12, "square", .05);   // enemy fired!
    }
    let crashed = false;
    for (const b of ng.booms || []) {
      const key = `${b[0]},${b[1]},${b[3]}`;
      if (heard.has(key) || b[2] > .4) continue;
      heard.add(key);
      if (b[3] === "shell") api.tone(200, 0, .2, "sawtooth", .05, 60);
      else { api.tone(130, 0, .8, "sawtooth", .1, 25); api.tone(70, .03, .9, "square", .06, 20); }
    }
    if (heard.size > 300) heard.clear();
    const was = (pg.tanks || []).find(o => o.id === me);
    if (was && was.alive && mine && !mine.alive) crashed = true;
    if (mine && !mine.out) {
      if (ng.phase === "countdown" && ng.countdown !== pg.countdown) api.play("tick");
      if (pg.phase === "countdown" && ng.phase === "playing") api.play("go");
    }
    return crashed;
  }

  function liveInfo(st) {
    return st.game.solo ? "battle in progress" : `first to ${st.game.target}`;
  }
  function status(st, pid) {
    const o = st.game.tanks.find(x => x.id === pid);
    if (!o) return "";
    return st.game.solo ? `${o.score} pts` : `${o.kills} kills${o.alive ? "" : " · respawning"}`;
  }

  // simple driving on the arrows, or the original twin tracks (Q/A left, O/L right); phones get twin tracks
  const controls = {
    hold: true,
    swipe: false,
    keys: {
      ArrowUp: "fwd", ArrowDown: "back", ArrowLeft: "left", ArrowRight: "right", " ": "fire",
      q: "lf", a: "lb", o: "rf", l: "rb", Control: "fire",
    },
    pad: {
      cols: "72px 100px 72px",
      buttons: [
        { key: "lf", name: "left track forward", label: "&#9650;", sub: "left track", col: 1, row: 1 },
        { key: "lb", name: "left track back", label: "&#9660;", col: 1, row: 2 },
        { key: "fire", label: "FIRE", col: 2, row: 1, rows: 2 },
        { key: "rf", name: "right track forward", label: "&#9650;", sub: "right track", col: 3, row: 1 },
        { key: "rb", name: "right track back", label: "&#9660;", col: 3, row: 2 },
      ],
    },
    help: "↑ forward · ← → turn · ↓ reverse · Space fire · twin tracks: Q/A left, O/L right · Esc to exit",
  };

  window.GAMES = window.GAMES || {};
  window.GAMES.battlezone = {
    render, sounds, liveInfo, status, controls,
    onResize() { sizedFor = ""; },
    onHide() { if (apiRef) setEngine(apiRef, false); },
  };
})();
