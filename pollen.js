/* Pollen — an almost invisible botanical layer that the cursor disturbs.
 *
 * Fully self-contained. It adds one canvas behind the flower and type, reads
 * the film's time from window.aurelle (if present) and changes nothing else.
 *
 * To switch it off:  set ENABLED = false below,
 *                    or open the page with ?pollen=off,
 *                    or delete the <script src="pollen.js"> line in index.html.
 */
(() => {
  const ENABLED = true;
  const STRENGTH = 1;         // overall visibility: 0.5 = fainter, 1.5 = stronger

  const off = why => { console.info(`[pollen] off: ${why}`); };
  if (!ENABLED) return off('ENABLED = false');
  if (/[?&]pollen=off\b/.test(location.search)) return off('?pollen=off');
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return off('system setting "Reduce motion" is on');
  const stage = document.getElementById('stage');
  if (!stage) return off('no #stage');
  console.info('[pollen] on: move the cursor (or drag a finger) across the empty background');

  /* ── Tuning ─────────────────────────────────────────── */
  const CELL = 15;            // one fibre per cell, jittered: fine, even, never a grid
  const RADIUS = 130;         // how far the disturbance reaches
  const RETURN = 0.016;       // spring back to rest
  const DAMP = 0.885;         // inertia
  const FADE = 0.978;         // how quickly a disturbed fibre goes quiet again
  const MAX_ALPHA = { light: 0.62, dark: 0.5 };
  const TONES = {
    light: ['#7F7A52', '#B39433'],   // muted olive, faded pollen
    dark:  ['#D2CBB3', '#A3AE90'],   // pale cream, sage
  };

  /* ── Layer ──────────────────────────────────────────── */
  const canvas = document.createElement('canvas');
  canvas.setAttribute('aria-hidden', 'true');
  canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;z-index:1;pointer-events:none;';
  const curtain = document.getElementById('curtain');
  curtain ? curtain.after(canvas) : stage.prepend(canvas);   // above the backdrop, below everything else
  const ctx = canvas.getContext('2d');

  let W = 0, H = 0, dpr = 1, cols = 0, rows = 0, N = 0;
  let bx, by, dx, dy, vx, vy, en, ang, len, tone, isActive;
  let active = [];

  function build() {
    W = stage.clientWidth; H = stage.clientHeight;
    dpr = Math.min(devicePixelRatio || 1, 1.5);
    canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
    cols = Math.ceil(W / CELL); rows = Math.ceil(H / CELL); N = cols * rows;
    bx = new Float32Array(N); by = new Float32Array(N);
    dx = new Float32Array(N); dy = new Float32Array(N);
    vx = new Float32Array(N); vy = new Float32Array(N);
    en = new Float32Array(N); ang = new Float32Array(N); len = new Float32Array(N);
    tone = new Uint8Array(N); isActive = new Uint8Array(N);
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      const i = r * cols + c;
      bx[i] = (c + Math.random()) * CELL;
      by[i] = (r + Math.random()) * CELL;
      ang[i] = Math.random() * Math.PI;
      len[i] = Math.random() < 0.75 ? 2.5 + Math.random() * 4 : 0;   // fibres, and a few specks
      tone[i] = Math.random() < 0.72 ? 0 : 1;
    }
    active = [];
    ctx.clearRect(0, 0, canvas.width, canvas.height);
  }

  /* ── The film's mood: how much atmosphere each chapter allows ── */
  const MOOD = [            // [film time, intensity]
    [0, 0.7], [1.2, 0.7],   // hero: most restrained
    [1.6, 0.8], [2.6, 0.8], // first light
    [3.3, 1], [4.5, 1],     // the dark atelier
    [5.0, 0.45], [8.3, 0.45], // the vessel: stay out of the way
    [9.2, 0.9], [11, 0.9],  // the room: the world is richer now
  ];
  const film = () => window.aurelle && window.aurelle.tl;
  function mood() {
    const tl = film();
    if (!tl) return 0.6;
    const t = tl.time();
    for (let k = 1; k < MOOD.length; k++) {
      if (t <= MOOD[k][0]) {
        const [t0, a] = MOOD[k - 1], [t1, b] = MOOD[k];
        const p = Math.min(1, Math.max(0, (t - t0) / (t1 - t0)));
        return a + (b - a) * (p * p * (3 - 2 * p));
      }
    }
    return MOOD[MOOD.length - 1][1];
  }
  // The green curtain rises from below; above its edge the stage is still cream.
  function darkEdge() {
    if (!curtain || !window.gsap) return H;
    if (getComputedStyle(curtain).visibility === 'hidden') return H;
    return H * (gsap.getProperty(curtain, 'yPercent') / 100);
  }

  /* ── The flower's neighbourhood (read rarely, never per particle) ── */
  const flowerEl = document.getElementById('flower');
  let flowerBox = null, flowerReadAt = 0;
  function nearFlower(x, y, now) {
    if (!flowerEl) return 0;
    if (now - flowerReadAt > 250) {
      const r = flowerEl.getBoundingClientRect(), s = stage.getBoundingClientRect();
      flowerBox = { l: r.left - s.left, t: r.top - s.top, r: r.right - s.left, b: r.bottom - s.top };
      flowerReadAt = now;
    }
    const b = flowerBox;
    const ox = Math.max(b.l - x, 0, x - b.r), oy = Math.max(b.t - y, 0, y - b.b);
    return Math.max(0, 1 - Math.hypot(ox, oy) / 160);
  }

  /* ── Pointer, with a little inertia ───────────────── */
  let mx = 0, my = 0, px = 0, py = 0, inside = false, primed = false, stageTop = 0;
  const readTop = () => { stageTop = stage.getBoundingClientRect().top; };
  addEventListener('scroll', readTop, { passive: true });
  const move = (x, y) => {
    mx = x; my = y - stageTop;
    if (!primed) { px = mx; py = my; primed = true; }
    inside = true;
    wake();
  };
  // Mouse, trackpad and pen. Touch is handled below, since a scrolling finger cancels pointer events.
  addEventListener('pointermove', e => { if (e.pointerType !== 'touch') move(e.clientX, e.clientY); }, { passive: true });
  addEventListener('touchmove', e => { const t = e.touches[0]; if (t) move(t.clientX, t.clientY); }, { passive: true });
  addEventListener('touchend', () => { inside = false; primed = false; }, { passive: true });
  document.documentElement.addEventListener('mouseleave', () => { inside = false; primed = false; });
  addEventListener('blur', () => { inside = false; primed = false; });

  function disturb(x, y, mvx, mvy, speed, now) {
    const strength = Math.min(1, 0.35 + speed / 30);
    const boost = 1 + 0.6 * nearFlower(x, y, now);
    const c0 = Math.max(0, Math.floor((x - RADIUS) / CELL)), c1 = Math.min(cols - 1, Math.floor((x + RADIUS) / CELL));
    const r0 = Math.max(0, Math.floor((y - RADIUS) / CELL)), r1 = Math.min(rows - 1, Math.floor((y + RADIUS) / CELL));
    const ux = mvx / (speed || 1), uy = mvy / (speed || 1);
    for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) {
      const i = r * cols + c;
      const ex = bx[i] + dx[i] - x, ey = by[i] + dy[i] - y;
      const d = Math.hypot(ex, ey);
      if (d >= RADIUS) continue;
      const f = (1 - d / RADIUS) ** 2 * strength;
      const inv = 1 / (d || 1);
      vx[i] += (ex * inv * 1.1 + ux * 0.7) * f;   // brushed aside, and a little along the stroke
      vy[i] += (ey * inv * 1.1 + uy * 0.7) * f;
      en[i] = Math.min(1, en[i] + f * 0.6 * boost);
      if (!isActive[i]) { isActive[i] = 1; active.push(i); }
    }
  }

  /* ── Loop: runs only while something is moving ────── */
  let running = false, lastPx = 0, lastPy = 0;
  function wake() { if (!running) { running = true; lastPx = px; lastPy = py; requestAnimationFrame(frame); } }

  function frame(now) {
    px += (mx - px) * 0.2; py += (my - py) * 0.2;
    const mvx = px - lastPx, mvy = py - lastPy, speed = Math.hypot(mvx, mvy);
    lastPx = px; lastPy = py;
    if (inside && speed > 0.6) disturb(px, py, mvx, mvy, speed, now);

    const k = mood(), edge = darkEdge();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    ctx.lineCap = 'round';
    ctx.lineWidth = 1.1;

    const next = [];
    for (let n = 0; n < active.length; n++) {
      const i = active[n];
      vx[i] = (vx[i] - dx[i] * RETURN) * DAMP;
      vy[i] = (vy[i] - dy[i] * RETURN) * DAMP;
      dx[i] += vx[i]; dy[i] += vy[i];
      en[i] *= FADE;
      if (en[i] < 0.004 && Math.abs(dx[i]) + Math.abs(dy[i]) < 0.1) {
        dx[i] = dy[i] = vx[i] = vy[i] = en[i] = 0; isActive[i] = 0;
        continue;
      }
      next.push(i);
      const x = bx[i] + dx[i], y = by[i] + dy[i];
      const theme = y > edge ? 'dark' : 'light';
      const a = Math.min(1, en[i] * MAX_ALPHA[theme] * k * STRENGTH);
      if (a < 0.004) continue;
      ctx.globalAlpha = a;
      const col = TONES[theme][tone[i]];
      if (len[i]) {
        const t = ang[i] + vx[i] * 0.04, hx = Math.cos(t) * len[i] * 0.5, hy = Math.sin(t) * len[i] * 0.5;
        ctx.strokeStyle = col;
        ctx.beginPath(); ctx.moveTo(x - hx, y - hy); ctx.lineTo(x + hx, y + hy); ctx.stroke();
      } else {
        ctx.fillStyle = col;
        ctx.fillRect(x - 0.8, y - 0.8, 1.6, 1.6);
      }
    }
    active = next;
    ctx.globalAlpha = 1;

    const settling = Math.abs(mx - px) + Math.abs(my - py) > 0.3;
    if (active.length || (inside && settling)) requestAnimationFrame(frame);
    else running = false;
  }

  let rz;
  addEventListener('resize', () => { clearTimeout(rz); rz = setTimeout(() => { build(); readTop(); }, 150); });
  build(); readTop();
})();
