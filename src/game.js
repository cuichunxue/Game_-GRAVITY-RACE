'use strict';
/*PHYS*/
// SI units: metres, seconds, g = 9.81 m/s^2. The ball's centre is tracked, not the contact point.
const G = 9.81, BALL_R = 0.12, START = [0, 3];
const BALLS = {
  solid: { name: '鉄の球', k: 0.4, mu: 0.003 },     // k = I/(m r^2); mu = rolling resistance
  hollow: { name: '中空の球', k: 2 / 3, mu: 0.003 },
  ring: { name: 'リング', k: 1, mu: 0.004 },
  ice: { name: '氷の球', k: 0, mu: 0.03 }           // slides without turning; kinetic friction
};
function buildTrack(ctrl) {
  const pts = [];
  if (ctrl.length === 2) {
    for (let i = 0; i <= 120; i++) {
      const u = i / 120;
      pts.push([ctrl[0][0] + (ctrl[1][0] - ctrl[0][0]) * u, ctrl[0][1] + (ctrl[1][1] - ctrl[0][1]) * u]);
    }
  } else {
    const m = ctrl.length, ext = (a, b) => [2 * a[0] - b[0], 2 * a[1] - b[1]];
    const P = [ext(ctrl[0], ctrl[1]), ...ctrl, ext(ctrl[m - 1], ctrl[m - 2])];
    const f = (a, b, c, d, u) => 0.5 * (2 * b + (-a + c) * u + (2 * a - 5 * b + 4 * c - d) * u * u + (-a + 3 * b - 3 * c + d) * u * u * u);
    for (let s = 1; s < P.length - 2; s++) {
      const p0 = P[s - 1], p1 = P[s], p2 = P[s + 1], p3 = P[s + 2], N = 50;
      for (let i = s === 1 ? 0 : 1; i <= N; i++) {
        const u = i / N;
        pts.push([f(p0[0], p1[0], p2[0], p3[0], u), f(p0[1], p1[1], p2[1], p3[1], u)]);
      }
    }
  }
  const s = [0];
  for (let i = 1; i < pts.length; i++) s.push(s[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  return { pts, s };
}
function trackYAt(pts, x, from) {
  let j = Math.max(0, from);
  while (j < pts.length - 2 && pts[j + 1][0] < x) j++;
  const a = pts[j], b = pts[j + 1], u = (x - a[0]) / ((b[0] - a[0]) || 1e-9);
  return [j + 1, a[1] + (b[1] - a[1]) * u];
}
function simulate(tr, ball, gate, R = BALL_R) {
  // Energy along the path of the ball's centre:
  //   d(v^2) = 2/(1+k) * (g dh - mu N ds),  N = g cos(theta) + v^2 kappa_c   (normal force per unit mass)
  // When N < 0 on a crest the ball leaves the track, flies as a projectile (spin kept), and on landing
  // keeps angular momentum about the contact point: v_after = (u + k v_spin) / (1 + k).
  const { pts, s } = tr, n = pts.length, gx = pts[n - 1][0], gy = pts[n - 1][1], k = ball.k, mu = ball.mu;
  const tx = new Float64Array(n), ty = new Float64Array(n), kc = new Float64Array(n), cx = new Float64Array(n), cy = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const a = pts[Math.max(0, i - 2)], b = pts[i], c = pts[Math.min(n - 1, i + 2)];
    const dx = c[0] - a[0], dy = c[1] - a[1], L = Math.hypot(dx, dy) || 1;
    tx[i] = dx / L; ty[i] = dy / L;
    const cross = (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]);
    const den = Math.hypot(b[0] - a[0], b[1] - a[1]) * Math.hypot(c[0] - b[0], c[1] - b[1]) * L;
    const kap = den > 1e-12 ? 2 * cross / den : 0;                       // > 0 in a valley, < 0 on a crest
    kc[i] = kap / Math.max(0.05, 1 - R * kap);                           // curvature of the centre's path
    cx[i] = b[0] - R * ty[i]; cy[i] = b[1] + R * tx[i];
  }
  const t = new Float64Array(n), v = new Float64Array(n), flights = [];
  let fail = null, failIdx = -1, last = n - 1, finishT = null, e2 = 0, i = 1;
  while (i < n) {
    const ds = Math.hypot(cx[i] - cx[i - 1], cy[i] - cy[i - 1]);
    const N = Math.max(0, G * tx[i - 1] + e2 * kc[i - 1]);
    e2 += 2 / (1 + k) * (G * (cy[i - 1] - cy[i]) - mu * N * ds);
    if (e2 <= 1e-6) { fail = 'stall'; failIdx = i; last = i - 1; break; }
    v[i] = Math.sqrt(e2);
    t[i] = t[i - 1] + ds / ((v[i - 1] + v[i]) / 2);
    if (!(i >= 2 && i < n - 8 && G * tx[i] + e2 * kc[i] < -0.05 * G)) { i++; continue; }
    const vL = v[i], vx = tx[i] * vL, vy = ty[i] * vL;
    const fl = { i0: i, t0: t[i], x0: cx[i], y0: cy[i], vx, vy, vL, t1: Infinity, finish: false, landed: false };
    flights.push(fl);
    let tau = 0, j = i, next = -1;
    while (tau < 4) {
      tau += 0.002;
      const x = cx[i] + vx * tau, y = cy[i] + vy * tau - 0.5 * G * tau * tau;
      if (x >= gx) {
        if (y >= gy - 0.3 && y <= gy + 1.2) { fl.finish = true; fl.t1 = finishT = t[i] + tau; }
        break;
      }
      const [jj, yt] = trackYAt(pts, x, j); j = jj - 1;
      if (x > cx[i] + 0.03 && y - R <= yt) {
        const u = vx * tx[jj] + (vy - G * tau) * ty[jj];
        const after = (u + k * vL) / (1 + k);
        if (after <= 0.05) break;
        fl.t1 = t[i] + tau; fl.landed = true; fl.j = jj; fl.u = after;
        for (let q = i + 1; q <= jj; q++) { t[q] = fl.t1; v[q] = after; }
        e2 = after * after; next = jj + 1;
        break;
      }
    }
    if (fl.finish) { last = i; break; }
    if (next < 0) { fail = 'fly'; failIdx = i; last = i; break; }
    i = next;
  }
  if (!fail && gate) {
    let best = Infinity, bi = 0;
    pts.forEach((p, q) => { const d = Math.hypot(p[0] - gate.x, p[1] - gate.y); if (d < best) { best = d; bi = q; } });
    if (best > gate.r) { fail = 'gate'; failIdx = bi; }
  }
  const time = fail ? Infinity : (finishT ?? t[n - 1]);
  return { ok: !fail, fail, failIdx, t, v, cx, cy, flights, last, time, jumps: flights.filter(f => f.landed || f.finish).length };
}
/*END*/

const LEVELS = [
  { id: 'p', kind: 'predict', title: 'どっちが速い？', goal: [6, 0], ball: 'solid',
    A: [[0, 3], [6, 0]], B: [[0, 3], [1.3, 0.4], [3.2, -0.75], [6, 0]] },
  { id: 'l1', title: '直線に勝て', goal: [6, 0], ball: 'solid', pins: [[3, 1.7]],
    rival: { name: '直線くん', ctrl: [[0, 3], [6, 0]], ball: 'solid' },
    hint: 'ピンを下に引いて、最初に一気に落ちる形を作ろう。距離が伸びても、早く乗ったスピードで取り返せます。' },
  { id: 'l2', title: '3本ピン', goal: [6, 0.6], ball: 'solid', pins: [[1.5, 2.4], [3, 1.8], [4.5, 1.2]],
    rival: { name: 'ライバル', ctrl: [[0, 3], [0.8, 0.1], [1.6, -0.4], [4.1, 0.1], [6, 0.6]], ball: 'solid' },
    hint: '最速の形はスタート直後がほぼ垂直で、谷を過ぎたらゆるやかに上る曲線です。' },
  { id: 'l3', title: '中空の球', goal: [6, 0], ball: 'hollow', pins: [[1.5, 1.6], [3, 0.4], [4.5, 0.1]],
    rival: { name: 'ライバル', ctrl: [[0, 3], [0.5, 0.8], [1.8, -2], [3.8, -1.8], [6, 0]], ball: 'solid' },
    hint: '同じ軌道なら中空の球は遅い。回転に取られるエネルギーが大きいからです。形で差を埋めよう。' },
  { id: 'l4', title: '必須ゲート', goal: [6, -0.4], ball: 'solid', gate: { x: 2.2, y: 2.15, r: 0.32 }, pins: [[1.2, 2.5], [2.2, 2.15], [4, 0.6]],
    rival: { name: 'ライバル', ctrl: [[0, 3], [0.5, 2.5], [2.3, 2.2], [4.3, 0.8], [6, -0.4]], ball: 'solid' },
    hint: '輪の高さまでは浅く、輪を抜けたら一気に落とす。輪の前で深く落ちすぎると、上り返しで失速します。' },
  { id: 'l5', title: '氷の球', goal: [6, 1.6], ball: 'ice', pins: [[1.5, 2.2], [3, 1.6], [4.6, 1.6]],
    rival: { name: 'ライバル', ctrl: [[0, 3], [0.5, 0.5], [2.1, -0.1], [4.2, 0.7], [6, 1.6]], ball: 'ice' },
    hint: '摩擦ゼロの氷は回転しないぶん速い。深い谷でも上り返せます。ただし山を作ると飛び出します。' },
  { id: 'd', kind: 'daily', title: 'デイリー', goal: [6, 0.9], ball: 'ring', gate: { x: 3.6, y: -0.9, r: 0.3 }, pins: [[1.6, 1.8], [3.6, -0.7], [5, -0.5]],
    rival: { name: '世界ゴースト', ctrl: [[0, 3], [2.7, 0], [3.8, -0.7], [4.9, -0.5], [6, 0.9]], ball: 'ring' },
    hint: 'リングは回転に一番エネルギーを使う形。今日は低い輪をくぐる必要があります。' }
];
const DAILY_IDX = LEVELS.findIndex(l => l.kind === 'daily');

// ---------- state ----------
const store = { get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } },
                set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} } };
const DAILY_NO = Math.floor((Date.now() - Date.UTC(2026, 5, 4)) / 864e5);
let progress = store.get('gr-progress', { unlocked: 1, best: {} });
let daily = store.get('gr-daily', null);
if (!daily || daily.no !== DAILY_NO) daily = { no: DAILY_NO, used: 0, best: null, bestTry: 0, bestPins: null };
const settings = Object.assign({ muted: true, guided: false }, store.get('gr-settings', {}));
const saveSettings = () => store.set('gr-settings', settings);

let L = 0, pins = [], mode = 'edit', race = null, camT = 0, highlight = null, picked = null, friend = null, lastShare = null;
const lv = () => LEVELS[L];
const PLAY_RATE = 0.6, PLAY_SLOW = 0.15;   // playback speed of real physical time
const INTRO = 1.28, COUNT_AT = [0, 0.4, 0.84]; // beats of the S-05 start signal: 3・2・1, the bell releases the balls
const ctrlOf = (lvl, p) => [START, ...p, lvl.goal];

// ---------- ghost links: the pins travel in the URL hash, the receiver re-simulates them (deterministic) ----------
const enc = p => p.map(q => Math.round(q[0] * 100) + ',' + Math.round(q[1] * 100)).join('_');
function linkFor(lvl, p) {
  const q = new URLSearchParams({ l: lvl.id, p: enc(p) });
  if (lvl.kind === 'daily') q.set('n', DAILY_NO);
  return location.href.split('#')[0] + '#' + q.toString();
}
function clampPin(lvl, arr, i, x, y) {
  const lo = (i === 0 ? START[0] : arr[i - 1][0]) + 0.35, hi = (i === arr.length - 1 ? lvl.goal[0] : arr[i + 1][0]) - 0.35;
  return [Math.min(hi, Math.max(lo, x)), Math.min(3.4, Math.max(-2.5, y))];
}
function readLink() {
  const q = new URLSearchParams(location.hash.slice(1)), idx = LEVELS.findIndex(l => l.id === q.get('l'));
  if (idx < 0 || !LEVELS[idx].pins) return null;
  const lvl = LEVELS[idx];
  if (lvl.kind === 'daily' && +q.get('n') !== DAILY_NO) return { idx, stale: true };
  const raw = (q.get('p') || '').split('_').map(s => s.split(',').map(Number));
  if (raw.length !== lvl.pins.length || raw.some(r => r.length !== 2 || !r.every(Number.isFinite))) return null;
  const p = raw.map(r => [r[0] / 100, r[1] / 100]);
  p.forEach((r, i) => { p[i] = clampPin(lvl, p, i, r[0], r[1]); });
  return { idx, pins: p };
}

// ---------- DOM ----------
const $ = id => document.getElementById(id);
const cv = $('stage'), ctx = cv.getContext('2d'), wrapEl = $('wrap');
let W = 0, H = 0, C = {}, DPR = 1, FONT = 'sans-serif', dirty = true, view = null;
const REDUCED = matchMedia('(prefers-reduced-motion: reduce)').matches;
// edit view only repaints when something changed; `geom` also drops the cached tracks and simulation
function invalidate(geom) { dirty = true; if (geom) view = null; }
// ---------- image assets: course art after first paint, scenery after the first race (素材リスト 制作ルール) ----------
const IMG = {}, BALL_IMG = { solid: 'steel', hollow: 'hollow', ice: 'ice' }, FX = ['woodchip-a', 'woodchip-b', 'woodchip-c', 'confetti-a', 'confetti-b', 'confetti-c'];
const TEX_PER_M = 640;   // wood texture pixels per metre of track (256 px = the 0.4 m lane width)
let woodPat = null, raced = false;
function loadImg(key, src) {
  if (key in IMG) return;
  IMG[key] = null;
  const im = new Image(); im.onload = () => { IMG[key] = im; invalidate(); }; im.src = src;
}
function loadRaceArt() {
  loadImg('wood', 'assets/tex/wood.webp');
  Object.values(BALL_IMG).forEach(b => loadImg('ball-' + b, `assets/ball/${b}.webp`));
  FX.forEach(n => loadImg(n, `assets/fx/I-10-${n}.png`));
}
function loadScenery() { ['workshop', 'night-lab', 'glacier'].forEach(n => loadImg('bg-' + n, `assets/bg/${n}.webp`)); }
const sceneryOf = l => 'bg-' + (l.ball === 'ice' ? 'glacier' : l.kind === 'daily' ? 'night-lab' : 'workshop');
function readColors() {
  const cs = getComputedStyle(document.documentElement);
  ['paper', 'stage', 'ink', 'muted', 'line', 'panel', 'wood', 'wood-dark', 'steel', 'mint', 'cobalt', 'alert', 'gate', 'friend'].forEach(n => C[n] = cs.getPropertyValue('--' + n).trim());
  FONT = getComputedStyle(document.body).fontFamily;
  invalidate();
}
function resize() {
  const r = cv.getBoundingClientRect(); DPR = Math.min(2, window.devicePixelRatio || 1);
  W = r.width; H = r.height; cv.width = Math.round(W * DPR); cv.height = Math.round(H * DPR);
  invalidate(); placeGuide();
}

// ---------- colour helpers (hex in, hex out: no string parsing per segment) ----------
const rgb = h => { h = h.replace('#', ''); if (h.length === 3) h = h.split('').map(c => c + c).join(''); const n = parseInt(h, 16); return [n >> 16 & 255, n >> 8 & 255, n & 255]; };
function mix(h1, h2, u) {
  const a = rgb(h1), b = rgb(h2);
  return '#' + a.map((c, i) => Math.round(c + (b[i] - c) * u).toString(16).padStart(2, '0')).join('');
}
function shade(hex, f) { return f <= 1 ? mix(hex, '#000000', 1 - f) : mix(hex, '#ffffff', Math.min(1, f - 1)); }

// ---------- projection: flat side view blended into a 3D chase camera ----------
const BOX = { x0: -0.4, x1: 6.4, y0: -2.7, y1: 3.7 };
function orthoScale() { return Math.min(W / (BOX.x1 - BOX.x0), H / (BOX.y1 - BOX.y0)); }
function ortho(x, y) {
  const sc = orthoScale(), ox = (W - (BOX.x1 - BOX.x0) * sc) / 2, oy = (H - (BOX.y1 - BOX.y0) * sc) / 2;
  return [ox + (x - BOX.x0) * sc, oy + (BOX.y1 - y) * sc, sc];
}
function invOrtho(px, py) {
  const sc = orthoScale(), ox = (W - (BOX.x1 - BOX.x0) * sc) / 2, oy = (H - (BOX.y1 - BOX.y0) * sc) / 2;
  return [BOX.x0 + (px - ox) / sc, BOX.y1 - (py - oy) / sc];
}
const cam = { pos: [-1.5, 3.4, 4.4], look: [0.6, 2.4, -0.2], r: [1, 0, 0], u: [0, 1, 0], f: [0, 0, -1] };
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const crs = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const nrm = a => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
function camBasis() { cam.f = nrm(sub(cam.look, cam.pos)); cam.r = nrm(crs(cam.f, [0, 1, 0])); cam.u = crs(cam.r, cam.f); }
function persp(x, y, z) {
  const d = sub([x, y, z], cam.pos), zc = Math.max(0.3, dot(d, cam.f)), F = H * 1.3;
  return [W / 2 + F * dot(d, cam.r) / zc, H * 0.5 - F * dot(d, cam.u) / zc, F / zc];
}
const ease = t => t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
function proj(x, y, z) {
  const a = ortho(x, y);
  if (camT <= 0.001) return a;
  const b = persp(x, y, z), t = ease(camT);
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

// ---------- drawing ----------
function poly(pts, fill) { ctx.beginPath(); ctx.moveTo(pts[0][0], pts[0][1]); for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]); ctx.closePath(); ctx.fillStyle = fill; ctx.fill(); }
function drawGround() {
  if (camT < 0.02) return;
  ctx.save(); ctx.globalAlpha = ease(camT) * 0.7; ctx.strokeStyle = C.line; ctx.lineWidth = 1; ctx.beginPath();
  for (let x = -1; x <= 8; x++) { const a = proj(x, BOX.y0, -3), b = proj(x, BOX.y0, 3); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); }
  for (let z = -3; z <= 3; z++) { const a = proj(-1, BOX.y0, z), b = proj(8, BOX.y0, z); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); }
  ctx.stroke(); ctx.restore();
}
function drawLaneFlat(tr, opt) {
  const P = tr.pts;
  ctx.save(); ctx.globalAlpha = opt.alpha ?? 1; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  ctx.strokeStyle = opt.color; ctx.lineWidth = opt.width ?? 7;
  if (opt.dash) ctx.setLineDash(opt.dash);
  if (!opt.onlyHl) { ctx.beginPath(); P.forEach((p, i) => { const q = ortho(p[0], p[1]); i ? ctx.lineTo(q[0], q[1]) : ctx.moveTo(q[0], q[1]); }); ctx.stroke(); }
  if (opt.hl) {
    ctx.setLineDash([]); ctx.strokeStyle = C.alert; ctx.lineWidth = (opt.width ?? 7) + 2;
    ctx.beginPath(); for (let i = opt.hl[0]; i <= opt.hl[1]; i++) { const q = ortho(P[i][0], P[i][1]); i === opt.hl[0] ? ctx.moveTo(q[0], q[1]) : ctx.lineTo(q[0], q[1]); } ctx.stroke();
  }
  ctx.restore();
}
const LIGHT = nrm([-0.35, 1, 0.5]);
function drawLane3D(tr, z, opt) {
  const P = tr.pts, w = opt.w ?? 0.2, step = 2, A = opt.alpha ?? 1;
  const fade = c => A < 1 ? mix(c, C.stage, 1 - A) : c;
  if (opt.ghost) {
    // other balls' routes: a single slim rail so they never compete with the player's lane
    ctx.save(); ctx.globalAlpha = A; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.beginPath(); P.forEach((p, i) => { const m = proj(p[0], p[1], z); i ? ctx.lineTo(m[0], m[1]) : ctx.moveTo(m[0], m[1]); });
    ctx.strokeStyle = 'rgba(0,0,0,.35)'; ctx.lineWidth = Math.max(3, 0.09 * proj(P[0][0], P[0][1], z)[2]); ctx.stroke();
    ctx.strokeStyle = opt.top; ctx.lineWidth = Math.max(2, 0.05 * proj(P[0][0], P[0][1], z)[2]); ctx.stroke();
    ctx.restore(); return;
  }
  const th = 0.1;
  ctx.save();
  // the track's shadow on the floor, cast by the same light
  ctx.globalAlpha = 0.12 * ease(camT) * A; ctx.beginPath();
  P.forEach((p, i) => { const sx = p[0] - LIGHT[0] / LIGHT[1] * (p[1] - BOX.y0), m = proj(sx, BOX.y0, z - w); i ? ctx.lineTo(m[0], m[1]) : ctx.moveTo(m[0], m[1]); });
  for (let i = P.length - 1; i >= 0; i--) { const p = P[i], sx = p[0] - LIGHT[0] / LIGHT[1] * (p[1] - BOX.y0), m = proj(sx, BOX.y0, z + w); ctx.lineTo(m[0], m[1]); }
  ctx.fillStyle = '#000'; ctx.fill();
  ctx.globalAlpha = 1; ctx.lineWidth = 0.6;
  const side = fade(shade(opt.side, 0.9));
  if (opt.wood && !woodPat && IMG.wood) woodPat = ctx.createPattern(IMG.wood, 'repeat');
  const pat = opt.wood && woodPat && woodPat.setTransform ? woodPat : null;
  for (let i = step; i < P.length; i += step) {
    const a = P[i - step], b = P[i], dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy) || 1;
    const q1 = proj(a[0], a[1], z - w), q2 = proj(b[0], b[1], z - w), q3 = proj(b[0], b[1], z + w), q4 = proj(a[0], a[1], z + w);
    const f1 = proj(a[0], a[1] - th, z + w), f2 = proj(b[0], b[1] - th, z + w);
    const hl = opt.hl && i >= opt.hl[0] && i <= opt.hl[1];
    const lam = Math.max(0, (-dy / L) * LIGHT[0] + (dx / L) * LIGHT[1]);   // Lambert term of the top surface
    const sd = hl ? C.alert : side, top = hl ? C.alert : fade(shade(opt.top, 0.62 + 0.5 * lam));
    poly([q4, q3, f2, f1], sd); ctx.strokeStyle = sd; ctx.stroke();
    if (pat && !hl) {
      // I-06 wood mapped along the track: u follows arc length, v spans the lane (one affine map per quad)
      const s0 = tr.s[i - step] * TEX_PER_M, ds = (tr.s[i] - tr.s[i - step]) * TEX_PER_M || 1;
      const ma = (q2[0] - q1[0]) / ds, mb = (q2[1] - q1[1]) / ds;
      pat.setTransform(new DOMMatrix([ma, mb, (q4[0] - q1[0]) / 256, (q4[1] - q1[1]) / 256, q1[0] - ma * s0, q1[1] - mb * s0]));
      poly([q1, q2, q3, q4], pat); ctx.strokeStyle = pat; ctx.stroke();
      const f = 0.62 + 0.5 * lam;   // same Lambert shading as the flat colour, as a light/dark wash
      ctx.globalAlpha = Math.min(0.5, Math.abs(f - 1)); poly([q1, q2, q3, q4], f < 1 ? '#000' : '#fff'); ctx.globalAlpha = 1;
    } else { poly([q1, q2, q3, q4], top); ctx.strokeStyle = top; ctx.stroke(); }
  }
  // steel rails along both edges
  [z - w, z + w].forEach((zz, k) => {
    ctx.beginPath();
    P.forEach((p, i) => { const m = proj(p[0], p[1] + 0.025, zz); i ? ctx.lineTo(m[0], m[1]) : ctx.moveTo(m[0], m[1]); });
    ctx.strokeStyle = shade(C.steel, k ? 1.15 : 0.8); ctx.lineWidth = Math.max(1, 0.025 * proj(P[0][0], P[0][1], zz)[2]); ctx.stroke();
  });
  ctx.restore();
}
function drawGate(g, z) {
  ctx.save(); ctx.strokeStyle = C.gate; ctx.lineWidth = 4; ctx.beginPath();
  for (let i = 0; i <= 32; i++) { const a = i / 32 * Math.PI * 2, q = proj(g.x + Math.cos(a) * g.r, g.y + Math.sin(a) * g.r, z); i ? ctx.lineTo(q[0], q[1]) : ctx.moveTo(q[0], q[1]); }
  ctx.stroke(); ctx.restore();
}
function drawGoal(gx, gy) {
  const zs = camT > 0.02 ? [-1.25, 1.25] : [0];
  ctx.save(); ctx.lineWidth = 3; ctx.strokeStyle = C.ink;
  zs.forEach(z => { const a = proj(gx, gy - 0.15, z), b = proj(gx, gy + 0.9, z); ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke(); });
  if (zs.length > 1) {
    const n = 10;
    for (let i = 0; i < n; i++) {
      const z0 = -1.25 + 2.5 * i / n, z1 = -1.25 + 2.5 * (i + 1) / n;
      poly([proj(gx, gy + 0.9, z0), proj(gx, gy + 0.9, z1), proj(gx, gy + 0.72, z1), proj(gx, gy + 0.72, z0)], i % 2 ? C.ink : C.panel);
    }
  } else {
    for (let i = 0; i < 5; i++) poly([ortho(gx, gy + 0.9 - i * 0.18), ortho(gx + 0.22, gy + 0.9 - i * 0.18), ortho(gx + 0.22, gy + 0.72 - i * 0.18), ortho(gx, gy + 0.72 - i * 0.18)], i % 2 ? C.panel : C.ink);
  }
  ctx.restore();
}
function ballPose(tr, sim, T) {
  // centre of the ball at physical time T; spin angle advances at the rolling rate (kept constant in the air)
  const t = sim.t, last = sim.last;
  for (const f of sim.flights) {
    if (T >= f.t0 && (T < f.t1 || f.finish)) {
      const tau = Math.min(T, f.t1) - f.t0;
      return { x: f.x0 + f.vx * tau, y: f.y0 + f.vy * tau - 0.5 * G * tau * tau, spin: (tr.s[f.i0] + f.vL * tau) / BALL_R,
               speed: Math.hypot(f.vx, f.vy - G * tau), airborne: true };
    }
  }
  // first index in [1, last] with t >= T (t is non-decreasing up to `last`)
  let lo = 1, hi = Math.max(1, last);
  while (lo < hi) { const m = (lo + hi) >> 1; if (t[m] < T) lo = m + 1; else hi = m; }
  const i = lo, tA = t[i - 1], tB = t[i], u = tB > tA ? Math.min(1, Math.max(0, (T - tA) / (tB - tA))) : 1;
  return { x: sim.cx[i - 1] + (sim.cx[i] - sim.cx[i - 1]) * u, y: sim.cy[i - 1] + (sim.cy[i] - sim.cy[i - 1]) * u,
           spin: (tr.s[i - 1] + (tr.s[i] - tr.s[i - 1]) * u) / BALL_R, speed: sim.v[i - 1] + (sim.v[i] - sim.v[i - 1]) * u, airborne: false };
}
const ENTRY_COLOR = { rival: 'cobalt', friend: 'friend' };
function drawBall(e, pose, alpha) {
  const z = e.z, R = BALL_R, q = proj(pose.x, pose.y, z), r = Math.max(3, R * q[2]), e3 = ease(camT);
  ctx.save();
  if (e3 > 0.02) {
    // contact shadow on the track below the ball, softer and smaller the higher it flies
    const [, yt] = trackYAt(e.tr.pts, pose.x, 0), hgt = Math.max(0, pose.y - R - yt);
    const sh = proj(pose.x + 0.04 + hgt * 0.25, yt + 0.005, z), f = 1 / (1 + hgt * 2.5);
    ctx.globalAlpha = alpha * e3 * 0.35 * f; ctx.fillStyle = '#000';
    ctx.beginPath(); ctx.ellipse(sh[0], sh[1], r * (1.1 + hgt), r * 0.32 * (1 + hgt), 0, 0, Math.PI * 2); ctx.fill();
  }
  const tint = ENTRY_COLOR[e.kind] ? C[ENTRY_COLOR[e.kind]] : null;
  // motion trail from the last few frames, only at speed
  if (e.trail && e.trail.length > 2 && pose.speed > 2.5) {
    ctx.globalAlpha = alpha * 0.22 * Math.min(1, (pose.speed - 2.5) / 4); ctx.lineCap = 'round';
    ctx.strokeStyle = tint || C.steel; ctx.lineWidth = r * 1.4; ctx.beginPath();
    e.trail.forEach((w, j) => { const m = proj(w[0], w[1], z); j ? ctx.lineTo(m[0], m[1]) : ctx.moveTo(m[0], m[1]); });
    ctx.lineTo(q[0], q[1]); ctx.stroke();
  }
  ctx.globalAlpha = alpha;
  const base = tint || (e.ball === 'ice' ? '#8fdcef' : C.steel);
  const lx = q[0] - r * 0.38, ly = q[1] - r * 0.42;   // light from the upper left, matching the track shading
  if (e.ball === 'ring') {
    ctx.lineWidth = r * 0.42; ctx.strokeStyle = shade(base, 0.55);
    ctx.beginPath(); ctx.arc(q[0], q[1], r * 0.79, 0, Math.PI * 2); ctx.stroke();
    ctx.lineWidth = r * 0.2; ctx.strokeStyle = base; ctx.beginPath(); ctx.arc(q[0], q[1], r * 0.79, Math.PI * 0.9, Math.PI * 1.75); ctx.stroke();
  } else if (!tint && IMG['ball-' + BALL_IMG[e.ball]]) {
    // I-08 material previews as sprites; the spin marks below still show the rolling rate
    if (e.ball === 'ice') ctx.globalAlpha = alpha * 0.9;
    ctx.drawImage(IMG['ball-' + BALL_IMG[e.ball]], q[0] - r, q[1] - r, r * 2, r * 2);
  } else {
    const g = ctx.createRadialGradient(lx, ly, r * 0.05, q[0], q[1], r);
    g.addColorStop(0, '#ffffff'); g.addColorStop(0.28, base); g.addColorStop(0.85, shade(base, 0.45)); g.addColorStop(1, shade(base, 0.62));
    if (e.ball === 'ice') ctx.globalAlpha = alpha * 0.82;
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(q[0], q[1], r, 0, Math.PI * 2); ctx.fill();
    if (e.ball === 'hollow') { ctx.strokeStyle = 'rgba(255,255,255,.65)'; ctx.lineWidth = Math.max(1, r * 0.12); ctx.beginPath(); ctx.arc(q[0], q[1], r * 0.6, 0, Math.PI * 2); ctx.stroke(); }
  }
  if (e.ball !== 'ice') {
    // two marks on the surface so the rolling rate is visible (clockwise when moving right)
    ctx.fillStyle = 'rgba(20,25,30,.55)';
    [0, Math.PI].forEach(o => { const a = pose.spin + o; ctx.beginPath(); ctx.arc(q[0] + Math.cos(a) * r * 0.62, q[1] + Math.sin(a) * r * 0.62, Math.max(1, r * 0.13), 0, Math.PI * 2); ctx.fill(); });
  }
  ctx.restore();
  return [q[0], q[1] - r];
}
function label(text, at, color) {
  ctx.save(); ctx.font = '700 11px ' + FONT; ctx.textAlign = 'center'; ctx.lineJoin = 'round';
  ctx.strokeStyle = C.panel; ctx.lineWidth = 3; ctx.strokeText(text, at[0], at[1] - 6);
  ctx.fillStyle = color; ctx.fillText(text, at[0], at[1] - 6); ctx.restore();
}

// index of the first track point the ball has not reached yet at time T (lands past a jump)
function idxAt(sim, T) { let lo = 1, hi = Math.max(1, sim.last); while (lo < hi) { const m = (lo + hi) >> 1; if (sim.t[m] < T) lo = m + 1; else hi = m; } return lo; }
function drawAhead(e, T) {
  // the next stretch of the player's own route, lit so the eye knows where the ball is heading
  const P = e.tr.pts, i0 = idxAt(e.sim, T), n = 70, end = Math.min(e.sim.ok ? P.length - 1 : e.sim.last, i0 + n);
  if (end <= i0 + 1) return;
  ctx.save(); ctx.lineCap = 'round'; ctx.strokeStyle = C.mint;
  let prev = proj(P[i0][0], P[i0][1] + 0.02, e.z);
  for (let i = i0 + 2; i <= end; i += 2) {
    const q = proj(P[i][0], P[i][1] + 0.02, e.z);
    ctx.globalAlpha = ease(camT) * 0.9 * (1 - (i - i0) / n);
    ctx.lineWidth = Math.max(2, 0.07 * q[2]); ctx.beginPath(); ctx.moveTo(prev[0], prev[1]); ctx.lineTo(q[0], q[1]); ctx.stroke();
    prev = q;
  }
  ctx.restore();
}
// the start: a wooden deck the lanes come out of, so the track no longer begins in mid-air
const startSpan = entries => [Math.min(...entries.map(e => e.z)) - 0.28, 0.28];
function drawStartDeck(entries) {
  const [z0, z1] = startSpan(entries), x0 = -0.8, x1 = 0.04, y = START[1], th = 0.22;
  ctx.save(); ctx.globalAlpha = ease(camT);
  poly([proj(x0, y, z1), proj(x1, y, z1), proj(x1, y - th, z1), proj(x0, y - th, z1)], shade(C['wood-dark'], 0.95));
  poly([proj(x1, y, z0), proj(x1, y, z1), proj(x1, y - th, z1), proj(x1, y - th, z0)], shade(C['wood-dark'], 0.7));
  poly([proj(x0, y, z0), proj(x1, y, z0), proj(x1, y, z1), proj(x0, y, z1)], shade(C.wood, 1.05));
  ctx.restore();
}
function drawMiniMap(l, entries) {
  // the whole course, side-on, top right: where everyone is and what comes next
  const mw = Math.min(150, W * 0.38), mh = mw * 0.8, x0 = W - mw - 10, y0 = 10;
  const s = Math.min(mw / (BOX.x1 - BOX.x0), mh / (BOX.y1 - BOX.y0));
  const ox = x0 + (mw - (BOX.x1 - BOX.x0) * s) / 2, oy = y0 + (mh - (BOX.y1 - BOX.y0) * s) / 2;
  const m = (x, y) => [ox + (x - BOX.x0) * s, oy + (BOX.y1 - y) * s];
  const line = (pts, color, width, dash) => { ctx.beginPath(); pts.forEach((p, i) => { const q = m(p[0], p[1]); i ? ctx.lineTo(q[0], q[1]) : ctx.moveTo(q[0], q[1]); }); ctx.strokeStyle = color; ctx.lineWidth = width; ctx.setLineDash(dash || []); ctx.stroke(); };
  ctx.save(); ctx.globalAlpha = ease(camT);
  ctx.fillStyle = 'rgba(8,17,28,.62)'; ctx.beginPath(); ctx.roundRect(x0, y0, mw, mh, 10); ctx.fill();
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  entries.forEach(e => { if (e.kind !== 'player') line(e.tr.pts, C[ENTRY_COLOR[e.kind]] || C.steel, 1.5, [3, 3]); });
  const p = race.player; line(p.tr.pts, '#d79a58', 3);
  const done = p.tr.pts.slice(0, idxAt(p.sim, race.T)); if (done.length > 1) line(done, '#3fc6a2', 3);
  if (l.gate) { const g = m(l.gate.x, l.gate.y); ctx.setLineDash([]); ctx.strokeStyle = C.gate; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(g[0], g[1], l.gate.r * s, 0, Math.PI * 2); ctx.stroke(); }
  const gl = m(l.goal[0], l.goal[1]), gt = m(l.goal[0], l.goal[1] + 0.9); ctx.setLineDash([]); ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.moveTo(gl[0], gl[1]); ctx.lineTo(gt[0], gt[1]); ctx.stroke();
  entries.forEach(e => {
    const b = ballPose(e.tr, e.sim, race.T), q = m(b.x, b.y), me = e.kind === 'player';
    ctx.fillStyle = me ? '#ffffff' : (C[ENTRY_COLOR[e.kind]] || C.steel); ctx.beginPath(); ctx.arc(q[0], q[1], me ? 4 : 3, 0, Math.PI * 2); ctx.fill();
    if (me) { ctx.strokeStyle = '#3fc6a2'; ctx.lineWidth = 2; ctx.stroke(); }
  });
  ctx.restore();
}
function laneStyles(kind) {
  if (kind === 'rival') return { top: C.cobalt, ghost: true, alpha: 0.85 };
  if (kind === 'friend') return { top: C.friend, ghost: true, alpha: 0.85 };
  if (kind === 'best') return { top: C.steel, ghost: true, alpha: 0.6 };
  return { top: C.wood, side: C['wood-dark'], alpha: 1, wood: true };
}

// cached geometry for the edit view; rebuilt only when pins or level change
function editView() {
  if (view) return view;
  const l = lv();
  if (l.kind === 'predict') return (view = { A: buildTrack(l.A), B: buildTrack(l.B) });
  const tr = buildTrack(ctrlOf(l, pins)), sim = simulate(tr, BALLS[l.ball], null), bp = bestPins();
  return (view = {
    tr, sim, vmax: Math.max(1, ...sim.v),
    air: sim.flights.filter(f => f.landed).map(f => [f.i0, f.j]),
    rival: buildTrack(l.rival.ctrl),
    best: bp ? buildTrack(ctrlOf(l, bp)) : null,
    friend: friend && friend.idx === L ? buildTrack(ctrlOf(l, friend.pins)) : null
  });
}

function draw() {
  camBasis();
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  ctx.fillStyle = C.stage; ctx.fillRect(0, 0, W, H);
  const bg = camT > 0.02 && IMG[sceneryOf(lv())];
  wrapEl.classList.toggle('scenic', !!bg);   // light HUD text over the darker scenery
  if (bg) {
    // I-09 far scenery behind the chase camera, sliding slowly with it
    const sc = Math.max(W / bg.width, H / bg.height) * 1.25, w = bg.width * sc, h = bg.height * sc;
    ctx.save(); ctx.globalAlpha = ease(camT) * 0.85;
    ctx.drawImage(bg, -Math.min(1, Math.max(0, cam.look[0] / 7)) * (w - W), (H - h) / 2 + (cam.look[1] - 1) * 6, w, h);
    ctx.fillStyle = '#08111c'; ctx.globalAlpha = ease(camT) * 0.35; ctx.fillRect(0, 0, W, H); ctx.restore();   // dim so the course reads first
  }
  if (race && race.shake > 0.01 && !REDUCED) ctx.translate((Math.random() - 0.5) * race.shake * 10, (Math.random() - 0.5) * race.shake * 10);
  drawGround();
  const l = lv();
  if (mode === 'race' || camT > 0.001) {
    const entries = race ? race.sorted : [];
    if (camT < 0.02) {
      entries.forEach(e => drawLaneFlat(e.tr, e.kind === 'player' ? { color: C.wood } : { color: C[ENTRY_COLOR[e.kind]] || C.muted, dash: [6, 8], width: 4, alpha: 0.7 }));
    } else {
      entries.forEach(e => drawLane3D(e.tr, e.z, laneStyles(e.kind)));
      if (race) drawAhead(race.player, race.T);
    }
    if (l.gate) drawGate(l.gate, 0);
    drawGoal(l.goal[0], l.goal[1]);
    if (camT > 0.02) drawStartDeck(entries);
    entries.forEach(e => {
      const pose = ballPose(e.tr, e.sim, race ? race.T : 0);
      const top = drawBall(e, pose, e.kind === 'best' ? 0.45 : 1);
      if (camT > 0.3) label(e.label, top, ENTRY_COLOR[e.kind] ? C[ENTRY_COLOR[e.kind]] : C.ink);
    });
    if (race && camT > 0.3) drawMiniMap(l, entries);
    if (race && race.parts.length) {
      ctx.save(); ctx.fillStyle = C.wood;
      race.parts.forEach(pt => {
        const m = proj(pt.x, pt.y, pt.z), im = IMG[pt.img];
        ctx.setTransform(DPR, 0, 0, DPR, 0, 0); ctx.globalAlpha = Math.min(1, Math.max(0, pt.life)) * 0.9;
        if (im) {   // I-10 woodchips and confetti
          const sz = Math.max(4, pt.size * m[2]);
          ctx.translate(m[0], m[1]); ctx.rotate(pt.rot);
          ctx.drawImage(im, -sz / 2, -sz / 2, sz, sz);
        } else { ctx.beginPath(); ctx.arc(m[0], m[1], Math.max(1, 0.02 * m[2]), 0, Math.PI * 2); ctx.fill(); }
      });
      ctx.restore();
    }
    return;
  }
  // edit view (flat side view)
  const v = editView();
  if (l.kind === 'predict') {
    drawLaneFlat(v.A, { color: C.cobalt, width: 6 });
    drawLaneFlat(v.B, { color: C.wood, width: 6 });
    const a = ortho(3.1, 1.75), b = ortho(3.2, -0.5);
    ctx.save(); ctx.font = '700 15px ' + FONT;
    ctx.fillStyle = C.cobalt; ctx.fillText('A', a[0] + 8, a[1] - 8); ctx.fillStyle = C.wood; ctx.fillText('B', b[0] + 4, b[1] + 22); ctx.restore();
  } else {
    drawLaneFlat(v.rival, { color: C.cobalt, dash: [6, 8], width: 3, alpha: 0.65 });
    if (v.friend) drawLaneFlat(v.friend, { color: C.friend, dash: [8, 6], width: 3, alpha: 0.75 });
    if (v.best) drawLaneFlat(v.best, { color: C.muted, dash: [2, 6], width: 3, alpha: 0.7 });
    drawSpeedLane(v);
    if (highlight) drawLaneFlat(v.tr, { color: C.wood, hl: highlight, onlyHl: true });
    // pins
    pins.forEach((p, i) => {
      const q = ortho(p[0], p[1]);
      ctx.save(); ctx.strokeStyle = C.line; ctx.setLineDash([3, 5]); ctx.beginPath(); ctx.moveTo(q[0], 0); ctx.lineTo(q[0], H); ctx.stroke(); ctx.restore();
      ctx.save(); ctx.fillStyle = C.panel; ctx.strokeStyle = C.mint; ctx.lineWidth = picked === i ? 4 : 3;
      ctx.beginPath(); ctx.arc(q[0], q[1], picked === i ? 15 : 12, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.fillStyle = C.mint; ctx.beginPath(); ctx.arc(q[0], q[1], 4, 0, Math.PI * 2); ctx.fill(); ctx.restore();
      if (picked === i) {
        ctx.save(); ctx.font = '500 12px ' + FONT; ctx.fillStyle = C.ink;
        ctx.textAlign = q[0] > W - 110 ? 'right' : 'left';
        ctx.fillText(`高さ ${p[1].toFixed(2)} m`, q[0] + (q[0] > W - 110 ? -20 : 20), q[1] - 18); ctx.restore();
      }
    });
  }
  if (l.gate) drawGate(l.gate, 0);
  const s = ortho(START[0], START[1]);
  ctx.save(); ctx.fillStyle = C.ink; ctx.beginPath(); ctx.arc(s[0], s[1], 5, 0, Math.PI * 2); ctx.fill(); ctx.restore();
  drawGoal(l.goal[0], l.goal[1]);
  // 1 m scale bar so the units are real
  const a = ortho(5.2, BOX.y0 + 0.25), b = ortho(6.2, BOX.y0 + 0.25);
  ctx.save(); ctx.strokeStyle = C.muted; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]);
  ctx.moveTo(a[0], a[1] - 4); ctx.lineTo(a[0], a[1] + 4); ctx.moveTo(b[0], b[1] - 4); ctx.lineTo(b[0], b[1] + 4); ctx.stroke();
  ctx.fillStyle = C.muted; ctx.font = '500 11px ' + FONT; ctx.textAlign = 'center'; ctx.fillText('1 m', (a[0] + b[0]) / 2, a[1] - 7); ctx.restore();
}

function drawSpeedLane(v) {
  // the track coloured by the speed the ball will have there (wood = slow, mint = fast)
  const { sim, tr, vmax, air } = v, P = tr.pts;
  ctx.save(); ctx.lineCap = 'round'; ctx.lineWidth = 7;
  let prev = ortho(P[0][0], P[0][1]);
  for (let i = 1; i < P.length; i++) {
    const b = ortho(P[i][0], P[i][1]);
    const inAir = air.some(([i0, j]) => i > i0 && i <= j);
    ctx.globalAlpha = i > sim.last && !sim.ok ? 0.35 : inAir ? 0.4 : 1;
    ctx.strokeStyle = mix(C.wood, C.mint, Math.min(1, (sim.v[i] || 0) / vmax));
    ctx.beginPath(); ctx.moveTo(prev[0], prev[1]); ctx.lineTo(b[0], b[1]); ctx.stroke();
    prev = b;
  }
  ctx.restore();
  drawJumpPreview(sim);
}
function drawJumpPreview(sim) {
  // preliminary action: show where the ball will leave the track before the race
  sim.flights.forEach(f => {
    const end = isFinite(f.t1) ? f.t1 - f.t0 : 1.2;
    ctx.save(); ctx.strokeStyle = f.landed || f.finish ? C.gate : C.alert; ctx.lineWidth = 2.5; ctx.setLineDash([3, 5]);
    ctx.beginPath();
    for (let tau = 0; tau <= end; tau += 0.01) { const q = ortho(f.x0 + f.vx * tau, f.y0 + f.vy * tau - 0.5 * G * tau * tau - BALL_R); tau ? ctx.lineTo(q[0], q[1]) : ctx.moveTo(q[0], q[1]); }
    ctx.stroke();
    const q = ortho(f.x0, f.y0); ctx.setLineDash([]); ctx.font = '700 10px ' + FONT;
    ctx.fillStyle = ctx.strokeStyle; ctx.fillText(f.landed || f.finish ? 'ジャンプ' : 'コースアウト', q[0] - 14, q[1] - 12);
    ctx.restore();
  });
}

// ---------- race ----------
function bestPins() { const b = progress.best[lv().id]; return b && b.pins && b.pins.length === pins.length ? b.pins : null; }
function entry(kind, ctrl, ballKey, z, labelText) {
  const tr = buildTrack(ctrl), sim = simulate(tr, BALLS[ballKey], kind === 'rival' ? null : lv().gate);
  return { kind, tr, sim, ball: ballKey, z, label: labelText };
}
function startRace(choice) {
  const l = lv();
  if (l.kind === 'daily' && daily.used >= 3) return;
  const entries = [];
  if (l.kind === 'predict') {
    entries.push(entry('rival', l.A, l.ball, -0.9, 'A 直線'));
    entries.push(entry('player', l.B, l.ball, 0, 'B カーブ'));
  } else {
    entries.push(entry('rival', l.rival.ctrl, l.rival.ball, -0.9, l.rival.name));
    entries.push(entry('player', ctrlOf(l, pins), l.ball, 0, 'あなた'));
    if (friend && friend.idx === L) entries.push(entry('friend', ctrlOf(l, friend.pins), l.ball, -1.8, '友達'));
    const bp = bestPins(); if (bp) entries.push(entry('best', ctrlOf(l, bp), l.ball, friend && friend.idx === L ? -2.7 : -1.8, '自己ベスト'));
    if (l.kind === 'daily') { daily.used++; store.set('gr-daily', daily); }
  }
  entries.forEach(e => {
    e.end = e.sim.ok ? e.sim.time : e.sim.t[e.sim.last] + (e.sim.fail === 'fly' ? 0.7 : 0.4);
    e.trail = [];
  });
  race = { T: 0, phase: 'intro', clock: 0, intro: 0, beat: -1, slow: false, entries, sorted: entries.slice().sort((a, b) => a.z - b.z),
           player: entries.find(e => e.kind === 'player'), choice,
           win: (() => { const pl = entries.find(e => e.kind === 'player'), rv = entries.find(e => e.kind === 'rival'); return pl.sim.ok && (!rv.sim.ok || pl.sim.time < rv.sim.time); })(), endT: Math.max(...entries.map(e => e.end)), parts: [], shake: 0 };
  cam.look = [0.75, 2.6, -0.5]; cam.pos = [0.4, 4.6, 5.0];
  mode = 'race'; highlight = null; picked = null; hideGuide();
  SFX.start(); SFX.music('race');
  $('result').innerHTML = ''; $('speed').textContent = ''; $('clock').innerHTML = '0.00<small>秒</small>'; renderDock(); $('tip').textContent = '実時間の0.6倍速で再生。ゴール直前は0.15倍';
}
function setCount(text, go) { const c = $('count'); c.hidden = !text; c.textContent = text || ''; c.classList.toggle('go', !!go); }
let lastTs = 0;
function tick(ts) {
  const dt = Math.min(0.05, (ts - (lastTs || ts)) / 1000); lastTs = ts;
  if (mode === 'race' && race) {
    if (race.phase === 'intro') {
      race.intro += dt; camT = Math.min(1, race.intro / 0.7);
      // S-05: 3・2・1 then the bell exactly when the balls are released
      const beat = COUNT_AT.filter(t => race.intro >= t).length - 1;
      if (beat > race.beat) { race.beat = beat; setCount(String(3 - beat)); }
      if (race.intro >= INTRO) { race.phase = 'run'; camT = 1; setCount('GO', true); setTimeout(() => setCount(''), 350); }
    } else if (race.phase === 'run') {
      const rem = Math.min(...race.entries.filter(e => e.sim.ok && race.T < e.sim.time).map(e => e.sim.time - race.T).concat([Infinity]));
      const slow = rem < 0.22;
      if (slow !== race.slow) { race.slow = slow; $('slow').hidden = !slow; SFX.muffle(slow); if (slow) SFX.slow(); }
      const T0 = race.T;
      race.T = Math.min(race.endT, race.T + dt * (slow ? PLAY_SLOW : PLAY_RATE));
      const p = race.player;
      $('clock').innerHTML = (p.sim.ok ? Math.min(race.T, p.sim.time) : race.T).toFixed(2) + '<small>秒</small>';
      const ps = ballPose(p.tr, p.sim, race.T);
      $('speed').textContent = `${(ps.speed * 3.6).toFixed(0)} km/h`;
      const playerDone = p.sim.ok ? race.T >= p.sim.time : race.T >= p.sim.t[p.sim.last];
      if (playerDone) SFX.rollStop(); else SFX.roll(ps.speed, ps.airborne, p.ball);
      race.entries.forEach(e => {
        const ep = e === p ? ps : ballPose(e.tr, e.sim, race.T);
        e.trail.push([ep.x, ep.y]); if (e.trail.length > 7) e.trail.shift();
        e.sim.flights.forEach(f => {
          if (e === p && T0 < f.t0 && race.T >= f.t0) SFX.jump();
          if (f.landed && T0 < f.t1 && race.T >= f.t1) {
            // landing: dust, a short camera shake, and a tap on phones that allow it
            const [, yt] = trackYAt(e.tr.pts, ep.x, 0), hit = Math.min(1, Math.hypot(f.vx, f.vy) / 8);
            for (let q = 0; q < 14; q++) race.parts.push({ x: ep.x, y: yt + 0.02, z: e.z + (Math.random() - 0.5) * 0.3, vx: (Math.random() - 0.3) * 1.6, vy: Math.random() * 1.8 * hit + 0.3, vz: (Math.random() - 0.5) * 1.2,
              life: 1, fade: 1.4, gk: 0.5, img: FX[q % 3], size: 0.1, rot: Math.random() * 6, vr: (Math.random() - 0.5) * 14 });
            if (e === p) { race.shake = 0.6 * hit + 0.2; SFX.land(hit); try { navigator.vibrate && navigator.vibrate(18); } catch (err) {} }
          }
        });
        if (e.sim.ok && T0 < e.sim.time && race.T >= e.sim.time) {
          SFX.goal(e === p);
          if (e === p && race.win) {   // confetti over the finish line
            const g = lv().goal;
            for (let q = 0; q < 46; q++) race.parts.push({ x: g[0] - 0.1, y: g[1] + 0.9, z: (Math.random() - 0.5) * 2.4, vx: -Math.random() * 2.2, vy: Math.random() * 2.6 + 0.6, vz: (Math.random() - 0.5) * 1.5,
              life: 2.2, fade: 0.9, gk: 0.12, img: FX[3 + q % 3], size: 0.12, rot: Math.random() * 6, vr: (Math.random() - 0.5) * 10 });
          }
        }
      });
      if (p.sim.ok && T0 < p.sim.time && race.T >= p.sim.time) { try { navigator.vibrate && navigator.vibrate([10, 40, 25]); } catch (err) {} }
      const failAt = p.sim.t[p.sim.last];
      if (!p.sim.ok && T0 < failAt && race.T >= failAt) { if (p.sim.fail === 'fly') SFX.courseOut(); else if (p.sim.fail === 'stall') SFX.stall(); }
      if (race.T >= race.endT) { race.phase = 'hold'; race.clock = 0; $('slow').hidden = true; SFX.rollStop(); SFX.muffle(false); }
    } else if (race.phase === 'hold') { race.clock += dt; if (race.clock > 0.8) race.phase = 'outro'; }
    else if (race.phase === 'outro') { camT = Math.max(0, camT - dt / 0.6); if (camT <= 0) finishRace(); }
    if (race) {
      race.shake *= Math.pow(0.02, dt);
      race.parts.forEach(pt => { pt.vy -= G * pt.gk * dt; pt.x += pt.vx * dt; pt.y += pt.vy * dt; pt.z += pt.vz * dt; pt.rot += pt.vr * dt; pt.life -= dt * pt.fade; });
      race.parts = race.parts.filter(pt => pt.life > 0);
    }
    if (race && race.phase !== 'outro') {
      // side-on chase of the player's own ball, framing where it is AND where its route goes next,
      // so steep drops stay on screen (the old over-the-shoulder view lost the track ahead)
      const p = race.player, endT = p.sim.ok ? p.sim.time : p.sim.t[p.sim.last];
      const now = ballPose(p.tr, p.sim, race.T), ahead = ballPose(p.tr, p.sim, Math.min(race.T + 0.35, endT));
      const lx = Math.min(now.x * 0.6 + ahead.x * 0.4, lv().goal[0]), ly = Math.max(now.y * 0.6 + ahead.y * 0.4, BOX.y0 + 0.5);
      const look = [lx + 0.35, ly - 0.15, -0.5], pos = [lx + 0.1, ly + 1.75, 5.0], k = 1 - Math.pow(0.008, dt);
      for (let j = 0; j < 3; j++) { cam.look[j] += (look[j] - cam.look[j]) * k; cam.pos[j] += (pos[j] - cam.pos[j]) * k; }
    }
    dirty = true;
  }
  if (dirty) { dirty = false; draw(); }
  requestAnimationFrame(tick);
}

// ---------- results ----------
function slowZone(p, r) {
  // the 1.2-wide stretch of x where the player lost the most time against the rival
  const tAtX = (e, x) => { const P = e.tr.pts; for (let i = 1; i <= e.sim.last; i++) if (P[i][0] >= x) { const u = (x - P[i - 1][0]) / ((P[i][0] - P[i - 1][0]) || 1); return e.sim.t[i - 1] + (e.sim.t[i] - e.sim.t[i - 1]) * u; } return e.sim.t[e.sim.last]; };
  const gx = lv().goal[0], win = 1.2; let best = -Infinity, bx = 0;
  for (let x = 0.05; x + win <= gx; x += 0.1) { const d = (tAtX(p, x + win) - tAtX(r, x + win)) - (tAtX(p, x) - tAtX(r, x)); if (d > best) { best = d; bx = x; } }
  const P = p.tr.pts; let i0 = 0, i1 = P.length - 1;
  while (i0 < P.length - 1 && P[i0][0] < bx) i0++;
  while (i1 > 0 && P[i1][0] > bx + win) i1--;
  return [i0, Math.max(i0, i1)];
}
const FAIL_TEXT = {
  stall: ['失速', 'スタートより高い場所は越えられません。赤い所を低くしよう。'],
  fly: ['コースアウト', 'ジャンプが大きすぎて、コースの外へ飛んでいきました。赤い所の山をゆるくしよう。'],
  gate: ['ゲート未通過', '金色の輪の中を通るように、ピンを動かそう。']
};
const fmt = t => isFinite(t) ? t.toFixed(2) + '秒' : '—';
const signed = d => (d < 0 ? '−' : '+') + Math.abs(d).toFixed(2) + '秒';
const ic = id => `<svg class="ic"><use href="#i-${id}"/></svg>`;
// I-11 "なぜ？" diagrams, shown only after a loss (企画書: 説明は結果の後)
const explain = (file, alt) => `<img class="explain" src="assets/explain/${file}.svg" alt="${alt}の図解" width="320" height="200" loading="lazy">`;
function explainLoss(l, diff) {
  if (diff < 0.05) return explain('06-photo-finish', '僅差の判定');
  if (l.ball === 'hollow' || l.ball === 'ring') return explain('03-rolling-inertia', '回転慣性');
  if (l.ball === 'ice') return explain('04-friction', '摩擦の影響');
  return l.id === 'l1' ? explain('01-early-acceleration', '序盤の加速') : explain('02-distance-tradeoff', '距離と時間');
}
function finishRace() {
  const l = lv(), p = race.player, r = race.entries.find(e => e.kind === 'rival'), fr = race.entries.find(e => e.kind === 'friend');
  mode = 'edit'; const res = $('result'), unlockedBefore = progress.unlocked;
  SFX.shutter(); SFX.music('edit');
  if (!raced) { raced = true; SFX.enableMusic(); loadScenery(); }
  let jingle = 'lose', pb = false;
  if (l.kind === 'predict') {
    const right = race.choice === 'B';
    jingle = right ? 'win' : 'lose';
    res.innerHTML = `<div class="card"><p class="label">結果</p><p class="verdict ${right ? 'win' : 'lose'}">${right ? '正解！' : 'ハズレ！'} 遠回りのBが勝ち</p>
      <div class="times"><span>A 直線</span><span>${fmt(r.sim.time)}</span><span>B カーブ</span><span>${fmt(p.sim.time)}</span></div>
      <p class="why"><b>なぜ？</b> Bは最初に深く落ちるので、早い段階でスピードが乗ります。距離は長くても、平均の速さで直線を上回ります。</p>${explain('01-early-acceleration', '序盤の加速')}
      <div class="row"><button class="btn go" id="nx">自分で軌道を作る ${ic('next')}</button><button class="btn" id="sh">${ic('share')}出題する</button></div></div>`;
    progress.unlocked = Math.max(progress.unlocked, 2); store.set('gr-progress', progress);
    $('nx').onclick = () => setLevel(1);
    lastShare = { text: `GRAVITY RACE\n直線と遠回りのカーブ、先にゴールするのはどっち？\n私は${right ? '正解' : 'ハズレ'}でした`, url: location.href.split('#')[0], card: null };
  } else if (!p.sim.ok) {
    const [t1, t2] = FAIL_TEXT[p.sim.fail];
    const i = p.sim.failIdx; highlight = [Math.max(0, i - 12), Math.min(p.tr.pts.length - 1, i + 12)];
    lastShare = null;
    res.innerHTML = `<div class="card"><p class="label">結果</p><p class="verdict lose">${t1}</p><p class="why">${t2}</p>${p.sim.fail === 'fly' ? explain('05-launch', 'コースアウト') : ''}${dailyBlock()}</div>`;
  } else {
    const diff = p.sim.time - r.sim.time, win = diff < 0;
    const prev = progress.best[l.id];
    if (!prev || p.sim.time < prev.time) { progress.best[l.id] = { time: p.sim.time, pins: pins.map(q => q.slice()) }; pb = !!prev; }
    if (win && l.kind !== 'daily') progress.unlocked = Math.max(progress.unlocked, L + 2);
    if (l.kind === 'daily' && (!daily.best || p.sim.time < daily.best)) { daily.best = p.sim.time; daily.bestTry = daily.used; daily.bestPins = pins.map(q => q.slice()); store.set('gr-daily', daily); }
    store.set('gr-progress', progress);
    if (!win) highlight = slowZone(p, r);
    jingle = win ? 'win' : 'lose';
    lastShare = shareFor(l, p.sim.time, diff);
    const next = LEVELS[L + 1], fdiff = fr && fr.sim.ok ? p.sim.time - fr.sim.time : null;
    res.innerHTML = `<div class="card"><p class="label">写真判定</p>
      <p class="verdict ${win ? 'win' : 'lose'}">${win ? '勝ち！' : 'あと ' + diff.toFixed(2) + '秒'}</p>
      <div class="times"><span>あなた（${BALLS[l.ball].name}）</span><span>${fmt(p.sim.time)}</span><span>${l.rival.name}（${BALLS[l.rival.ball].name}）</span><span>${fmt(r.sim.time)}</span>
      ${fr ? `<span>友達のゴースト</span><span>${fmt(fr.sim.time)}</span>` : ''}
      ${pb || !prev ? '<span>自己ベスト更新</span><span>✓</span>' : ''}${p.sim.jumps ? `<span>ジャンプ</span><span>${p.sim.jumps}回</span>` : ''}</div>
      ${fdiff !== null ? `<p class="why"><b>${fdiff < 0 ? '友達に勝ち！' : '友達まで ' + fdiff.toFixed(2) + '秒'}</b></p>` : ''}
      ${win ? '' : `<p class="why"><b>なぜ？</b> 赤い区間でいちばん差がつきました。${l.hint}</p>${explainLoss(l, diff)}`}
      <div class="row"><button class="btn go" id="sh">${ic('share')}挑戦状を送る</button>
      ${l.kind === 'daily' ? `<button class="btn" id="copy">${ic('copy')}コピー</button>` : ''}
      ${win && next && l.kind !== 'daily' ? `<button class="btn" id="nx">次のステージ ${ic('next')}</button>` : ''}</div>
      ${dailyBlock(false)}</div>`;
    if ($('nx')) $('nx').onclick = () => setLevel(L + 1);
  }
  race = null; $('clock').innerHTML = (p.sim.ok ? p.sim.time.toFixed(2) : '--.--') + '<small>秒</small>';
  setTimeout(() => { SFX[jingle](); if (pb) setTimeout(SFX.best, 900); if (progress.unlocked > unlockedBefore) setTimeout(SFX.unlock, 1500); }, 180);
  renderLevels(); renderDock(); bindShare(); invalidate(true);
}
function shareFor(l, time, diff) {
  if (l.kind === 'daily') {
    const ghost = simulate(buildTrack(l.rival.ctrl), BALLS[l.rival.ball]).time, best = daily.best ?? time;
    return { text: `GRAVITY RACE #${DAILY_NO} ${best.toFixed(2)}秒\n3回中${daily.bestTry}回目 · 世界ゴースト比 ${signed(best - ghost)}`,
             url: linkFor(l, daily.bestPins || pins), card: { head: `DAILY #${DAILY_NO}`, time: best, sub: `世界ゴースト比 ${signed(best - ghost)} · 3回中${daily.bestTry}回目` } };
  }
  const name = `Lv${L}「${l.title}」`;
  return { text: `GRAVITY RACE ${name} ${time.toFixed(2)}秒\n${l.rival.name}に${diff < 0 ? signed(diff) + 'で勝ち' : 'あと' + diff.toFixed(2) + '秒'}。この軌道に勝てる？`,
           url: linkFor(l, pins), card: { head: name, time, sub: `${l.rival.name}比 ${signed(diff)} · ${BALLS[l.ball].name}` } };
}
function dailyBlock(buttons = true) {
  const l = lv(); if (l.kind !== 'daily') return '';
  const left = 3 - daily.used;
  if (left > 0) return `<p class="why">残り <b>${left}回</b>。ピンを直して、もう一度。</p>`;
  if (!daily.best) return '<p class="why">今日の挑戦は終了。また明日。</p>';
  lastShare = shareFor(l, daily.best, 0);
  return `<p class="label">今日の結果</p><pre class="share" id="share">${lastShare.text}</pre>
    ${buttons ? `<div class="row"><button class="btn go" id="sh">${ic('share')}シェア</button><button class="btn" id="copy">${ic('copy')}コピー</button></div>` : ''}`;
}

// ---------- sharing (I-03 share card + ghost link) ----------
let cardBase = null, cardBlob = null;
function loadCardBase() {
  if (!cardBase) { cardBase = new Image(); cardBase.src = 'assets/share-card.png'; }
  return cardBase.decode().then(() => cardBase, () => null);
}
async function renderCard(info) {
  // the base image is fixed; the result is drawn into its empty left panel (x 64–584, y 160–520)
  const img = await loadCardBase(), c = document.createElement('canvas');
  c.width = 1200; c.height = 630;
  const x = c.getContext('2d');
  if (img) x.drawImage(img, 0, 0); else { x.fillStyle = '#111c33'; x.fillRect(0, 0, 1200, 630); }
  const disp = getComputedStyle(document.body).fontFamily, num = getComputedStyle(document.documentElement).getPropertyValue('--f-num');
  // the base carries "DAILY CHALLENGE" and a "--.-- s" placeholder: cover both with the panel colour (data panel x 471–1075, y 276–510)
  x.font = `700 26px ${disp}`;
  const hw = Math.max(270, x.measureText(info.head).width + 36);
  x.fillStyle = '#13263d'; x.strokeStyle = '#3b6585'; x.lineWidth = 2;
  x.beginPath(); x.roundRect(476, 180, hw, 42, 21); x.fill(); x.stroke();
  x.fillStyle = '#75e7b5'; x.fillText(info.head, 494, 210, hw - 36);
  x.fillStyle = '#13263d'; x.fillRect(490, 336, 570, 160);
  const tt = info.time.toFixed(2);
  x.fillStyle = '#ffffff'; x.font = `500 104px ${num}`; x.fillText(tt, 502, 432, 420);
  const tw = Math.min(420, x.measureText(tt).width);
  x.font = `700 36px ${disp}`; x.fillText('秒', 502 + tw + 10, 432);
  x.fillStyle = '#a9c6db'; x.font = `500 24px ${disp}`; x.fillText(info.sub, 506, 482, 540);
  return new Promise(res => { try { c.toBlob(b => res(b), 'image/png'); } catch (e) { res(null); } }); // tainted on file://
}
async function share() {
  const s = lastShare; if (!s) return;
  const data = { title: 'GRAVITY RACE', text: s.text, url: s.url };
  if (cardBlob) {
    const f = new File([cardBlob], 'gravity-race.png', { type: 'image/png' });
    if (navigator.canShare && navigator.canShare({ files: [f] })) data.files = [f];
  }
  if (navigator.share) {
    try { await navigator.share(data); return; } catch (e) { if (e.name === 'AbortError') return; }
  }
  copyText(s.text + '\n' + s.url, $('sh'));
}
function copyText(t, btn) {
  const done = () => { SFX.copy(); btn.lastChild.textContent = 'コピーしました'; };
  const fallback = () => { const pre = $('share'); if (pre) { const r = document.createRange(); r.selectNodeContents(pre); const s = getSelection(); s.removeAllRanges(); s.addRange(r); } btn.lastChild.textContent = '長押しでコピー'; };
  try { navigator.clipboard.writeText(t).then(done, fallback); } catch (e) { fallback(); }
}
function bindShare() {
  cardBlob = null;
  const sh = $('sh'), cp = $('copy');
  if (sh) sh.onclick = share;
  if (cp) cp.onclick = () => copyText(lastShare.text + '\n' + lastShare.url, cp);
  // pre-render the card so the share sheet opens inside the tap's user activation
  if (sh && lastShare && lastShare.card) {
    const s = lastShare;
    renderCard(s.card).then(b => {
      if (s !== lastShare || !b) return;
      cardBlob = b;
      const row = sh.parentElement;
      if (!navigator.canShare || !navigator.canShare({ files: [new File([b], 'g.png', { type: 'image/png' })] })) {
        const a = document.createElement('a'); a.className = 'btn'; a.download = 'gravity-race.png'; a.href = URL.createObjectURL(b);
        a.innerHTML = `${ic('image')}<span>画像を保存</span>`; row.appendChild(a);
      }
    });
  }
}

// ---------- I-04 finger guide: shown on the first pin until the player drags one ----------
function placeGuide() {
  const g = $('guide'), l = lv();
  const show = !settings.guided && mode === 'edit' && l.pins && pins.length;
  g.hidden = !show; if (!show) return;
  const q = ortho(pins[0][0], pins[0][1]);
  g.style.left = q[0] + 'px'; g.style.top = q[1] + 'px';
}
function hideGuide() { $('guide').hidden = true; }

// ---------- UI ----------
function renderLevels() {
  $('levels').innerHTML = LEVELS.map((l, i) => {
    const locked = i >= progress.unlocked && l.kind !== 'daily';
    const name = l.kind === 'predict' ? '予想' : l.kind === 'daily' ? 'デイリー' : 'Lv' + i;
    return `<button class="lv" data-i="${i}" ${locked ? 'disabled aria-label="' + name + '（ロック中）"' : ''} aria-current="${i === L}">${locked ? ic('lock') : ''}${name}</button>`;
  }).join('');
  $('levels').querySelectorAll('.lv').forEach(b => b.onclick = () => setLevel(+b.dataset.i));
}
function renderMeta() {
  const l = lv();
  $('title').textContent = l.kind === 'daily' ? `デイリー #${DAILY_NO}` : l.title;
  if (l.kind === 'predict') {
    $('meta').innerHTML = `<span>同じ高さから同時にスタート。先にゴールするのは？</span>`;
    $('tip').textContent = 'A：距離が短い直線　B：遠回りのカーブ';
    return;
  }
  const rt = simulate(buildTrack(l.rival.ctrl), BALLS[l.rival.ball]).time;
  const b = progress.best[l.id], fr = friend && friend.idx === L ? simulate(buildTrack(ctrlOf(l, friend.pins)), BALLS[l.ball], l.gate).time : null;
  $('meta').innerHTML = `<span>ボール <b>${BALLS[l.ball].name}</b></span>
    <span><i class="dot" style="background:var(--cobalt)"></i>${l.rival.name} <b>${rt.toFixed(2)}秒</b></span>
    ${fr !== null ? `<span><i class="dot" style="background:var(--friend)"></i>友達 <b>${fmt(fr)}</b></span>` : ''}
    ${b ? `<span><i class="dot" style="background:var(--muted)"></i>自己ベスト <b>${b.time.toFixed(2)}秒</b></span>` : ''}
    ${l.kind === 'daily' ? `<span>挑戦 <b>${daily.used}/3</b></span>` : ''}`;
  $('tip').textContent = l.gate ? 'ピンをドラッグ。金色の輪を通してゴールへ' : 'ピンをドラッグ。線の色は速さ（緑ほど速い）。青い点線はライバル、金色の点線はジャンプ';
}
function renderDock() {
  const l = lv(), d = $('dock'), busy = mode === 'race';
  if (l.kind === 'predict') {
    d.innerHTML = `<button class="btn alt" id="pa" ${busy ? 'disabled' : ''}>A 直線</button><button class="btn go" id="pb" ${busy ? 'disabled' : ''}>B カーブ</button>`;
    $('pa').onclick = () => startRace('A'); $('pb').onclick = () => startRace('B');
    return;
  }
  const out = l.kind === 'daily' && daily.used >= 3;
  d.innerHTML = `<button class="btn" id="rs" ${busy ? 'disabled' : ''}>${ic('undo')}ピンを戻す</button><button class="btn go" id="go" ${busy || out ? 'disabled' : ''}>${out ? '今日の挑戦は終了' : ic('play') + 'スタート'}</button>`;
  $('rs').onclick = () => { pins = l.pins.map(p => p.slice()); highlight = null; invalidate(true); placeGuide(); };
  $('go').onclick = () => startRace();
  renderMeta();
}
function setLevel(i) {
  L = i; const l = lv();
  pins = [];
  if (l.pins) { const bp = progress.best[l.id]; pins = (bp && bp.pins && bp.pins.length === l.pins.length ? bp.pins : l.pins).map(p => p.slice()); }
  mode = 'edit'; race = null; camT = 0; highlight = null; lastShare = null;
  SFX.rollStop(); SFX.muffle(false); SFX.music('edit'); setCount(''); $('slow').hidden = true;
  $('result').innerHTML = ''; $('clock').innerHTML = '0.00<small>秒</small>'; $('speed').textContent = '';
  const db = dailyBlock();
  if (db) $('result').innerHTML = `<div class="card">${db}</div>`;
  renderLevels(); renderMeta(); renderDock(); bindShare(); invalidate(true); placeGuide();
}
function renderSound() {
  const b = $('sound'), on = !SFX.muted;
  b.setAttribute('aria-pressed', on); b.innerHTML = `${ic(on ? 'vol' : 'mute')}<span>音 ${on ? 'ON' : 'OFF'}</span>`;
}

// ---------- pin dragging ----------
function pt(e) { const r = cv.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; }
let tickKey = null;
cv.addEventListener('pointerdown', e => {
  if (mode !== 'edit' || !lv().pins) return;
  const [px, py] = pt(e); let bi = -1, bd = 34;
  pins.forEach((p, i) => { const q = ortho(p[0], p[1]); const d = Math.hypot(q[0] - px, q[1] - py); if (d < bd) { bd = d; bi = i; } });
  if (bi < 0) return;
  picked = bi; cv.setPointerCapture(e.pointerId); cv.style.cursor = 'grabbing'; e.preventDefault();
  tickKey = Math.round(pins[bi][1] * 10) + ':' + Math.round(pins[bi][0] * 10);
  SFX.grab(); invalidate();
  if (!settings.guided) { settings.guided = true; saveSettings(); hideGuide(); }
});
cv.addEventListener('pointermove', e => {
  if (picked === null) return;
  const [px, py] = pt(e), [wx, wy] = invOrtho(px, py);
  pins[picked] = clampPin(lv(), pins, picked, wx, wy);
  const key = Math.round(pins[picked][1] * 10) + ':' + Math.round(pins[picked][0] * 10);
  if (key !== tickKey) { tickKey = key; SFX.tick(); }   // S-17 ratchet every 0.1 m
  highlight = null; invalidate(true);
});
const drop = () => { if (picked === null) return; picked = null; cv.style.cursor = 'grab'; SFX.release(); invalidate(); };
cv.addEventListener('pointerup', drop); cv.addEventListener('pointercancel', drop);

// ---------- boot ----------
document.addEventListener('click', e => { const b = e.target.closest('button'); if (b && !b.disabled && b.id !== 'sound') SFX.tap(); });  // S-18
$('sound').onclick = () => { settings.muted = !SFX.muted; saveSettings(); SFX.setMuted(settings.muted); if (raced) SFX.enableMusic(); renderSound(); SFX.tap(); };
SFX.setMuted(settings.muted); renderSound();
if (!settings.muted) {
  // browsers only start audio inside a gesture: resume on the first touch
  const wake = () => { SFX.setMuted(false); if (raced) SFX.enableMusic(); removeEventListener('pointerdown', wake); };
  addEventListener('pointerdown', wake);
}
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', readColors);
window.addEventListener('resize', resize);
window.addEventListener('hashchange', () => location.reload());
if (document.fonts) document.fonts.ready.then(readColors);

readColors(); resize();
const link = readLink();
setLevel(link ? link.idx : 0);
if (link && link.stale) {
  $('result').innerHTML = `<div class="card"><p class="notice">このリンクのデイリーは終了しました。今日のコースに挑戦しよう。</p>${dailyBlock()}</div>`; bindShare();
} else if (link) {
  friend = { idx: link.idx, pins: link.pins };
  if (link.idx !== DAILY_IDX) { progress.unlocked = Math.max(progress.unlocked, link.idx + 1); store.set('gr-progress', progress); }
  setLevel(link.idx);
  $('result').insertAdjacentHTML('afterbegin', '<div class="card"><p class="notice">友達のゴースト（紫）と同時にスタートします。</p></div>');
}
addEventListener('load', () => (window.requestIdleCallback || setTimeout)(loadRaceArt));
requestAnimationFrame(tick);
