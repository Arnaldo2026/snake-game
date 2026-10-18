// Lunar Lander – browser part (vector drawing with auto-zoom, readouts, engine sound, controls).
// Rules and physics run on the server (games/lander.py).
(() => {
  const WW = 1600, WH = 1000;
  let cw = 800, ch = 500, base = 0.5, sizedFor = "";
  let zoom = 1, camX = WW / 2, camY = WH / 2;
  let engine = null;              // {gain, nodes} – continuous rumble
  let beepAt = 0;
  let lastResultKey = "";

  // a sprinkle of stars in the sky (world coordinates)
  const stars = [];
  let seed = 11;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (let i = 0; i < 70; i++) stars.push([rnd() * WW, rnd() * 520, rnd() < .2 ? 1.5 : .9]);

  function resize(api) {
    const reserve = matchMedia("(pointer: coarse)").matches ? 255 : 170;
    const availW = Math.min(window.innerWidth - 32, 1100);
    const availH = window.innerHeight - reserve;
    const w = Math.max(300, Math.floor(Math.min(availW, availH * 1.6)));
    const key = `${w}:${window.devicePixelRatio || 1}`;
    if (key === sizedFor) return;
    sizedFor = key;
    cw = w; ch = Math.round(w / 1.6); base = cw / WW;
    const dpr = window.devicePixelRatio || 1;
    api.canvas.style.width = cw + "px";
    api.canvas.style.height = ch + "px";
    api.canvas.width = cw * dpr;
    api.canvas.height = ch * dpr;
  }

  // the lunar module: cabin, descent stage, legs and feet, nozzle
  function drawLander(ctx, l, color, lw) {
    ctx.save();
    ctx.translate(l.x, l.y);
    ctx.rotate(l.a);
    ctx.scale(1.5, 1.5);                          // matches the feet used by the server (LEG/FOOT)
    ctx.strokeStyle = color;
    ctx.lineWidth = lw / 1.5;
    ctx.lineJoin = "round";
    ctx.shadowColor = color;
    ctx.shadowBlur = 6;
    ctx.beginPath();
    const r = 5.5, cy = -4;                       // cabin (octagon)
    for (let i = 0; i < 8; i++) {
      const ang = Math.PI / 8 + i * Math.PI / 4;
      const px = Math.cos(ang) * r, py = cy + Math.sin(ang) * r;
      i ? ctx.lineTo(px, py) : ctx.moveTo(px, py);
    }
    ctx.closePath();
    ctx.rect(-7, 1.5, 14, 4.5);                   // descent stage
    ctx.moveTo(-6, 6); ctx.lineTo(-9, 9);         // legs
    ctx.moveTo(6, 6); ctx.lineTo(9, 9);
    ctx.moveTo(-11, 9); ctx.lineTo(-7, 9);        // feet
    ctx.moveTo(7, 9); ctx.lineTo(11, 9);
    ctx.moveTo(-2, 6); ctx.lineTo(-3, 8.5); ctx.lineTo(3, 8.5); ctx.lineTo(2, 6);   // nozzle
    ctx.stroke();
    const burst = l.abort != null && l.abort < 0.7;          // abort burn: a big flame
    if (l.state === "flying" && (l.throttle > 0.02 || burst)) {
      const len = burst ? 26 + Math.random() * 10 : 4 + l.throttle * 18 * (0.75 + Math.random() * 0.5);
      ctx.strokeStyle = "#fde68a";
      ctx.shadowColor = "#fbbf24";
      ctx.beginPath();
      ctx.moveTo(-2.5, 9); ctx.lineTo(0, 9 + len); ctx.lineTo(2.5, 9);
      ctx.stroke();
    }
    ctx.restore();
  }

  function render(api) {
    resize(api);
    const st = api.st(), me = api.me(), g = st.game, ctx = api.ctx;
    const dpr = window.devicePixelRatio || 1;
    const players = Object.fromEntries(st.players.map(p => [p.id, p]));
    const mine = g.landers.find(l => l.id === me);
    const focus = mine || g.landers[0];
    const t = performance.now() / 1000;

    // camera: zoom in close to the surface, like the cabinet
    const target = focus && focus.state === "flying" && focus.alt < 140 ? 2.6 : 1;
    zoom += (target - zoom) * 0.12;
    if (Math.abs(target - zoom) < 0.01) zoom = target;
    const k = (zoom - 1) / 1.6;
    let fx = focus ? focus.x : WW / 2;
    if (fx - camX > WW / 2) fx -= WW; else if (camX - fx > WW / 2) fx += WW;
    camX = WW / 2 + (fx - WW / 2) * k;
    const halfH = WH / (2 * zoom);
    camY = Math.min(WH - halfH, Math.max(halfH, WH / 2 + ((focus ? focus.y : WH / 2) - WH / 2) * k));
    const s = base * zoom;

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, cw, ch);
    ctx.setTransform(dpr * s, 0, 0, dpr * s, dpr * (cw / 2 - camX * s), dpr * (ch / 2 - camY * s));
    const lw = 1.6 / s;

    for (const off of [-WW, 0, WW]) {             // the world wraps left/right
      ctx.save();
      ctx.translate(off, 0);
      ctx.fillStyle = "rgba(255,255,255,.4)";
      for (const [x, y, r] of stars) ctx.fillRect(x, y, r / s * 1.2, r / s * 1.2);

      // terrain
      ctx.strokeStyle = "#e5e7eb";
      ctx.shadowColor = "#9ca3af";
      ctx.shadowBlur = 4;
      ctx.lineWidth = lw;
      ctx.beginPath();
      g.terrain.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
      ctx.stroke();

      // pads: brighter, with flashing multipliers
      for (const [x1, x2, mult, y] of g.pads) {
        ctx.strokeStyle = "#ffffff";
        ctx.lineWidth = lw * 2.2;
        ctx.beginPath(); ctx.moveTo(x1, y); ctx.lineTo(x2, y); ctx.stroke();
        if (mult > 1 && Math.floor(t * 2) % 2 === 0) {
          ctx.shadowBlur = 0;
          ctx.fillStyle = "#facc15";
          ctx.font = `700 ${14 / zoom + 4}px ui-monospace, Consolas, monospace`;
          ctx.textAlign = "center";
          ctx.textBaseline = "top";
          ctx.fillText(`×${mult}`, (x1 + x2) / 2, y + 6);
          ctx.shadowBlur = 4;
        }
      }

      // explosions
      for (const [bx, by, age] of g.booms) {
        const kk = Math.min(1, age / 1.4);
        ctx.save();
        ctx.globalAlpha = 1 - kk;
        ctx.strokeStyle = "#fff";
        ctx.shadowColor = "#fbbf24";
        ctx.shadowBlur = 10;
        ctx.lineWidth = lw;
        let sd = Math.floor(bx * 7 + by * 3) || 1;
        const r = () => (sd = (sd * 16807) % 2147483647) / 2147483647;
        ctx.beginPath();
        for (let i = 0; i < 12; i++) {
          const ang = -Math.PI * r(), d = (10 + r() * 40) * kk, d2 = d + 3 + r() * 6;
          ctx.moveTo(bx + Math.cos(ang) * d, by + Math.sin(ang) * d);
          ctx.lineTo(bx + Math.cos(ang) * d2, by + Math.sin(ang) * d2);
        }
        ctx.stroke();
        ctx.restore();
      }

      // landers (mine last, on top)
      const order = [...g.landers].sort((a, b) => (a.id === me) - (b.id === me));
      for (const l of order) {
        const p = players[l.id];
        if (!p || !["flying", "landed"].includes(l.state)) continue;
        const col = g.landers.length > 1 ? p.color : "#ffffff";
        drawLander(ctx, l, col, lw);
        if (g.landers.length > 1) {
          ctx.shadowBlur = 0;
          ctx.fillStyle = l.id === me ? "#fff" : p.color;
          ctx.font = `600 ${12 / zoom + 3}px system-ui, sans-serif`;
          ctx.textAlign = "center";
          ctx.textBaseline = "bottom";
          ctx.fillText(l.id === me ? "you" : p.name, l.x, l.y - 20);
        }
      }
      ctx.restore();
    }

    // readouts, in the cabinet's layout
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.shadowBlur = 0;
    if (focus) {
      const fs = Math.max(10, Math.round(cw / 70));
      ctx.font = `600 ${fs}px ui-monospace, Consolas, monospace`;
      ctx.textBaseline = "top";
      const lh = fs * 1.45, pad = fs * 0.9;
      const low = focus.fuel < 100 && focus.state === "flying";
      const left = [["SCORE", String(focus.score).padStart(4, "0")],
                    ["TIME", api.fmtTime(g.time)],
                    ["FUEL", String(focus.fuel).padStart(4, "0")],
                    ["THRUST", `${"█".repeat(Math.round(focus.throttle * 8)).padEnd(8, "░")}`]];
      left.forEach(([a, b], i) => {
        ctx.fillStyle = a === "FUEL" && low && Math.floor(t * 3) % 2 ? "#f87171" : "#e5e7eb";
        ctx.textAlign = "left";
        ctx.fillText(`${a.padEnd(7)}${b}`, pad, pad + i * lh);
      });
      const vx = focus.vx, vy = focus.vy;
      const right = [["ALTITUDE", String(Math.round(focus.alt)).padStart(4)],
                     ["HORIZONTAL SPEED", `${String(Math.abs(Math.round(vx))).padStart(3)} ${vx > 0.5 ? "→" : vx < -0.5 ? "←" : " "}`],
                     ["VERTICAL SPEED", `${String(Math.abs(Math.round(vy))).padStart(3)} ${vy > 0.5 ? "↓" : vy < -0.5 ? "↑" : " "}`]];
      right.forEach(([a, b], i) => {
        ctx.fillStyle = "#e5e7eb";
        ctx.textAlign = "right";
        ctx.fillText(`${a}  ${b}`, cw - pad, pad + i * lh);
      });
      // abort feedback, centred under the readouts
      if (focus.abort != null || focus.abort_denied) {
        ctx.textAlign = "center";
        ctx.font = `800 ${Math.round(fs * 1.6)}px ui-monospace, Consolas, monospace`;
        ctx.fillStyle = focus.abort != null ? "#fde68a" : "#f87171";
        if (focus.abort == null || Math.floor(t * 6) % 2 === 0) {
          ctx.fillText(focus.abort != null ? "ABORT" : "NOT ENOUGH FUEL TO ABORT", cw / 2, pad + lh * 3.2);
        }
      }
    }

    // scoreboard chips and descent info
    const sorted = [...g.landers].sort((a, b) => b.score - a.score);
    api.$("chips").innerHTML = g.landers.length < 2 ? "" : sorted.map(l => {
      const p = players[l.id];
      if (!p) return "";
      const gone = l.state === "done" || l.state === "out";
      return `<span class="chip${gone ? " dead" : ""}${l.id === me ? " me" : ""}">
        <span class="dot" style="background:${p.color}"></span>${api.esc(p.name)} <b>${l.score}</b>
        <span style="opacity:.7">⛽${l.fuel}</span></span>`;
    }).join("");
    const mission = { training: "Training", cadet: "Cadet", prime: "Prime", command: "Command" }[g.mission];
    api.$("timer").textContent = g.descent ? `${mission} · descent ${g.descent}` : mission;

    if (mine) api.syncLever("throttle", mine.throttle);

    // centre message
    let big = "", small = "", huge = false, dim = false;
    const res = mine && mine.result;
    if (st.state === "lobby" && st.results) {
      big = st.results.title; dim = true;
    } else if (g.phase === "countdown") {
      big = g.countdown; huge = true;
      small = `Descent ${g.descent} · ${mission}`;
    } else if (res && (mine.state === "landed" || mine.state === "crashed" || mine.state === "done")) {
      big = res.kind === "good" ? "Good landing" : res.kind === "hard" ? "Hard landing" : "Crashed";
      small = `+${res.points} points${res.mult > 1 ? ` (×${res.mult})` : ""}${res.bonus ? ` · +${res.bonus} fuel` : ""}`;
      if (mine.state === "done") small += " · out of fuel";
      else if (g.phase === "descent") small += " · waiting for the others";
    } else if (mine && mine.state === "waiting") {
      big = "Next descent"; small = "You'll join when this descent ends"; dim = true;
    } else if (mine && mine.state === "done") {
      big = "Out of fuel"; small = "Watching the others…"; dim = true;
    } else if (mine && mine.state === "flying" && mine.fuel <= 0) {
      small = "Out of fuel!";
    }
    api.setMessage(big, small, huge, dim);
  }

  // continuous engine rumble: filtered noise plus a low hum, loudness follows the throttle
  let engineBroken = false;
  function ensureEngine(api) {
    if (engineBroken) return null;
    try { return makeEngine(api); }
    catch (err) {                                   // no engine sound rather than a stuck game
      engineBroken = true;
      console.error("Lunar Lander engine sound unavailable:", err);
      return null;
    }
  }
  function makeEngine(api) {
    const a = api.audio();
    if (!a) return null;
    if (engine && engine.ctx === a) return engine;
    const buf = a.createBuffer(1, a.sampleRate * 2, a.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    const noise = a.createBufferSource();
    noise.buffer = buf; noise.loop = true;
    const filt = a.createBiquadFilter();
    filt.type = "lowpass"; filt.frequency.value = 260;
    const hum = a.createOscillator();
    hum.type = "sawtooth"; hum.frequency.value = 48;
    const humGain = a.createGain(); humGain.gain.value = 0.25;
    const gain = a.createGain(); gain.gain.value = 0;
    noise.connect(filt).connect(gain);
    hum.connect(humGain).connect(gain);
    gain.connect(a.destination);
    noise.start(); hum.start();
    engine = { ctx: a, gain, filt };
    return engine;
  }
  function setEngine(api, level) {
    const e = level > 0 ? ensureEngine(api) : engine;
    if (!e) return;
    level = Number.isFinite(level) ? Math.max(0, Math.min(1, level)) : 0;
    try {
      const now = e.ctx.currentTime;
      e.gain.gain.setTargetAtTime(api.soundOn() ? level * 0.22 : 0, now, 0.05);
      e.filt.frequency.setTargetAtTime(180 + level * 260, now, 0.05);
    } catch (err) {
      engineBroken = true;
      engine = null;
      console.error("Lunar Lander engine sound stopped:", err);
    }
  }

  let apiRef = null;
  function sounds(api, prev, next) {
    apiRef = api;
    const me = api.me(), pg = prev.game, ng = next.game;
    if (!pg || !ng || !ng.landers) return false;
    const mine = ng.landers.find(l => l.id === me);
    const flying = mine && mine.state === "flying" && ng.phase === "descent";
    setEngine(api, flying ? mine.throttle : 0);
    if (flying && mine.fuel < 100 && mine.fuel > 0 && performance.now() - beepAt > 800) {
      beepAt = performance.now();
      api.tone(1250, 0, .09, "square", .04);
    }
    const was = (pg.landers || []).find(l => l.id === me);
    if (mine && mine.abort != null && !(was && was.abort != null)) {          // abort burn: a roar
      api.tone(70, 0, .7, "sawtooth", .12, 220);
      api.tone(140, 0, .5, "square", .05, 420);
    }
    if (mine && mine.abort_denied && !(was && was.abort_denied)) {
      api.tone(300, 0, .12, "square", .06); api.tone(220, .14, .2, "square", .06);
    }
    let crashed = false;
    if (mine && mine.result) {
      const key = `${ng.descent}:${mine.result.kind}`;
      if (key !== lastResultKey) {
        lastResultKey = key;
        if (mine.result.kind === "good") [660, 880, 1320].forEach((f, i) => api.tone(f, i * .1, .16, "triangle", .1));
        else if (mine.result.kind === "hard") api.tone(140, 0, .25, "square", .08, 70);
        else { api.tone(150, 0, .7, "sawtooth", .1, 28); api.tone(80, .02, .8, "square", .06, 22); crashed = true; }
      }
    }
    if (mine && !["out", "done", "waiting"].includes(mine.state)) {
      if (ng.phase === "countdown" && ng.countdown !== pg.countdown) api.play("tick");
      if (pg.phase === "countdown" && ng.phase === "descent") api.play("go");
    }
    return crashed;
  }

  function liveInfo(st) {
    return st.game.descent ? `descent ${st.game.descent}` : "starting";
  }

  function status(st, pid) {
    const l = st.game.landers.find(x => x.id === pid);
    if (!l) return "";
    return { flying: "descending", landed: "landed", crashed: "crashed", done: "out of fuel",
             waiting: "next descent", out: "left" }[l.state] + ` · ${l.score} pts`;
  }

  const controls = {
    hold: true,
    swipe: false,
    keys: {
      ArrowLeft: "left", ArrowRight: "right", ArrowUp: "up", ArrowDown: "down", " ": "abort", Enter: "abort",
      a: "left", d: "right", w: "up", s: "down",
    },
    pad: {
      cols: "64px 64px 12px 84px",
      buttons: [
        { key: "left", name: "rotate left", label: "&#10226;", col: 1, row: 1 },
        { key: "right", name: "rotate right", label: "&#10227;", col: 2, row: 1 },
        { key: "abort", label: "ABORT", sub: "−150 fuel", col: 1, span: 2, row: 2 },
        { type: "lever", key: "throttle", name: "thrust lever", sub: "thrust", col: 4, row: 1, rows: 2 },
      ],
    },
    help: "← → rotate · ↑ ↓ throttle (it stays where you leave it) · Space abort · Esc to exit",
  };

  window.GAMES = window.GAMES || {};
  window.GAMES.lander = {
    render, sounds, liveInfo, status, controls,
    onResize() { sizedFor = ""; },
    onHide() { if (apiRef) setEngine(apiRef, 0); },
  };
})();
