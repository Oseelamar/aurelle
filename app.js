/* Aurelle — one flower, one scroll, one continuous film.
 *
 * Two layers of motion share a single scrubbed timeline:
 *  1. GSAP tweens the narrators: typography, the curtain, the ground line.
 *  2. A small "director" places the physical objects (flower, vase, camera,
 *     sibling arrangements) from live layout points every time the playhead
 *     moves, so the choreography recomposes itself on any viewport.
 *
 * The flower is positioned by its stem base, the way a hand would hold it.
 */
(() => {
  gsap.registerPlugin(ScrollTrigger);

  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const seg = (t, a, b) => clamp((t - a) / (b - a));
  const E = {
    lin: t => t,
    i2: t => t * t,
    o2: t => 1 - (1 - t) * (1 - t),
    o3: t => 1 - Math.pow(1 - t, 3),
    io2: t => (t < .5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2),
    io3: t => (t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
    ioS: t => -(Math.cos(Math.PI * t) - 1) / 2,
  };

  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const isTouch = matchMedia('(hover: none)').matches;

  // Freesia geometry, measured from the cut-out (fractions of the image box).
  const ASPECT = 1300 / 3940;
  const AX = 0.2215, AY = 0.9962;          // stem base
  const LEAN = 8.3;                         // lower stem leans left at rotation 0
  const BLOOM = [0.846, 0.036];             // the top flower, for the hero tag
  const STEM_HIDDEN = 0.26;                 // share of stem that sits below the waterline

  const stage = $('#stage');
  const world = $('#world');
  const flower = $('#flower');
  const vaseBack = $('#vaseBack');
  const vaseFront = $('#vaseFront');
  const sibsEl = $('#sibs');
  const tag = $('#tag');
  const captionsEl = $('#captions');
  const ground = $('#ground');

  /* ── Vessels, drawn from a profile ─────────────────── */
  const PROFILES = {
    bud:   [[0, 8.2], [2.5, 7.5], [9, 6.5], [18, 7.4], [32, 13], [50, 21.5], [64, 24], [78, 22.4], [91, 16.6], [97, 14.6], [100, 14.9]],
    bottle:[[0, 5.2], [3, 4.7], [20, 4.4], [32, 6.8], [42, 15.5], [54, 18.6], [90, 18.8], [97, 17.8], [100, 18.2]],
    bowl:  [[0, 15], [5, 14], [22, 24], [50, 36], [74, 33], [94, 22], [100, 21]],
    cyl:   [[0, 12], [4, 11], [40, 12.2], [84, 13.4], [97, 12.4], [100, 12.7]],
    amph:  [[0, 11.5], [4, 10.2], [14, 9.2], [34, 17], [58, 22], [80, 18.5], [95, 11], [100, 11.4]],
    slim:  [[0, 7.2], [3, 6.4], [30, 6], [68, 9], [91, 10.4], [98, 9.6], [100, 9.9]],
    round: [[0, 9.4], [4, 8.6], [12, 8.2], [30, 20], [55, 27], [80, 22.5], [96, 13], [100, 13.6]],
  };

  const hex = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
  const shade = (h, amt) => {
    const c = hex(h), to = amt > 0 ? [255, 249, 236] : [11, 13, 9], a = Math.abs(amt);
    return `rgb(${c.map((v, i) => Math.round(v + (to[i] - v) * a)).join(',')})`;
  };
  const catmull = pts => {
    let d = '';
    for (let i = 0; i < pts.length - 1; i++) {
      const p0 = pts[i - 1] || pts[i], p1 = pts[i], p2 = pts[i + 1], p3 = pts[i + 2] || p2;
      const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
      const c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
      d += `C${c1[0].toFixed(2)},${c1[1].toFixed(2)} ${c2[0].toFixed(2)},${c2[1].toFixed(2)} ${p2[0]},${p2[1]} `;
    }
    return d;
  };
  let uid = 0;
  function makeVase(profileName, color) {
    const prof = PROFILES[profileName];
    const R = Math.max(...prof.map(p => p[1]));
    const r0 = prof[0][1], rN = prof[prof.length - 1][1];
    const ry0 = r0 * 0.32, ri = r0 * 0.78, ryi = ry0 * 0.74, ryB = rN * 0.2;
    const x0 = -(R * 1.35 + 3), y0 = -(ry0 + 3), y1 = 100 + R * 0.3 + 3;
    const vb = `${x0} ${y0} ${-2 * x0} ${y1 - y0}`;
    const right = prof.map(([y, r]) => [r, y]);
    const left = right.map(([x, y]) => [-x, y]).reverse();
    const id = `v${uid++}`;
    const body = `M${r0},0 ${catmull(right)}A${rN},${ryB} 0 0 1 ${-rN},100 ${catmull(left)}L${-ri},0 A${ri},${ryi} 0 0 0 ${ri},0 Z`;
    const lip = `M${-r0},0 A${r0},${ry0} 0 0 0 ${r0},0 L${ri},0 A${ri},${ryi} 0 0 1 ${-ri},0 Z`;
    const back = `<svg viewBox="${vb}" preserveAspectRatio="none">
      <defs><radialGradient id="${id}s"><stop offset="0" stop-color="#000" stop-opacity=".42"/><stop offset="1" stop-color="#000" stop-opacity="0"/></radialGradient></defs>
      <ellipse cx="0" cy="100" rx="${R * 1.3}" ry="${R * 0.24}" fill="url(#${id}s)"/>
      <ellipse cx="0" cy="0" rx="${r0}" ry="${ry0}" fill="${shade(color, -0.08)}"/>
      <ellipse cx="0" cy="${ryi * 0.1}" rx="${ri}" ry="${ryi}" fill="${shade(color, -0.78)}"/>
    </svg>`;
    const front = `<svg viewBox="${vb}" preserveAspectRatio="none">
      <defs>
        <linearGradient id="${id}g" x1="0" x2="1" y1="0" y2="0">
          <stop offset="0" stop-color="${shade(color, -0.42)}"/><stop offset=".17" stop-color="${shade(color, -0.14)}"/>
          <stop offset=".36" stop-color="${shade(color, 0.1)}"/><stop offset=".52" stop-color="${color}"/>
          <stop offset=".8" stop-color="${shade(color, -0.26)}"/><stop offset="1" stop-color="${shade(color, -0.5)}"/>
        </linearGradient>
        <linearGradient id="${id}v" x1="0" x2="0" y1="0" y2="1">
          <stop offset=".55" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".2"/>
        </linearGradient>
      </defs>
      <path d="${body}" fill="url(#${id}g)"/>
      <path d="${body}" fill="url(#${id}v)"/>
      <path d="${lip}" fill="${shade(color, 0.16)}"/>
    </svg>`;
    return { back, front, x0, y0, y1, r0 };
  }
  // Place an svg so the vessel's foot centre sits at the parent's origin.
  function fitVase(svg, v, height) {
    const k = height / 100;
    Object.assign(svg.style, {
      left: `${v.x0 * k}px`, top: `${(v.y0 - 100) * k}px`,
      width: `${-2 * v.x0 * k}px`, height: `${(v.y1 - v.y0) * k}px`,
    });
  }

  const MAIN = makeVase('bud', '#E6DDC9');
  vaseBack.innerHTML = MAIN.back;
  vaseFront.innerHTML = MAIN.front;

  /* ── The installation around her ───────────────────── */
  const SIBS = [
    { side: -1, rank: 1, vase: 'bottle', color: '#2C2D27', vh: .31, label: 'Apricot', stems: [{ img: 'apricot', h: 1.5, lean: -3 }] },
    { side: 1,  rank: 1, vase: 'amph',   color: '#C29A45', vh: .26, label: 'Blush', stems: [{ img: 'blush', h: 2.0, lean: -2, flip: true }, { img: 'blush', h: 1.9, lean: 9 }] },
    { side: -1, rank: 2, vase: 'bowl',   color: '#8D9B7D', vh: .18, label: 'Lemon & Ivory', stems: [{ img: 'lemon', h: 2.6, lean: -20, flip: true }, { img: 'ivory', h: 3.0, lean: -2, flip: true }, { img: 'lemon', h: 2.4, lean: 17 }] },
    { side: 1,  rank: 2, vase: 'slim',   color: '#E9E2D3', vh: .35, label: 'Lemon', stems: [{ img: 'lemon', h: 1.35, lean: 4 }] },
    { side: -1, rank: 3, vase: 'cyl',    color: '#DCD3BF', vh: .28, label: 'Ivory', stems: [{ img: 'ivory', h: 1.85, lean: -7, flip: true }] },
    { side: 1,  rank: 3, vase: 'round',  color: '#55643F', vh: .23, label: 'Apricot & Ivory', stems: [{ img: 'apricot', h: 2.2, lean: -11, flip: true }, { img: 'ivory', h: 2.4, lean: 8 }] },
  ];
  const sibNodes = SIBS.map(s => {
    const v = makeVase(s.vase, s.color);
    const el = document.createElement('div');
    el.className = 'sib';
    el.style.zIndex = 4 - s.rank;
    el.dataset.rank = s.rank;
    el.innerHTML = v.back + s.stems.map(st =>
      `<div class="stem"><img src="assets/freesia${st.img ? '-' + st.img : '-sm'}.webp" alt="" decoding="async" fetchpriority="low"></div>`
    ).join('') + v.front;
    sibsEl.appendChild(el);
    const cap = document.createElement('span');
    cap.innerHTML = `<b>●</b>${s.label}`;
    captionsEl.appendChild(cap);
    return { ...s, el, v, cap, svgs: $$('svg', el), stemEls: $$('.stem', el) };
  });
  // She has a name too.
  const centreCap = document.createElement('span');
  centreCap.innerHTML = '<b>●</b>Aurea';
  captionsEl.appendChild(centreCap);

  // Mobile: the room becomes a row you swipe through, one vessel at a time.
  const REEL = [
    ...sibNodes.filter(s => s.side < 0).sort((a, b) => b.rank - a.rank).map(s => ({ label: s.label, slot: -s.rank })),
    { label: 'Aurea', slot: 0 },
    ...sibNodes.filter(s => s.side > 0).sort((a, b) => a.rank - b.rank).map(s => ({ label: s.label, slot: s.rank })),
  ];
  const reel = document.createElement('div');
  reel.className = 'reel';
  reel.innerHTML = `<span class="reel-name" aria-live="polite">Aurea</span><span class="reel-dots">${REEL.map(() => '<i></i>').join('')}</span>`;
  stage.appendChild(reel);
  const reelName = $('.reel-name', reel), reelDots = $$('.reel-dots i', reel);

  /* ── Layout: every spatial decision lives here ─────── */
  let L = {};
  function layout() {
    const w = stage.clientWidth, h = stage.clientHeight;
    const mobile = w < 768;
    const FH = mobile ? Math.min(h * 0.7, w * 1.6) : Math.min(h * 0.9, w * 0.62);
    const FW = FH * ASPECT;
    Object.assign(flower.style, {
      width: `${FW}px`, height: `${FH}px`,
      marginLeft: `${-AX * FW}px`, marginTop: `${-AY * FH}px`,
      transformOrigin: `${AX * 100}% ${AY * 100}%`,
    });

    const vx = w / 2, vy = h * 0.9;
    const VH = mobile ? Math.min(h * 0.25, w * 0.5) : h * 0.34;
    const vs = mobile ? 0.6 : 0.64;                         // flower scale once in the vase
    const mouthY = vy - VH;
    const depth = FH * vs * STEM_HIDDEN;
    // Bloom mass sits right of the stem; nudge the base left to centre the silhouette.
    const centreX = w / 2 - 0.33 * FW;

    const P = mobile ? {
      hero:   { x: centreX, y: h * 1.0,  s: 1,    r: 0 },
      s1:     { x: w * 0.5, y: h * 1.04, s: .84, r: -5 },
      s2:     { x: w * 0.1, y: h * 1.04, s: .84, r: 8 },
    } : {
      hero:   { x: centreX, y: h * 1.02, s: 1,    r: 0 },
      s1:     { x: w * 0.64, y: h * 1.0,  s: .86, r: -6 },
      s2:     { x: w * 0.15, y: h * 1.0,  s: .84, r: 7 },
    };
    // The vessel waits a little low; she hovers above its mouth, then they meet.
    const lowOff = h * (mobile ? 0.12 : 0.17);
    const tip = (mouthY + lowOff) - h * 0.07;
    P.hover  = { x: vx, y: tip,             s: vs, r: 5 };
    P.hover2 = { x: vx, y: tip - h * 0.012, s: vs, r: 6.5 };
    P.placed = { x: vx, y: mouthY + depth,  s: vs, r: 6.5 };

    const cam = mobile ? 0.68 : 0.72;
    L = { w, h, mobile, FH, FW, vx, vy, VH, P, cam, lowOff };

    // Vessel
    vaseBack.style.left = vaseFront.style.left = `${vx}px`;
    vaseBack.style.top = vaseFront.style.top = `${vy}px`;
    fitVase(vaseBack.firstElementChild, MAIN, VH);
    fitVase(vaseFront.firstElementChild, MAIN, VH);
    world.style.transformOrigin = `${vx}px ${vy}px`;
    ground.style.top = `${vy}px`;

    // Siblings: offsets are what you see after the camera pulls back.
    const offs = mobile ? [0, .52, 1.04, 1.56] : [0, .135, .25, .355];
    L.slot = mobile ? .52 * w : 0;
    sibNodes.forEach(s => {
      const hidden = false;
      s.el.style.display = hidden ? 'none' : '';
      s.cap.style.display = hidden ? 'none' : '';
      s.hidden = hidden;
      if (hidden) return;
      const depthScale = [1, 1, .93, .86][s.rank];
      const sVH = h * s.vh * depthScale * (mobile ? .82 : 1);
      s.fx = s.side * offs[s.rank] * w / cam;
      s.el.style.left = `${vx + s.fx}px`;
      s.el.style.top = `${vy}px`;
      s.svgs.forEach(svg => fitVase(svg, s.v, sVH));
      s.stems.forEach((st, j) => {
        const el = s.stemEls[j];
        const sh = sVH * st.h, sw = sh * ASPECT;
        const d = Math.min(sh * STEM_HIDDEN, sVH * 0.8);
        const rot = st.flip ? st.lean - LEAN : st.lean + LEAN;
        Object.assign(el.style, {
          width: `${sw}px`, height: `${sh}px`,
          marginLeft: `${-AX * sw}px`, marginTop: `${-AY * sh}px`,
          transformOrigin: `${AX * 100}% ${AY * 100}%`,
          transform: `translate(0px, ${-sVH + d}px) rotate(${rot}deg) scaleX(${st.flip ? -1 : 1})`,
        });
      });
      s.cap.style.left = `${vx + s.side * offs[s.rank] * w}px`;
      s.cap.style.top = `${vy + 18}px`;
    });
    centreCap.style.left = `${vx}px`;
    centreCap.style.top = `${vy + 18}px`;
    if (!mobile) { reelState.pan = 0; setReel(0, false); }

    // The specimen tag points at the top bloom in the opening frame.
    const hp = P.hero;
    tag.style.left = `${hp.x + (BLOOM[0] - AX) * FW + 18}px`;
    tag.style.top = `${hp.y + (BLOOM[1] - AY) * FH + FH * 0.05}px`;
  }

  /* ── The flower's path ─────────────────────────────── */
  // Each key is where she is at time t. Segments carry the character of the move:
  // lift = arc height (share of viewport), sway = inertia lean while carried.
  const PATH = [
    { t: 0,    k: 'hero' },
    { t: 0.7,  k: 'hero' },
    { t: 1.85, k: 's1', lift: .05, sway: -6 },
    { t: 2.6,  k: 's1' },
    { t: 3.8,  k: 's2', lift: .06, sway: 8 },
    { t: 4.55, k: 's2' },
    { t: 5.5,  k: 'hover', sway: -7, ey: E.o3 },
    { t: 5.85, k: 'hover2', ey: E.ioS, ex: E.ioS },
    { t: 6.3,  k: 'placed', ey: E.i2, ex: E.ioS },
    { t: 7.3,  k: 'placed', settle: true },
  ];

  function flowerAt(t) {
    const P = L.P;
    if (t <= PATH[0].t) return P[PATH[0].k];
    for (let i = 1; i < PATH.length; i++) {
      const a = PATH[i - 1], b = PATH[i];
      if (t > b.t && i < PATH.length - 1) continue;
      const p = seg(t, a.t, b.t);
      const A = P[a.k], B = P[b.k];
      const ex = (b.ex || E.io3)(p), ey = (b.ey || E.ioS)(p), eo = E.io2(p);
      let x = lerp(A.x, B.x, ex);
      let y = lerp(A.y, B.y, ey) - (b.lift || 0) * L.h * Math.sin(Math.PI * p);
      let s = lerp(A.s, B.s, eo);
      let r = lerp(A.r, B.r, eo) + (b.sway || 0) * Math.sin(Math.PI * E.o2(p));
      if (b.settle) {
        // Lands, dips into the water, sways and comes to rest.
        const damp = Math.exp(-4.5 * p);
        r += 3.6 * damp * Math.sin(p * Math.PI * 4);
        y += L.h * 0.007 * damp * Math.sin(p * Math.PI * 3);
      }
      return { x, y, s, r };
    }
    return P[PATH[PATH.length - 1].k];
  }

  /* ── Director: place every physical object at time t ─ */
  function direct(t) {
    if (!L.w) return;
    const f = flowerAt(t);
    flower.style.transform = `translate3d(${f.x}px,${f.y}px,0) rotate(${f.r}deg) scale(${f.s})`;

    // The vessel rises into the frame, then answers the flower's weight.
    // Rises to a waiting height, holds, then lifts the last stretch to receive her.
    const rise = E.o3(seg(t, 4.6, 5.55));
    const meet = E.ioS(seg(t, 5.85, 6.32));
    const vy = lerp(L.h * 0.8, L.lowOff, rise) * (1 - meet);
    let vr = (1 - rise) * -4;
    const wq = seg(t, 6.3, 7.2);
    if (wq > 0) vr += 1.5 * Math.exp(-4 * wq) * Math.sin(wq * Math.PI * 3);
    const vT = `translate3d(0,${vy}px,0) rotate(${vr}deg)`;
    vaseBack.style.transform = vaseFront.style.transform = vT;
    vaseBack.style.visibility = vaseFront.style.visibility = rise > 0 ? 'visible' : 'hidden';

    // Camera: lean in to read her name, step back to see the room.
    let cam = 1;
    cam = lerp(cam, 1.03, E.ioS(seg(t, 6.5, 7.4)));
    cam = lerp(cam, L.cam, E.io3(seg(t, 8.5, 9.9)));
    // On mobile, once the room is assembled, the row can be swiped.
    const g = L.mobile ? E.ioS(seg(t, 9.7, 10.15)) : 0;
    if (g === 0 && reelState.pan !== 0 && !drag) { panTween && panTween.kill(); reelState.pan = 0; setReel(0, false); }
    L.reelLive = g > 0.9;
    reel.style.opacity = g;
    world.style.transform = `translate3d(${reelState.pan * g}px,0,0) scale(${cam})`;

    // The room unfolds from behind her: inner pair first, outer pair last.
    sibNodes.forEach(s => {
      if (s.hidden) return;
      const start = 8.7 + (s.rank - 1) * 0.28;
      const p = seg(t, start, start + 1.15);
      if (p <= 0) { s.el.style.visibility = 'hidden'; return; }
      const e = E.o3(p);
      s.el.style.visibility = 'visible';
      s.el.style.opacity = clamp(p * 2.6);
      const dx = lerp(-s.fx * 0.94, 0, e);
      const dy = (1 - e) * L.h * 0.03;
      s.el.style.transform = `translate3d(${dx}px,${dy}px,0) rotate(${s.side * -5 * (1 - e)}deg) scale(${lerp(.82, 1, e)})`;
    });
  }

  /* ── Typography: split into masked words ───────────── */
  function split(el) {
    const walk = node => {
      [...node.childNodes].forEach(n => {
        if (n.nodeType === 3) {
          const frag = document.createDocumentFragment();
          n.textContent.split(/(\s+)/).forEach(part => {
            if (!part) return;
            if (/^\s+$/.test(part)) { frag.appendChild(document.createTextNode(' ')); return; }
            const m = document.createElement('span'); m.className = 'm';
            const w = document.createElement('span'); w.className = 'w'; w.textContent = part;
            m.appendChild(w); frag.appendChild(m);
          });
          n.replaceWith(frag);
        } else if (n.nodeType === 1) walk(n);
      });
    };
    walk(el);
  }
  $$('[data-split]').forEach(split);

  /* ── The film ──────────────────────────────────────── */
  const DUR = 11;
  document.documentElement.style.setProperty('--units', DUR);
  const tl = gsap.timeline({ defaults: { ease: 'none' }, paused: true });
  const words = sel => $$(`${sel} .w`);
  const reveal = (sel, at, dur = .6, stagger = .05) =>
    tl.fromTo(words(sel), { yPercent: 112 }, { yPercent: 0, duration: dur, stagger, ease: 'power3.out' }, at);
  const fadeIn = (targets, at, dur = .35, y = 16) =>
    tl.fromTo(targets, { autoAlpha: 0, y }, { autoAlpha: 1, y: 0, duration: dur, ease: 'power2.out' }, at);
  const fadeOut = (targets, at, dur = .4, y = -40) =>
    tl.to(targets, { autoAlpha: 0, y, duration: dur, ease: 'power1.in' }, at);

  // 01 → stillness, then the headline yields. The front line moves faster: depth.
  tl.to('.hl1', { yPercent: -55, autoAlpha: 0, duration: .7, ease: 'power1.in' }, .64)
    .to('.hl2', { yPercent: -120, autoAlpha: 0, duration: .64, ease: 'power1.in' }, .6)
    .to('.hero-meta', { autoAlpha: 0, y: 20, duration: .3 }, .6)
    .to(tag, { autoAlpha: 0, x: 24, duration: .3 }, .6);

  // 02 · First light (text left, she moves right)
  fadeIn('#s1 .label', 1.36);
  reveal('#s1 .display', 1.34, .6, .06);
  fadeIn('#s1 .body', 1.68);
  fadeOut('#s1', 2.6, .45);

  // Night falls on the atelier while she crosses.
  tl.fromTo('#curtain', { yPercent: 100, visibility: 'visible' }, { yPercent: 0, duration: 1, ease: 'power2.inOut' }, 2.6)
    .to(document.documentElement, { '--nav-ink': '#ECE4D2', duration: .12 }, 3.46);

  // 03 · The hand (text right, she moves left)
  fadeIn('#s2 .label', 3.3);
  reveal('#s2 .display', 3.22, .65, .06);
  fadeIn('#s2 .body', 3.62);
  fadeOut('#s2', 4.5, .4);

  // 04 · The vessel
  fadeIn('#vesselLabel', 4.95, .4);
  fadeOut('#vesselLabel', 6.5, .3, -16);
  tl.fromTo('#giant', { autoAlpha: 0, scale: 1.05 }, { autoAlpha: 1, scale: 1, duration: .8, ease: 'power2.out' }, 6.35);

  fadeIn('#infoName .label', 6.95);
  reveal('#infoName .name', 6.95, .6, .08);
  fadeIn(['#infoName .latin', '#infoName .body'], 7.2);
  tl.fromTo($$('#specs div'), { autoAlpha: 0, y: 14 }, { autoAlpha: 1, y: 0, duration: .35, stagger: .07, ease: 'power2.out' }, 7.05);
  fadeIn('#philo', 7.4, .4);
  fadeOut(['#infoName', '#specs', '#philo'], 8.35, .4, -24);
  tl.to('#giant', { autoAlpha: 0, duration: .5 }, 8.4);

  // 05 · The room
  tl.fromTo(ground, { scaleX: 0 }, { scaleX: 1, duration: 1, ease: 'power2.inOut' }, 8.95);
  reveal('#s5title', 9.6, .6, .07);
  fadeIn('#s5side', 9.85);
  tl.fromTo($$('#captions span'), { autoAlpha: 0, y: 8 }, { autoAlpha: .7, y: 0, duration: .3, stagger: .04 }, 9.9);
  tl.set({}, {}, DUR);

  /* ── Mobile reel: swipe with solid detents ─────────── */
  const reelState = { pan: 0 };
  let reelIndex = 0, drag = null, panTween = null;
  function setReel(k, feel = true) {
    k = clamp(k, -3, 3);
    if (k === reelIndex) return;
    reelIndex = k;
    const item = REEL.find(r => r.slot === k);
    reelName.textContent = item.label;
    gsap.fromTo(reelName, { autoAlpha: .2, y: 4 }, { autoAlpha: 1, y: 0, duration: .35, ease: 'power2.out', overwrite: true });
    reelDots.forEach((d, i) => d.classList.toggle('on', REEL[i].slot === k));
    if (feel && navigator.vibrate) navigator.vibrate(6);
  }
  reelDots[3].classList.add('on');
  function snapReel(k) {
    k = clamp(k, -3, 3);
    setReel(k);
    panTween && panTween.kill();
    panTween = gsap.to(reelState, { pan: -k * L.slot, duration: .7, ease: 'power3.out', onUpdate: () => direct(tl.time()) });
  }
  stage.addEventListener('pointerdown', e => {
    if (!L.mobile || !L.reelLive) return;
    drag = { start: reelIndex, id: e.pointerId, x: e.clientX, y: e.clientY, pan0: reelState.pan, axis: null, lx: e.clientX, lt: e.timeStamp, v: 0 };
  });
  stage.addEventListener('pointermove', e => {
    if (!drag || e.pointerId !== drag.id) return;
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    if (!drag.axis) {
      if (Math.hypot(dx, dy) < 8) return;
      drag.axis = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y';
      if (drag.axis === 'x') { panTween && panTween.kill(); drag.pan0 = reelState.pan - dx; stage.setPointerCapture(e.pointerId); }
    }
    if (drag.axis !== 'x') return;
    const lim = 3 * L.slot;
    let p = drag.pan0 + dx;
    if (p > lim) p = lim + (p - lim) * 0.25;            // soft resistance past the ends
    if (p < -lim) p = -lim + (p + lim) * 0.25;
    reelState.pan = p;
    const dt = e.timeStamp - drag.lt;
    if (dt > 0) drag.v = drag.v * 0.4 + ((e.clientX - drag.lx) / dt) * 0.6;
    drag.lx = e.clientX; drag.lt = e.timeStamp;
    setReel(Math.round(-p / L.slot));
    direct(tl.time());
  });
  const endDrag = () => {
    if (!drag) return;
    if (drag.axis === 'x') {
      // One vessel per swipe, unless the finger itself travelled further.
      const passed = Math.round(-reelState.pan / L.slot);
      let k = Math.round(-(reelState.pan + drag.v * 160) / L.slot);
      const reach = Math.max(1, Math.abs(passed - drag.start));
      k = clamp(k, drag.start - reach, drag.start + reach);
      snapReel(k);
    }
    drag = null;
  };
  stage.addEventListener('pointerup', endDrag);
  stage.addEventListener('pointercancel', endDrag);

  /* ── Chapters ──────────────────────────────────────── */
  const CHAPTERS = [0, 1.25, 3.2, 4.85, 8.6];
  const railItems = $$('.rail li');
  const chapterNum = $('[data-chapter-num]');
  let chapter = 0;
  function setChapter(t) {
    let c = 0;
    CHAPTERS.forEach((ct, i) => { if (t >= ct) c = i; });
    if (c === chapter) return;
    chapter = c;
    railItems.forEach((li, i) => li.classList.toggle('is-active', i === c));
    chapterNum.textContent = `0${c + 1}`;
  }

  const rail = $('.rail');
  tl.eventCallback('onUpdate', () => {
    const t = tl.time();
    direct(t);
    setChapter(t);
    rail.classList.toggle('is-tucked', t > 9.1);   // make room for the installation
  });

  /* ── Scroll ────────────────────────────────────────── */
  let lenis = null;
  if (!reduceMotion && typeof Lenis !== 'undefined') {
    lenis = new Lenis({ lerp: 0.085, smoothWheel: true });
    lenis.on('scroll', ScrollTrigger.update);
    gsap.ticker.add(time => lenis.raf(time * 1000));
    gsap.ticker.lagSmoothing(0);
  }
  ScrollTrigger.config({ ignoreMobileResize: true });

  layout();
  ScrollTrigger.create({
    trigger: '#film', start: 'top top', end: 'bottom bottom',
    animation: tl, scrub: lenis && !isTouch ? true : 0.5,
  });
  ScrollTrigger.create({
    trigger: '.closing', start: 'top 70%',
    onToggle: self => $('.rail').classList.toggle('is-hidden', self.isActive),
  });
  direct(tl.time());
  window.aurelle = { tl, lenis, seek: t => { const st = $('#film'); const y = st.offsetTop + (t / DUR) * (st.offsetHeight - innerHeight); lenis ? lenis.scrollTo(y, { immediate: true }) : scrollTo(0, y); } };

  let rz;
  addEventListener('resize', () => {
    cancelAnimationFrame(rz);
    rz = requestAnimationFrame(() => { layout(); direct(tl.time()); });
  });

  /* ── Opening: let her arrive, then hold still ──────── */
  const img = $('#flowerImg');
  const ready = Promise.all([
    img.decode ? img.decode().catch(() => {}) : Promise.resolve(),
    document.fonts ? document.fonts.ready : Promise.resolve(),
  ]);
  const debugT = parseFloat(new URLSearchParams(location.search).get('t'));
  ready.then(() => {
    // Decode the installation's stems now, so they never pop in mid-scroll.
    setTimeout(() => $$('.stem img').forEach(i => i.decode && i.decode().catch(() => {})), 1200);
    if (!isNaN(debugT)) {
      gsap.set('.flower-inner', { autoAlpha: 1 });
      gsap.set('.hl .w', { y: 0, yPercent: 0 });
      ScrollTrigger.getAll().forEach(st => st.kill());
      if (lenis) lenis.stop();
      tl.time(debugT);
      direct(debugT);
      return;
    }
    if (reduceMotion) return;
    gsap.timeline({ defaults: { ease: 'power4.out' } })
      .fromTo('.flower-inner', { autoAlpha: 0, yPercent: 14, rotation: 3, transformOrigin: `${AX * 100}% ${AY * 100}%` },
        { autoAlpha: 1, yPercent: 0, rotation: 0, duration: 2.2, ease: 'power3.out' }, 0)
      .fromTo('.hl1 .w', { y: 0, yPercent: 112 }, { yPercent: 0, duration: 1.5 }, .35)
      .fromTo('.hl2 .w', { y: 0, yPercent: 112 }, { yPercent: 0, duration: 1.5 }, .5)
      .from(['.nav', '.hero-meta', '.rail'], { autoAlpha: 0, duration: 1.2, ease: 'power2.out' }, 1)
      .from(tag, { autoAlpha: 0, x: -12, duration: 1, ease: 'power2.out' }, 1.4);
  });
})();
