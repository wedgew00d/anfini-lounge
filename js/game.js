// ANFINI LOUNGE — 暖炉のある談話室を主観視点で歩くプロトタイプ
// 素材はすべてコードで生成（three.js r170）。
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { FXAAShader } from 'three/addons/shaders/FXAAShader.js';
import { createAudio } from './audio.js';
const audio = createAudio();

let DEBUG = location.hash === '#debug';
const COARSE = matchMedia('(pointer:coarse)').matches;
const $ = id => document.getElementById(id);
const canvas = $('view');
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const TAU = Math.PI * 2;

// ---------------------------------------------------------------- renderer
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.22;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.shadowMap.autoUpdate = false;
renderer.info.autoReset = false;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x02030a);
const camera = new THREE.PerspectiveCamera(66, 1, 0.05, 700);
camera.rotation.order = 'YXZ';

// ---------------------------------------------------------------- helpers
let seed = 20261119;
const rnd = () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
const rr = (a, b) => a + rnd() * (b - a);

function mkTex(c, srgb = true, repeat) {
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(repeat[0], repeat[1]); }
  return t;
}
function canvasTex(w, h, draw, { srgb = true, repeat } = {}) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  return mkTex(c, srgb, repeat);
}
// 色と「粗さ(G)・金属(B)」を同じ手順で2枚に描く
function dualTex(w, h, draw, { repeat } = {}) {
  const a = document.createElement('canvas'), b = document.createElement('canvas'); a.width = b.width = w; a.height = b.height = h;
  draw(a.getContext('2d'), b.getContext('2d'), w, h);
  return { map: mkTex(a, true, repeat), orm: mkTex(b, false, repeat) };
}
const orm = (r, m = 0) => `rgb(0,${Math.round(r * 255)},${Math.round(m * 255)})`;
function mesh(geo, mat, parent, x = 0, y = 0, z = 0, shadow = true) {
  const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z);
  if (shadow && mat.isMeshStandardMaterial && !mat.transparent) { m.castShadow = true; m.receiveShadow = true; }
  parent.add(m); return m;
}
const box = (p, w, h, d, x, y, z, mat, sh) => mesh(new THREE.BoxGeometry(w, h, d), mat, p, x, y, z, sh);
const rbox = (p, w, h, d, x, y, z, mat, r = 0.02, sh) => mesh(new RoundedBoxGeometry(w, h, d, 4, r), mat, p, x, y, z, sh);
const cyl = (p, rt, rb, h, x, y, z, mat, seg = 32, sh) => mesh(new THREE.CylinderGeometry(rt, rb, h, seg), mat, p, x, y, z, sh);
const lathe = (p, pts, x, y, z, mat, seg = 32, sh) => mesh(new THREE.LatheGeometry(pts.map(q => new THREE.Vector2(q[0], q[1])), seg), mat, p, x, y, z, sh);

// ---------------------------------------------------------------- painters
function woodGrain(c, o, x, y, w, h, { tone = [46, 16, 10], rough = .4, vert = true, dens = 1 } = {}) {
  c.save(); c.beginPath(); c.rect(x, y, w, h); c.clip();
  c.fillStyle = `rgb(${tone[0]},${tone[1]},${tone[2]})`; c.fillRect(x, y, w, h);
  const span = vert ? w : h, len = vert ? h : w, n = Math.round(span * .55 * dens);
  for (let i = 0; i < n; i++) {
    const p = rnd() * span, dark = rnd() < .62, ph = rnd() * 9, amp = rr(1, 7), fq = rr(.004, .013);
    c.strokeStyle = dark ? `rgba(6,1,0,${rr(.05, .22)})` : `rgba(${tone[0] * 3.2},${tone[1] * 3.4},${tone[2] * 3},${rr(.04, .14)})`;
    c.lineWidth = rr(.6, 2.6); c.beginPath();
    for (let t = 0; t <= len; t += 24) { const q = p + Math.sin(t * fq + ph) * amp; vert ? (t ? c.lineTo(x + q, y + t) : c.moveTo(x + q, y + t)) : (t ? c.lineTo(x + t, y + q) : c.moveTo(x + t, y + q)); }
    c.stroke();
  }
  c.restore();
  o.fillStyle = orm(rough); o.fillRect(x, y, w, h);
}
const GOLD = '#e0b45c';
function gold(c, o, pts, lw = 3, close = false) {
  const path = (g, dx = 0, dy = 0) => { g.beginPath(); pts.forEach((p, i) => i ? g.lineTo(p[0] + dx, p[1] + dy) : g.moveTo(p[0] + dx, p[1] + dy)); if (close) g.closePath(); g.stroke(); };
  c.lineJoin = o.lineJoin = 'miter'; c.lineCap = o.lineCap = 'butt';
  c.lineWidth = lw; c.strokeStyle = 'rgba(0,0,0,.55)'; path(c, 1, 1.6);
  c.strokeStyle = GOLD; path(c);
  o.lineWidth = lw; o.strokeStyle = orm(.26, 1); path(o);
}
const rectPts = (x, y, w, h) => [[x, y], [x + w, y], [x + w, y + h], [x, y + h]];
// 角を段にした矩形（アールデコの額）
function stepRect(x, y, w, h, s) { return [[x + s, y], [x + w - s, y], [x + w - s, y + s], [x + w, y + s], [x + w, y + h - s], [x + w - s, y + h - s], [x + w - s, y + h], [x + s, y + h], [x + s, y + h - s], [x, y + h - s], [x, y + s], [x + s, y + s]]; }
function bevel(c, x, y, w, h, d = 5) {
  c.lineWidth = d; c.strokeStyle = 'rgba(0,0,0,.6)'; c.beginPath(); c.moveTo(x, y + h); c.lineTo(x, y); c.lineTo(x + w, y); c.stroke();
  c.strokeStyle = 'rgba(255,170,110,.13)'; c.beginPath(); c.moveTo(x + w, y); c.lineTo(x + w, y + h); c.lineTo(x, y + h); c.stroke();
  c.lineWidth = 1.5; c.strokeStyle = 'rgba(0,0,0,.5)'; c.strokeRect(x + d + 5, y + d + 5, w - 2 * d - 10, h - 2 * d - 10);
}
// 壁モジュール（幅 約1.6m × 高さ3.3m）
const WH = 3.3;
function wallModule(variant) {
  return dualTex(640, 1408, (c, o, w, h) => {
    const ppm = h / WH, Y = m => h - m * ppm;
    woodGrain(c, o, 0, 0, w, h, { tone: [44, 19, 12], rough: .44 });
    // 腰板
    const wx = 44, wy = Y(.9), ww = w - 88, wh = Y(.2) - Y(.9);
    woodGrain(c, o, wx, wy, ww, wh, { tone: [58, 26, 16], rough: .34 }); bevel(c, wx, wy, ww, wh, 6);
    gold(c, o, rectPts(wx + 26, wy + 26, ww - 52, wh - 52), 2.5, true);
    // 上のパネル
    const px = 36, py = Y(3.02), pw = w - 72, ph = Y(1.04) - Y(3.02);
    woodGrain(c, o, px, py, pw, ph, { tone: [66, 29, 17], rough: .3 }); bevel(c, px, py, pw, ph, 7);
    const cx = w / 2, x0 = px + 34, x1 = px + pw - 34, y0 = py + 34, y1 = py + ph - 34;
    gold(c, o, rectPts(x0, y0, x1 - x0, y1 - y0), 3, true);
    if (variant === 0) {
      // 重なった山形と縦線
      for (let k = 0; k < 4; k++) { const a = 58 + k * 50, t = y0 + 46 + k * 34; gold(c, o, [[cx - a, y1 - 30 - k * 26], [cx - a, t + a * 1.15], [cx, t], [cx + a, t + a * 1.15], [cx + a, y1 - 30 - k * 26]], 3); }
      gold(c, o, [[cx, y0 + 140], [cx, y1 - 30]], 3);
      for (let k = 0; k < 4; k++) gold(c, o, [[cx - 58 - k * 50, y1 - 30 - k * 26], [cx + 58 + k * 50, y1 - 30 - k * 26]], 2.5);
      gold(c, o, [[x0 + 20, y0 + 20], [x0 + 20, y0 + 110], [x0 + 60, y0 + 20]], 2.5, true); gold(c, o, [[x1 - 20, y0 + 20], [x1 - 20, y0 + 110], [x1 - 60, y0 + 20]], 2.5, true);
    } else {
      gold(c, o, stepRect(x0 + 34, y0 + 34, x1 - x0 - 68, y1 - y0 - 68, 30), 3, true);
      gold(c, o, stepRect(x0 + 78, y0 + 78, x1 - x0 - 156, y1 - y0 - 156, 30), 2.5, true);
      const my = (y0 + y1) / 2, d = 74;
      gold(c, o, [[cx, my - d * 2.1], [cx + d, my], [cx, my + d * 2.1], [cx - d, my]], 3, true);
      gold(c, o, [[cx, my - d * 1.3], [cx + d * .62, my], [cx, my + d * 1.3], [cx - d * .62, my]], 2.5, true);
      gold(c, o, [[cx, y0 + 78], [cx, my - d * 2.1]], 2.5); gold(c, o, [[cx, y1 - 78], [cx, my + d * 2.1]], 2.5);
    }
  });
}
function marble(dark) {
  return dualTex(1024, 1024, (c, o, w, h) => {
    c.fillStyle = dark ? '#0d0e11' : '#cfcbc5'; c.fillRect(0, 0, w, h);
    for (let i = 0; i < 160; i++) { const x = rnd() * w, y = rnd() * h, r = rr(40, 220), g = c.createRadialGradient(x, y, 0, x, y, r), v = dark ? (rnd() < .5 ? '60,62,70' : '0,0,0') : (rnd() < .55 ? '110,108,112' : '255,255,255'); g.addColorStop(0, `rgba(${v},${rr(.05, .2)})`); g.addColorStop(1, `rgba(${v},0)`); c.fillStyle = g; c.fillRect(x - r, y - r, 2 * r, 2 * r); }
    const vein = (col, n, lw) => { for (let i = 0; i < n; i++) { let x = rnd() * w, y = rnd() * h, a = rnd() * TAU; const steps = rr(30, 90) | 0; c.strokeStyle = col(rr(.2, .75)); c.lineWidth = rr(.5, lw); c.beginPath(); c.moveTo(x, y); for (let s = 0; s < steps; s++) { a += rr(-.5, .5); x += Math.cos(a) * 14; y += Math.sin(a) * 14; c.lineTo(x, y); if (rnd() < .06) { c.stroke(); c.lineWidth = rr(.4, lw * .6); c.beginPath(); c.moveTo(x, y); } } c.stroke(); } };
    c.filter = 'blur(1.2px)'; vein(a => dark ? `rgba(225,225,230,${a * .7})` : `rgba(70,68,78,${a * .55})`, dark ? 34 : 20, dark ? 4.5 : 6); c.filter = 'none';
    vein(a => `rgba(200,160,80,${a * .6})`, 7, 2.2);
    o.fillStyle = orm(dark ? .16 : .1); o.fillRect(0, 0, w, h);
  });
}

// ---------------------------------------------------------------- textures
const texWeave = canvasTex(128, 128, (g, w, h) => {
  const id = g.createImageData(w, h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const v = 128 + ((x + y) % 4 < 2 ? 40 : -40) * ((x - y + 400) % 4 < 2 ? 1 : .4) + rnd() * 50 - 25; const i = (y * w + x) * 4; id.data[i] = id.data[i + 1] = id.data[i + 2] = v; id.data[i + 3] = 255; }
  g.putImageData(id, 0, 0);
}, { srgb: false, repeat: [8, 8] });
const texPile = canvasTex(128, 128, (g, w, h) => { const id = g.createImageData(w, h); for (let i = 0; i < w * h; i++) { const v = 100 + rnd() * 110; id.data[i * 4] = id.data[i * 4 + 1] = id.data[i * 4 + 2] = v; id.data[i * 4 + 3] = 255; } g.putImageData(id, 0, 0); }, { srgb: false, repeat: [6, 6] });
// ボタン留め（キルティング）の凹凸
const texTuft = canvasTex(256, 256, (g, w, h) => {
  g.fillStyle = '#b4b4b4'; g.fillRect(0, 0, w, h);
  g.strokeStyle = 'rgba(40,40,40,.55)'; g.lineWidth = 5; g.filter = 'blur(3px)';
  for (let k = -2; k <= 2; k++) { g.beginPath(); g.moveTo(k * 128, 0); g.lineTo(k * 128 + 256, 256); g.moveTo(k * 128 + 256, 0); g.lineTo(k * 128, 256); g.stroke(); }
  g.filter = 'none';
  for (const [x, y] of [[0, 0], [128, 0], [256, 0], [64, 128], [192, 128], [0, 256], [128, 256], [256, 256]]) { const gr = g.createRadialGradient(x, y, 0, x, y, 30); gr.addColorStop(0, 'rgba(0,0,0,.95)'); gr.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = gr; g.fillRect(x - 30, y - 30, 60, 60); }
}, { srgb: false, repeat: [5, 1.5] });
const texWood = dualTex(512, 512, (c, o, w, h) => woodGrain(c, o, 0, 0, w, h, { tone: [56, 25, 15], rough: .36 }));
const texWoodH = dualTex(512, 512, (c, o, w, h) => woodGrain(c, o, 0, 0, w, h, { tone: [50, 22, 13], rough: .38, vert: false }));
const texMarble = marble(false), texMarbleD = marble(true);
const wallTex = [wallModule(0), wallModule(1)];
// ヘリンボーンの床（板 1×5、周期 10 マス）
const texFloor = dualTex(1000, 1000, (c, o, w, h) => {
  const n = 5, u = w / (2 * n), plank = (x, y, pw, ph) => {
    const t = rr(.75, 1.25), tone = [44 * t, 21 * t, 13 * t];
    for (const ox of [-w, 0, w]) for (const oy of [-h, 0, h]) {
      const X = x * u + ox, Yy = y * u + oy; if (X > w || Yy > h || X + pw * u < 0 || Yy + ph * u < 0) continue;
      const s = seed; woodGrain(c, o, X, Yy, pw * u, ph * u, { tone, rough: rr(.22, .36), vert: ph > pw, dens: .5 }); seed = s;
      c.strokeStyle = 'rgba(0,0,0,.8)'; c.lineWidth = 2; c.strokeRect(X + .5, Yy + .5, pw * u - 1, ph * u - 1);
      o.strokeStyle = orm(.7); o.lineWidth = 2; o.strokeRect(X + .5, Yy + .5, pw * u - 1, ph * u - 1);
    }
    rnd();
  };
  for (let k = 0; k < 2 * n; k++) { plank(k, k, n, 1); plank(k, (k + 1) % (2 * n), 1, n); }
});
// 絨毯
const texRug = canvasTex(1280, 880, (c, w, h) => {
  c.fillStyle = '#4f0a11'; c.fillRect(0, 0, w, h);
  const G = '#c2924a', CR = '#d9c08c', DK = '#2a0508', NV = '#16142a';
  const band = (m, lw, col) => { c.strokeStyle = col; c.lineWidth = lw; c.strokeRect(m, m, w - 2 * m, h - 2 * m); };
  c.fillStyle = DK; c.fillRect(22, 22, w - 44, h - 44); c.fillStyle = '#5a0c13'; c.fillRect(104, 104, w - 208, h - 208);
  band(22, 4, G); band(34, 2, CR); band(98, 3, G); band(108, 2, CR);
  const rosette = (x, y, r, p = 8, col = G, col2 = CR) => { for (let i = 0; i < p; i++) { const a = i * TAU / p; c.fillStyle = col; c.beginPath(); c.ellipse(x + Math.cos(a) * r * .55, y + Math.sin(a) * r * .55, r * .5, r * .22, a, 0, TAU); c.fill(); } c.fillStyle = col2; c.beginPath(); c.arc(x, y, r * .22, 0, TAU); c.fill(); };
  const curl = (x, y, r, a, col = G) => { c.strokeStyle = col; c.lineWidth = 2.4; c.beginPath(); for (let t = 0; t < 1; t += .04) { const ang = a + t * 4.6, rad = r * (1 - t * .85); const px = x + Math.cos(ang) * rad, py = y + Math.sin(ang) * rad; t ? c.lineTo(px, py) : c.moveTo(px, py); } c.stroke(); };
  // 縁の連続模様
  for (let x = 66; x < w - 40; x += 44) for (const y of [66, h - 66]) { rosette(x, y, 15, 6); c.fillStyle = NV; c.fillRect(x + 19, y - 3, 6, 6); }
  for (let y = 110; y < h - 100; y += 44) for (const x of [66, w - 66]) { rosette(x, y, 15, 6); c.fillStyle = NV; c.fillRect(x - 3, y + 19, 6, 6); }
  // 地の模様：4分の1を描いて鏡映
  const quad = () => {
    for (let i = 0; i < 46; i++) { const x = rr(20, w / 2 - 130), y = rr(20, h / 2 - 130), d = Math.hypot(x / (w / 2), y / (h / 2)); if (d < .34) continue; const k = rnd(); if (k < .4) rosette(x, y, rr(9, 20), rnd() < .5 ? 8 : 5, rnd() < .7 ? G : CR, rnd() < .5 ? NV : DK); else if (k < .8) curl(x, y, rr(14, 34), rnd() * TAU, rnd() < .75 ? G : CR); else { c.fillStyle = CR; c.beginPath(); c.arc(x, y, 3, 0, TAU); c.fill(); } }
    for (let i = 0; i < 9; i++) { const a = i / 8 * Math.PI / 2; curl(Math.cos(a) * 250, Math.sin(a) * 178, 30, a + 1.2, CR); }
    rosette(w / 2 - 190, h / 2 - 190, 46, 10, G, NV); curl(w / 2 - 190, h / 2 - 190, 78, 1, G); curl(w / 2 - 190, h / 2 - 190, 78, 4.1, G);
  };
  for (const [sx, sy] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) { const s = seed; c.save(); c.translate(w / 2, h / 2); c.scale(sx, sy); quad(); c.restore(); if (sx !== -1 || sy !== -1) seed = s; }
  // 中央のメダリオン
  c.save(); c.translate(w / 2, h / 2);
  c.fillStyle = DK; c.beginPath(); c.ellipse(0, 0, 240, 170, 0, 0, TAU); c.fill(); c.strokeStyle = G; c.lineWidth = 4; c.stroke();
  c.fillStyle = '#641018'; c.beginPath(); c.ellipse(0, 0, 200, 138, 0, 0, TAU); c.fill(); c.strokeStyle = CR; c.lineWidth = 2; c.stroke();
  for (let i = 0; i < 16; i++) { const a = i * TAU / 16; c.fillStyle = i % 2 ? G : '#8a6a3a'; c.beginPath(); c.ellipse(Math.cos(a) * 122, Math.sin(a) * 86, 34, 8, Math.atan2(Math.sin(a) * 82, Math.cos(a) * 118), 0, TAU); c.fill(); }
  c.restore(); rosette(w / 2, h / 2, 62, 12, G, NV); rosette(w / 2, h / 2, 30, 8, CR, DK);
  // 毛足のむら
  const id = c.getImageData(0, 0, w, h); for (let i = 0; i < id.data.length; i += 4) { const n = .78 + rnd() * .32; id.data[i] *= n; id.data[i + 1] *= n; id.data[i + 2] *= n; } c.putImageData(id, 0, 0);
});
// 葉（シダ・ユーカリ）
const texFern = canvasTex(96, 512, (c, w, h) => {
  c.strokeStyle = '#3d5a2a'; c.lineWidth = 2.5; c.beginPath(); c.moveTo(w / 2, h); c.lineTo(w / 2, 8); c.stroke();
  for (let i = 0; i < 30; i++) { const y = h - 26 - i * 15.5, L = 44 * Math.pow(Math.sin(Math.PI * (i + 2.5) / 34), .7); for (const s of [-1, 1]) { c.fillStyle = `rgb(${rr(34, 58)},${rr(70, 104)},${rr(30, 48)})`; c.beginPath(); c.ellipse(w / 2 + s * L * .5, y - L * .2, L * .56, 5.2, -s * .42, 0, TAU); c.fill(); } }
});
const texEuc = canvasTex(96, 512, (c, w, h) => {
  c.strokeStyle = '#8a6a30'; c.lineWidth = 3; c.beginPath(); c.moveTo(w / 2, h); c.lineTo(w / 2, 20); c.stroke();
  for (let i = 0; i < 13; i++) { const y = h - 60 - i * 34, r = 20 - i * .7; for (const s of [-1, 1]) { c.fillStyle = `rgb(${rr(170, 215)},${rr(125, 160)},${rr(50, 80)})`; c.beginPath(); c.ellipse(w / 2 + s * (r + 2), y + s * 6, r, r * .82, 0, 0, TAU); c.fill(); } }
});
const texDot = canvasTex(32, 32, c => { const g = c.createRadialGradient(16, 16, 0, 16, 16, 16); g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(1, 'rgba(255,255,255,0)'); c.fillStyle = g; c.fillRect(0, 0, 32, 32); });

// 置き影（接地の暗がり）：丸、角丸の四角、壁際の帯
function shadowTex(kind) {
  return canvasTex(128, 128, (c, w, h) => {
    const id = c.createImageData(w, h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const u = x / (w - 1) * 2 - 1, v = y / (h - 1) * 2 - 1; let a;
      if (kind === 'round') a = 1 - Math.hypot(u, v);
      else if (kind === 'rect') { const qx = Math.max(Math.abs(u) - .5, 0), qy = Math.max(Math.abs(v) - .5, 0); a = 1 - Math.hypot(qx, qy) / .5; }
      else a = (1 - (v + 1) / 2);
      a = clamp(a, 0, 1); a = a * a * (3 - 2 * a); id.data[(y * w + x) * 4 + 3] = a * 255;
    }
    c.putImageData(id, 0, 0);
  });
}
const shTex = { round: shadowTex('round'), rect: shadowTex('rect'), edge: shadowTex('edge') }, shMats = [];
function blob(parent, kind, x, y, z, w, d, op, ry = 0) {
  const mat = new THREE.MeshBasicMaterial({ map: shTex[kind], color: 0x000000, transparent: true, opacity: op, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  mat.userData.op = op; shMats.push(mat);
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d).rotateX(-Math.PI / 2), mat); m.position.set(x, y, z); m.rotation.y = ry; m.renderOrder = 2; parent.add(m); return m;
}

// ---------------------------------------------------------------- materials
const Std = o => new THREE.MeshStandardMaterial(o);
const Phys = o => new THREE.MeshPhysicalMaterial(o);
const Basic = o => new THREE.MeshBasicMaterial(o);
const velvet = (color, sheen, extra = {}) => Phys({ color, roughness: .9, metalness: 0, sheen: .55, sheenColor: new THREE.Color(sheen), sheenRoughness: .42, bumpMap: texPile, bumpScale: .5, ...extra });
const M = {
  wall: [0, 1].map(i => Std({ map: wallTex[i].map, roughnessMap: wallTex[i].orm, metalnessMap: wallTex[i].orm, roughness: 1, metalness: 1 })),
  wood: Std({ map: texWood.map, roughnessMap: texWood.orm, roughness: 1, metalness: 0 }),
  woodH: Std({ map: texWoodH.map, roughnessMap: texWoodH.orm, roughness: 1, metalness: 0 }),
  woodDark: Std({ map: texWoodH.map, roughnessMap: texWoodH.orm, roughness: 1, metalness: 0, color: 0x8a8080 }),
  floor: Std({ map: texFloor.map, roughnessMap: texFloor.orm, roughness: 1, metalness: 0 }),
  marble: Std({ map: texMarble.map, roughness: .1, metalness: 0 }),
  marbleD: Std({ map: texMarbleD.map, roughness: .16, metalness: 0 }),
  gold: Std({ color: 0xe2b055, roughness: .26, metalness: 1 }),
  goldRough: Std({ color: 0xd9a548, roughness: .42, metalness: 1, bumpMap: texWeave, bumpScale: .6 }),
  brass: Std({ color: 0xb98a3c, roughness: .34, metalness: 1 }),
  bronze: Std({ color: 0x241710, roughness: .5, metalness: .8 }),
  mirror: Std({ color: 0xffffff, roughness: .04, metalness: 1 }),
  velvet: velvet(0x74101a, 0xd04050),
  velvetTuft: velvet(0x74101a, 0xd04050, { bumpMap: texTuft, bumpScale: 5 }),
  velvetDeep: velvet(0x5e0a13, 0xa83040),
  curtain: velvet(0x7a0d18, 0xc83848, { side: THREE.DoubleSide }),
  cushRed: velvet(0x8a1420, 0xe05060),
  cushGold: Phys({ color: 0x9a6c22, roughness: .6, metalness: .3, sheen: .35, sheenColor: new THREE.Color(0xd9a850), sheenRoughness: .4, bumpMap: texWeave, bumpScale: .8 }),
  cushAmber: velvet(0x8a4312, 0xc88040),
  throwGold: Phys({ color: 0x74551a, roughness: .7, metalness: .15, sheen: .3, sheenColor: new THREE.Color(0xd9a850), sheenRoughness: .45, side: THREE.DoubleSide, bumpMap: texWeave, bumpScale: .5 }),
  rug: Std({ map: texRug, roughness: 1, metalness: 0, bumpMap: texPile, bumpScale: 1.2 }),
  black: Basic({ color: 0x020202 }),
  iron: Std({ color: 0x0b0b0c, roughness: .6, metalness: .6 }),
  cloth: Std({ color: 0x0a0a0d, roughness: .95, metalness: 0, bumpMap: texWeave, bumpScale: .6 }),
  leather: [0x3a1a10, 0x1f2a22, 0x2b1210, 0x151a2c].map(c => Std({ color: c, roughness: .55, metalness: 0 })),
  ivory: Std({ color: 0xe8dcc0, roughness: .6, metalness: 0, emissive: 0x3a2a14 }),
  ceramic: Std({ color: 0x7f93a6, roughness: .22, metalness: 0 }),
  soil: Std({ color: 0x120c08, roughness: 1 }),
  fern: Std({ map: texFern, alphaTest: .35, side: THREE.DoubleSide, roughness: .65, metalness: 0 }),
  euc: Std({ map: texEuc, alphaTest: .35, side: THREE.DoubleSide, roughness: .45, metalness: .35 }),
  wine: Std({ color: 0x5a0610, roughness: .06, metalness: 0, emissive: 0x3a0206 }),
  flame: Basic({ color: new THREE.Color(3.2, 1.9, .7) }),
  shade: Basic({ color: 0xffffff, side: THREE.DoubleSide }),
  dial: Basic({ color: 0xffffff }),
  glass: Basic({ color: 0x000000, reflectivity: .22, combine: THREE.AddOperation, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }),
  crystal: Std({ color: 0xe4ecf4, roughness: .05, metalness: .92, transparent: true, opacity: .36, depthWrite: false, side: THREE.DoubleSide, envMapIntensity: .9 }),
};
texFloor.map.rotation = texFloor.orm.rotation = Math.PI / 4;

// ---------------------------------------------------------------- room metrics
const X0 = -4.6, X1 = 4.6, Z0 = -4, Z1 = 3.4, ZC = (Z0 + Z1) / 2;
const segs = [], circles = [];
const segW = (ax, az, bx, bz) => { const s = { ax, az, bx, bz, on: true }; segs.push(s); return s; };
const rectW = (x1, z1, x2, z2) => { segW(x1, z1, x2, z1); segW(x2, z1, x2, z2); segW(x2, z2, x1, z2); segW(x1, z2, x1, z1); };
function wallGroup(x, z, ry) { const g = new THREE.Group(); g.position.set(x, 0, z); g.rotation.y = ry; scene.add(g); g.updateMatrixWorld(true); return g; }
const worldOf = (g, x, y, z) => new THREE.Vector3(x, y, z).applyMatrix4(g.matrixWorld);

// 壁の連なり：モジュールの板、付け柱、幅木、腰の見切り、廻り縁
let wallAlt = 0;
function wallRun(g, x0, x1) {
  const L = x1 - x0, n = Math.max(1, Math.round(L / 1.62)), mw = L / n;
  for (let k = 0; k < n; k++) { const m = new THREE.Mesh(new THREE.PlaneGeometry(mw, WH), M.wall[(wallAlt++) % 2]); m.position.set(x0 + mw * (k + .5), WH / 2, 0); m.receiveShadow = true; g.add(m); }
  for (let k = 0; k <= n; k++) { const x = x0 + mw * k; box(g, .11, 2.06, .035, x, 2.03, .017, M.wood); box(g, .018, 2.0, .01, x, 2.03, .04, M.gold, false); box(g, .13, .82, .04, x, .55, .02, M.wood); }
  trims(g, x0, x1);
}
function trims(g, x0, x1) {
  const L = x1 - x0, cx = (x0 + x1) / 2;
  box(g, L, .14, .035, cx, .07, .017, M.woodH); box(g, L, .012, .012, cx, .146, .03, M.gold, false);
  box(g, L, .06, .05, cx, .97, .025, M.woodH);
  box(g, L, .22, .1, cx, WH - .11, .05, M.woodH); box(g, L, .05, .16, cx, WH - .245, .08, M.woodH); box(g, L, .014, .014, cx, WH - .275, .165, M.gold, false);
}

// ---------------------------------------------------------------- shell
function buildShell() {
  const fw = X1 - X0, fd = Z1 - Z0;
  texFloor.map.repeat.set(fw / 1.0, fd / 1.0); texFloor.orm.repeat.copy(texFloor.map.repeat);
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(fw, fd).rotateX(-Math.PI / 2), M.floor); floor.position.set(0, 0, ZC); floor.receiveShadow = true; scene.add(floor);
  // 絨毯と房
  const rug = new THREE.Mesh(new THREE.PlaneGeometry(5.8, 4.0).rotateX(-Math.PI / 2), M.rug); rug.position.set(0, .008, -.75); rug.receiveShadow = true; scene.add(rug);
  const fr = canvasTex(256, 16, (c, w, h) => { for (let x = 0; x < w; x += 3) { c.fillStyle = `rgba(${rr(190, 225)},${rr(165, 190)},${rr(110, 140)},1)`; c.fillRect(x, 0, 1.6, rr(9, 16)); } }, { repeat: [10, 1] });
  for (const s of [-1, 1]) { const f = new THREE.Mesh(new THREE.PlaneGeometry(4.0, .07).rotateX(-Math.PI / 2), Std({ map: fr, alphaTest: .5, roughness: 1 })); f.rotation.y = s * Math.PI / 2; f.position.set(s * 2.935, .006, -.75); scene.add(f); }
  // 天井と梁
  const ceil = new THREE.Mesh(new THREE.PlaneGeometry(fw, fd).rotateX(Math.PI / 2), M.woodDark); ceil.position.set(0, WH, ZC); scene.add(ceil);
  for (const z of [-1.55, .95]) { box(scene, fw, .16, .24, 0, WH - .08, z, M.woodH); box(scene, fw, .012, .03, 0, WH - .164, z, M.gold, false); }
  for (const x of [-1.55, 1.55]) { box(scene, .24, .15, fd, x, WH - .075, ZC, M.wood); box(scene, .03, .012, fd, x, WH - .154, ZC, M.gold, false); }
  // 天井の中心飾り
  for (const [r, t] of [[.9, .016], [.62, .012], [.34, .012]]) mesh(new THREE.TorusGeometry(r, t, 6, 64).rotateX(Math.PI / 2), M.gold, scene, 0, WH - .012, -.3, false);
  rectW(X0, Z0, X1, Z1);
  // 壁際の暗がり
  blob(scene, 'edge', 0, .004, Z0 + .3, fw, .6, .7); blob(scene, 'edge', 0, .004, Z1 - .3, fw, .6, .7, Math.PI);
  blob(scene, 'edge', X0 + .3, .004, ZC, fd, .6, .7, Math.PI / 2); blob(scene, 'edge', X1 - .3, .004, ZC, fd, .6, .7, -Math.PI / 2);
  // 家具の接地
  for (const s of [-1, 1]) blob(scene, 'rect', s * 2.08, .013, -.8, 1.7, 3.1, .7);
  blob(scene, 'rect', 0, .013, -.8, 1.7, 2.3, .5);
  blob(scene, 'rect', X0 + .3, .005, 1.55, 1.1, 2.1, .7);
  blob(scene, 'rect', 0, .045, Z0 + .75, 3.4, 1.1, .5);
}

// ---------------------------------------------------------------- fireplace (north)
const fire = { level: 1, cur: .7, mats: [], light: null, fill: null, embers: null, coals: null, logs: [], liner: null, pos: new THREE.Vector3(0, 0, Z0 + .9) };
const FIRE_FS = `
  precision highp float; varying vec2 vUv; uniform float time, level, seed;
  float hash(vec2 p){ return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453); }
  float noise(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.-2.*f); return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x),f.y); }
  float fbm(vec2 p){ float a=.5,s=0.; for(int i=0;i<4;i++){ s+=a*noise(p); p=p*2.07+3.1; a*=.5; } return s; }
  void main(){
    float x=(vUv.x-.5)*2.; float h=vUv.y/max(level,.05);
    float sway=(fbm(vec2(vUv.y*1.6+seed,time*.7))-.5)*.5*vUv.y;
    float n=fbm(vec2((x+sway)*2.4+seed*3.,vUv.y*2.6-time*1.9));
    float n2=fbm(vec2((x+sway)*5.5+seed,vUv.y*5.-time*3.1));
    float tongues=.35+.65*fbm(vec2(x*3.2+seed*7.,time*.55));
    float body=1.-h*(1.25-tongues*.5)-pow(abs(x+sway),1.6)*(1.3+h*1.2);
    float f=body+(n-.5)*1.25*(.25+h)+(n2-.5)*.4;
    float a=smoothstep(.0,.3,f);
    vec3 col=mix(vec3(.9,.1,.01),vec3(1.,.42,.06),smoothstep(.05,.4,f));
    col=mix(col,vec3(1.,.82,.42),smoothstep(.42,.9,f));
    col*=a*smoothstep(.0,.05,vUv.y)*(1.5+.9*smoothstep(.5,1.,f));
    gl_FragColor=vec4(col,1.);
  }`;
function buildFireplace() {
  const g = wallGroup(0, Z0, 0);
  wallRun(g, X0, -1.4); wallRun(g, 1.4, X1);
  // 煙突の張り出し
  for (const s of [-1, 1]) box(g, .8, WH, .4, s * 1.0, WH / 2, .2, M.wood);
  box(g, 1.2, WH - .95, .4, 0, .95 + (WH - .95) / 2, .2, M.wood);
  box(g, 2.82, .22, .46, 0, WH - .11, .23, M.woodH); box(g, 2.84, .014, .014, 0, WH - .23, .465, M.gold, false);
  // 上の飾り板
  const om = dualTex(1024, 640, (c, o, w, h) => {
    woodGrain(c, o, 0, 0, w, h, { tone: [62, 27, 16], rough: .32 }); bevel(c, 14, 14, w - 28, h - 28, 8);
    gold(c, o, rectPts(52, 52, w - 104, h - 104), 4, true); gold(c, o, stepRect(84, 84, w - 168, h - 168, 34), 3, true); gold(c, o, stepRect(128, 128, w - 256, h - 256, 34), 2.5, true);
    const cx = w / 2, by = h - 128;
    for (let k = 0; k < 9; k++) { const a = Math.PI * (k + .5) / 9, r = k % 2 ? 250 : 320; gold(c, o, [[cx, by], [cx + Math.cos(a) * r, by - Math.sin(a) * r * .95]], 2.5); }
    for (const r of [120, 190]) { const pts = []; for (let k = 0; k <= 24; k++) { const a = Math.PI * k / 24; pts.push([cx + Math.cos(a) * r, by - Math.sin(a) * r * .95]); } gold(c, o, pts, 3); }
  });
  const omm = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 1.62), Std({ map: om.map, roughnessMap: om.orm, metalnessMap: om.orm, roughness: 1, metalness: 1 })); omm.position.set(0, 2.24, .402); omm.receiveShadow = true; g.add(omm);
  // 大理石の縁取り、木の枠、炉棚
  for (const s of [-1, 1]) box(g, .17, 1.0, .05, s * .685, .5, .425, M.marbleD);
  box(g, 1.54, .17, .05, 0, 1.035, .425, M.marbleD);
  for (const s of [-1, 1]) {
    box(g, .4, 1.14, .12, s * .97, .57, .46, M.wood); box(g, .44, .1, .15, s * .97, .05, .475, M.woodH);
    rbox(g, .16, .16, .02, s * .97, .98, .528, M.gold, .006, false).rotation.z = Math.PI / 4;
    box(g, .014, .62, .012, s * .9, .5, .522, M.gold, false); box(g, .014, .62, .012, s * 1.04, .5, .522, M.gold, false); box(g, .014, .5, .012, s * .97, .5, .522, M.gold, false);
  }
  box(g, 2.34, .2, .12, 0, 1.22, .46, M.woodH);
  box(g, 1.3, .012, .012, 0, 1.26, .522, M.gold, false); box(g, 1.3, .012, .012, 0, 1.18, .522, M.gold, false);
  for (let k = -4; k <= 4; k++) rbox(g, .05, .05, .014, k * .14, 1.22, .524, M.gold, .003, false).rotation.z = Math.PI / 4;
  box(g, 2.64, .07, .36, 0, 1.355, .54, M.woodH); box(g, 2.5, .04, .3, 0, 1.305, .5, M.wood); box(g, 2.66, .012, .012, 0, 1.36, .722, M.gold, false);
  box(g, 2.7, .04, .7, 0, .02, .72, M.marbleD);
  // 炉の内側（照明を受けない面にして白飛びを避ける）
  const brick = canvasTex(256, 256, (c, w, h) => {
    c.fillStyle = '#0a0706'; c.fillRect(0, 0, w, h);
    for (let r = 0; r < 12; r++) for (let k = -1; k < 6; k++) { const v = rr(14, 34); c.fillStyle = `rgb(${v * 1.3},${v * .8},${v * .62})`; c.fillRect(k * 48 + (r % 2) * 24 + 2, r * 22 + 2, 44, 18); }
    const gr = c.createLinearGradient(0, 0, 0, h); gr.addColorStop(0, 'rgba(0,0,0,.82)'); gr.addColorStop(.55, 'rgba(60,14,0,.25)'); gr.addColorStop(1, 'rgba(255,110,20,.5)'); c.fillStyle = gr; c.fillRect(0, 0, w, h);
  });
  fire.liner = Basic({ map: brick, side: THREE.DoubleSide });
  mesh(new THREE.PlaneGeometry(1.2, .95), fire.liner, g, 0, .475, -.24);
  for (const s of [-1, 1]) mesh(new THREE.PlaneGeometry(.66, .95).rotateY(-s * Math.PI / 2), fire.liner, g, s * .6, .475, .09);
  mesh(new THREE.PlaneGeometry(1.2, .66).rotateX(Math.PI / 2), M.black, g, 0, .95, .09);
  mesh(new THREE.PlaneGeometry(1.2, .66).rotateX(-Math.PI / 2), Basic({ color: 0x0a0504 }), g, 0, .041, .09);
  // 火格子と薪
  for (let k = -3; k <= 3; k++) box(g, .014, .014, .36, k * .13, .13, .12, M.black);
  for (const z of [-.04, .28]) box(g, .86, .02, .02, 0, .13, z, M.black);
  for (const s of [-1, 1]) for (const z of [-.04, .28]) box(g, .02, .13, .02, s * .41, .065, z, M.black);
  const bark = canvasTex(256, 128, (c, w, h) => { c.fillStyle = '#000'; c.fillRect(0, 0, w, h); for (let i = 0; i < 70; i++) { c.strokeStyle = `rgba(255,${rr(70, 150)},${rr(0, 30)},${rr(.3, 1)})`; c.lineWidth = rr(1, 4); c.beginPath(); let x = rnd() * w, y = rnd() * h; c.moveTo(x, y); for (let s = 0; s < 6; s++) { x += rr(-16, 16); y += rr(-9, 9); c.lineTo(x, y); } c.stroke(); } });
  const logs = [[0, .2, .12, .09, .74, .08], [-.05, .29, .03, .075, .66, -.22], [.08, .3, .2, .07, .6, .3], [-.02, .385, .12, .06, .5, .05]];
  for (const [x, y, z, r, len, ry] of logs) {
    const mat = Std({ color: 0x110b08, roughness: .95, emissive: new THREE.Color(1, .35, .06), emissiveMap: bark, emissiveIntensity: 2 });
    const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r * .92, len, 12).rotateZ(Math.PI / 2), mat); m.position.set(x, y, z); m.rotation.y = ry; g.add(m); fire.logs.push(mat);
  }
  // 熾火
  fire.coals = new THREE.ShaderMaterial({ uniforms: { time: { value: 0 }, level: { value: 1 } }, vertexShader: `varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.); }`,
    fragmentShader: `varying vec2 vUv; uniform float time, level; float hash(vec2 p){ return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453); }
      float noise(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.-2.*f); return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x),f.y); }
      void main(){ vec2 p=vUv*vec2(22.,9.); float c=noise(p)*.6+noise(p*2.3+4.)*.4; float pulse=.6+.4*noise(p*.5+vec2(time*.9,time*.6));
        float m=smoothstep(.42,.75,c)*pulse; float edge=smoothstep(.0,.25,vUv.x)*smoothstep(1.,.75,vUv.x)*smoothstep(.0,.3,vUv.y)*smoothstep(1.,.7,vUv.y);
        gl_FragColor=vec4(mix(vec3(.5,.04,0.),vec3(1.,.5,.1),m)*m*edge*(1.2+level*1.6)+vec3(.02,.008,.004),1.); }` });
  mesh(new THREE.PlaneGeometry(.9, .42).rotateX(-Math.PI / 2), fire.coals, g, 0, .146, .12);
  // 炎（向きを変えた板を重ねる）
  const planes = [[0, .1, 1.05, .95, 0, 1.1], [.04, .2, .9, .85, .5, 2.7], [-.05, .02, .95, .8, -.45, 5.3], [.02, .15, .6, 1.0, 0, 8.9]];
  for (const [x, z, w, h, ry, sd] of planes) {
    const mat = new THREE.ShaderMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, uniforms: { time: { value: 0 }, level: { value: 1 }, seed: { value: sd } },
      vertexShader: `varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.); }`, fragmentShader: FIRE_FS });
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat); m.position.set(x, .17 + h / 2, z); m.rotation.y = ry; g.add(m); fire.mats.push(mat);
  }
  // 火の粉
  const n = 90, p = new Float32Array(n * 3), sd = new Float32Array(n); for (let i = 0; i < n; i++) { p.set([rr(-.32, .32), .2, rr(0, .25)], i * 3); sd[i] = rnd(); }
  const eg = new THREE.BufferGeometry(); eg.setAttribute('position', new THREE.BufferAttribute(p, 3)); eg.setAttribute('sd', new THREE.BufferAttribute(sd, 1));
  fire.embers = new THREE.ShaderMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, uniforms: { time: { value: 0 }, level: { value: 1 }, vh: { value: 720 } },
    vertexShader: `attribute float sd; uniform float time, level, vh; varying float vA;
      void main(){ float f=fract(sd*17.3+time*(.25+sd*.45)); vec3 p=position; p.y+=f*f*.2+f*(.45+.5*fract(sd*5.7))*level; p.x+=sin(time*2.1+sd*40.+f*6.)*.05*f; p.z+=cos(time*1.7+sd*23.)*.03*f;
        vec4 mv=modelViewMatrix*vec4(p,1.); gl_Position=projectionMatrix*mv; float px=.007*projectionMatrix[1][1]*vh*.5/max(-mv.z,.05); float k=min(px/1.2,1.); gl_PointSize=max(px,1.2);
        vA=(1.-f)*k*k*step(fract(sd*3.1),level*.9)*(.5+.5*sin(time*9.+sd*50.)); }`,
    fragmentShader: `varying float vA; void main(){ float d=length(gl_PointCoord-.5); gl_FragColor=vec4(vec3(1.,.5,.14)*3.2*vA*smoothstep(.5,.1,d),1.); }` });
  const em = new THREE.Points(eg, fire.embers); em.frustumCulled = false; g.add(em);
  // 光
  fire.light = new THREE.PointLight(0xff7a2e, 10, 16, 1.15); fire.light.position.set(0, .52, .28);
  fire.light.castShadow = true; fire.light.shadow.mapSize.set(1024, 1024); fire.light.shadow.bias = -.004; fire.light.shadow.normalBias = .04; fire.light.shadow.radius = 5; fire.light.shadow.camera.near = .05; fire.light.shadow.camera.far = 14; g.add(fire.light);
  fire.fill = new THREE.PointLight(0xff6a22, 1.2, 5, 1.6); fire.fill.position.set(0, .7, 1.25); g.add(fire.fill);

  // 炉棚の上
  const top = 1.39, put = (fn, x, z = .56) => { const o = new THREE.Group(); o.position.set(x, top, z); g.add(o); fn(o); return o; };
  const candle = o => { lathe(o, [[0, 0], [.05, 0], [.055, .012], [.028, .03], [.012, .06], [.017, .12], [.01, .17], [.026, .21], [.032, .22], [.014, .232]], 0, 0, 0, M.brass, 20); cyl(o, .011, .011, .17, 0, .315, 0, M.ivory, 10, false); const f = mesh(new THREE.SphereGeometry(.01, 8, 8), M.flame, o, 0, .425, 0); f.scale.set(.8, 2.2, .8); candleFlames.push(f); };
  put(candle, -1.02); put(candle, .82);
  put(o => {
    lathe(o, [[0, 0], [.05, 0], [.088, .06], [.1, .13], [.074, .21], [.036, .26], [.04, .285], [.052, .295]], 0, 0, 0, M.ceramic, 24);
    for (let k = 0; k < 11; k++) { const f = new THREE.Mesh(frondGeo(rr(.38, .62), .13, rr(1.0, 1.5), rr(.02, .18)), M.euc); f.position.y = .27; f.rotation.y = k * 2.4 + rnd(); f.rotation.x = rr(-.1, .1); o.add(f); }
  }, -.62);
  put(o => { rbox(o, .26, .12, .15, 0, .06, 0, M.goldRough, .012); box(o, .264, .008, .154, 0, .09, 0, M.gold, false); rbox(o, .05, .03, .01, 0, .075, .077, M.gold, .004, false); }, -.12);
  put(o => { let x = 0; for (let k = 0; k < 5; k++) { const w = rr(.035, .055), h = rr(.2, .26), mat = M.leather[k % 4]; const b = box(o, w, h, .16, x + w / 2, h / 2, 0, mat); box(o, w + .002, .008, .162, x + w / 2, h * .82, 0, M.gold, false); box(o, w + .002, .008, .162, x + w / 2, h * .2, 0, M.gold, false); if (k === 4) { b.rotation.z = -.2; b.position.x += .03; } x += w + .004; }
    for (let k = 0; k < 3; k++) box(o, .2, .035, .15, -.22, .0175 + k * .037, 0, M.leather[(k + 1) % 4]).rotation.y = (k - 1) * .12; }, .32);
  put(o => { rbox(o, .2, .03, .14, 0, .015, 0, M.cloth, .012); rbox(o, .17, .03, .12, .01, .045, .005, M.cloth, .012).rotation.y = .2; }, 1.08);
  const cl = new THREE.PointLight(0xffb060, 1.6, 3.6, 1.5); cl.position.set(0, 1.8, 1.0); g.add(cl); candleLight = cl;
  rectW(-1.42, Z0, 1.42, Z0 + .78);
  fire.pos.set(0, 0, Z0 + .8);
}
const candleFlames = []; let candleLight;

// 葉の一枝（根元から外へ弧を描く帯）
function frondGeo(len, wid, rise, droop, segN = 8) {
  const pos = [], uv = [], idx = [];
  for (let i = 0; i <= segN; i++) { const t = i / segN, a = rise - droop * t * 2.2, out = len * t * Math.cos(rise) + (1 - Math.cos(droop * t * 2.2)) * len * .3, up = len * (Math.sin(rise) * t - droop * t * t * .8); pos.push(out, up, -wid / 2, out, up, wid / 2); uv.push(0, t, 1, t); if (i < segN) { const k = i * 2; idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2); } }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx); g.computeVertexNormals(); return g;
}
function plant(x, z, s = 1) {
  const g = new THREE.Group(); g.position.set(x, 0, z); g.scale.setScalar(s); scene.add(g);
  mesh(new THREE.CylinderGeometry(.22, .17, .36, 32, 1, true), M.brass, g, 0, .2, 0); cyl(g, .17, .17, .02, 0, .02, 0, M.brass, 32); mesh(new THREE.TorusGeometry(.22, .012, 8, 40).rotateX(Math.PI / 2), M.gold, g, 0, .38, 0, false);
  mesh(new THREE.CircleGeometry(.21, 24).rotateX(-Math.PI / 2), M.soil, g, 0, .34, 0);
  for (let k = 0; k < 22; k++) { const t = k / 21, f = new THREE.Mesh(frondGeo(rr(.55, .95) * (1 - t * .25), .2, lerp(1.35, .45, t) + rr(-.1, .1), rr(.1, .34) + t * .12), M.fern); f.position.y = .34; f.rotation.y = k * 2.399 + rr(-.2, .2); f.rotation.x = rr(-.25, .25); g.add(f); }
  circles.push({ x, z, r: .3 * s });
  blob(scene, 'round', x, .005, z, 1.1 * s, 1.1 * s, .8);
}

// ---------------------------------------------------------------- sofas
const seats = [];
function buildSofa(x, z, ry, cushions, throwAt) {
  const g = new THREE.Group(); g.position.set(x, 0, z); g.rotation.y = ry; scene.add(g);
  const L = 2.3;
  rbox(g, L, .2, .96, 0, .2, 0, M.velvetDeep, .04);
  for (let k = -1; k <= 1; k++) rbox(g, .625, .17, .7, k * .632, .385, .1, M.velvet, .06);
  const back = rbox(g, L - .36, .56, .2, 0, .64, -.37, M.velvetTuft, .08); back.rotation.x = -.1;
  for (const s of [-1, 1]) {
    rbox(g, .2, .46, .96, s * 1.05, .42, 0, M.velvet, .07);
    const roll = cyl(g, .135, .135, .96, s * 1.05, .64, 0, M.velvet, 24); roll.rotation.x = Math.PI / 2;
    for (const zz of [-.482, .482]) mesh(new THREE.TorusGeometry(.132, .004, 6, 28), M.brass, g, s * 1.05, .64, zz, false);
    mesh(new THREE.SphereGeometry(.018, 10, 8), M.brass, g, s * 1.05, .64, .482, false);
  }
  box(g, L, .012, .012, 0, .105, .482, M.gold, false); box(g, L - .42, .012, .012, 0, .3, .482, M.gold, false);
  for (const s of [-1, 1]) box(g, .012, .012, .96, s * 1.151, .105, 0, M.gold, false);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) lathe(g, [[0, 0], [.022, 0], [.03, .03], [.04, .085], [0, .085]], sx * 1.05, 0, sz * .4, M.brass, 12);
  for (const [cx, mat, ry2, sz = .46] of cushions) { const c = rbox(g, sz, sz, .15, cx, .7, -.12, M[mat], .07); c.rotation.set(-.42, ry2, rr(-.08, .08)); c.scale.z = .8; }
  if (throwAt !== undefined) {
    // ブランケット：背もたれから座面へ垂らす
    const prof = new THREE.CatmullRomCurve3([[-.52, .42], [-.5, .8], [-.4, .95], [-.3, .9], [-.22, .62], [-.08, .5], [.2, .485], [.44, .47], [.5, .36], [.5, .16]].map(q => new THREE.Vector3(0, q[1], q[0])));
    const nu = 16, nv = 44, pos = [], uv = [], idx = [], wdt = .5;
    for (let j = 0; j <= nv; j++) { const p = prof.getPoint(j / nv), tn = prof.getTangent(j / nv), nx = new THREE.Vector3(0, tn.z, -tn.y); for (let i = 0; i <= nu; i++) { const u = i / nu, wr = Math.sin(u * 17 + j * .45) * .014 + Math.sin(u * 6.1 - j * .31) * .02 + Math.sin(u * 31 + j * 1.3) * .004, skew = (j / nv) * .05; pos.push(throwAt + (u - .5) * wdt * (1 - .1 * Math.sin(j * .3)) + skew, p.y + nx.y * (wr + .02), p.z + nx.z * (wr + .02)); uv.push(u * 3, j / nv * 6); } }
    for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) { const a = j * (nu + 1) + i; idx.push(a, a + 1, a + nu + 1, a + 1, a + nu + 2, a + nu + 1); }
    const tg = new THREE.BufferGeometry(); tg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); tg.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); tg.setIndex(idx); tg.computeVertexNormals();
    mesh(tg, M.throwGold, g);
  }
  g.updateMatrixWorld(true);
  const a = worldOf(g, -1.17, 0, -.5), b = worldOf(g, 1.17, 0, .5); rectW(Math.min(a.x, b.x), Math.min(a.z, b.z), Math.max(a.x, b.x), Math.max(a.z, b.z));
  const sp = worldOf(g, -.3, 0, .12), ex = worldOf(g, -.3, 0, .95), yaw = Math.atan2(-Math.sin(ry), -Math.cos(ry));
  seats.push({ pos: worldOf(g, 0, 0, .3), x: sp.x, z: sp.z, ex: ex.x, ez: ex.z, yaw });
}

// ---------------------------------------------------------------- table
function buildTable() {
  const g = new THREE.Group(); g.position.set(0, 0, -.8); scene.add(g);
  rbox(g, 1.02, .045, 1.56, 0, .465, 0, M.marble, .008);
  box(g, .96, .03, 1.5, 0, .428, 0, M.brass);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) box(g, .035, .42, .035, sx * .455, .21, sz * .72, M.brass);
  for (const sz of [-1, 1]) box(g, .9, .02, .02, 0, .1, sz * .72, M.brass); for (const sx of [-1, 1]) box(g, .02, .02, 1.42, sx * .455, .1, 0, M.brass);
  const T = .488, put = (fn, x, z, ry = 0) => { const o = new THREE.Group(); o.position.set(x, T, z); o.rotation.y = ry; g.add(o); fn(o); return o; };
  // デキャンタ（8角のカット）
  put(o => {
    lathe(o, [[0, .014], [.05, .014], [.052, .075], [0, .075]], 0, 0, 0, M.wine, 8, false);
    const d = lathe(o, [[0, 0], [.058, 0], [.062, .012], [.062, .1], [.052, .128], [.02, .15], [.018, .178], [.027, .186]], 0, 0, 0, M.crystal, 8, false); d.geometry = d.geometry.toNonIndexed(); d.geometry.computeVertexNormals();
    const s = mesh(new THREE.OctahedronGeometry(.026, 0), M.crystal, o, 0, .215, 0); s.scale.y = 1.25;
    cyl(o, .058, .058, .004, 0, .002, 0, M.mirror, 8, false);
  }, -.08, -.22, .3);
  // ワイングラス
  put(o => {
    lathe(o, [[0, .104], [.018, .107], [.037, .14], [.0395, .158], [0, .158]], 0, 0, 0, M.wine, 24, false);
    lathe(o, [[0, 0], [.036, 0], [.036, .003], [.006, .009], [.004, .092], [.02, .105], [.039, .14], [.042, .18], [.036, .22]], 0, 0, 0, M.crystal, 24, false);
  }, .1, -.3);
  // 金の小箱
  put(o => { rbox(o, .23, .09, .16, 0, .045, 0, M.goldRough, .012); rbox(o, .24, .03, .17, 0, .105, 0, M.goldRough, .012); box(o, .242, .006, .172, 0, .09, 0, M.gold, false); for (const s of [-1, 1]) lathe(o, [[0, 0], [.012, 0], [.008, .012], [0, .012]], s * .1, -.008, .065, M.gold, 8, false); }, .26, .1, -.25);
  // 皿と金の葉
  const leaf = new THREE.ShapeGeometry((() => { const s = new THREE.Shape(); s.moveTo(0, 0); s.quadraticCurveTo(.5, .32, 1, 0); s.quadraticCurveTo(.5, -.32, 0, 0); return s; })());
  const leafAt = (o, x, y, z, sc, ry, tilt) => { const m = new THREE.Mesh(leaf, Std({ color: 0xe2b055, roughness: .3, metalness: 1, side: THREE.DoubleSide })); m.scale.setScalar(sc); m.position.set(x, y, z); m.rotation.set(-Math.PI / 2 + tilt, 0, ry); o.add(m); };
  put(o => { lathe(o, [[0, .004], [.09, .004], [.13, .018], [.135, .018], [.09, 0], [0, 0]], 0, 0, 0, M.gold, 32); for (let k = 0; k < 9; k++) leafAt(o, rr(-.07, .07), .014 + k * .003, rr(-.07, .07), rr(.05, .08), rnd() * TAU, rr(-.3, .3)); }, -.22, .16);
  for (const [x, z] of [[-.3, -.42], [-.18, -.5], [.05, .42], [.14, .5], [-.02, .35], [-.36, -.3]]) leafAt(g, x, T + .003, z, rr(.05, .075), rnd() * TAU, rr(-.12, .12));
  put(o => { rbox(o, .22, .016, .22, 0, .008, 0, M.cloth, .006); rbox(o, .21, .016, .2, .004, .024, .004, M.cloth, .006); }, .25, .52, .12);
  for (const [k, x, z, w, d, ry] of [['round', -.08, -.22, .26, .26, 0], ['round', .1, -.3, .17, .17, 0], ['rect', .26, .1, .4, .3, -.25], ['round', -.22, .16, .4, .4, 0], ['rect', .25, .52, .38, .38, .12]]) blob(g, k, x, T + .0015, z, w, d, .55, ry);
  rectW(-.52, -.8 - .79, .52, -.8 + .79);
}

// ---------------------------------------------------------------- lamp
const lamp = { on: true, cur: 1, light: null, pos: new THREE.Vector3(3.62, 0, -2.72) };
function buildLamp() {
  const g = new THREE.Group(); g.position.copy(lamp.pos); scene.add(g);
  cyl(g, .32, .32, .035, 0, .63, 0, M.woodH, 40); mesh(new THREE.TorusGeometry(.32, .01, 6, 48).rotateX(Math.PI / 2), M.gold, g, 0, .63, 0, false);
  lathe(g, [[0, 0], [.2, 0], [.2, .02], [.05, .05], [.035, .3], [.06, .56], [.1, .61], [0, .61]], 0, 0, 0, M.bronze, 24);
  lathe(g, [[0, 0], [.095, 0], [.1, .015], [.05, .035], [.03, .07], [.065, .13], [.08, .2], [.055, .28], [.022, .33], [.016, .44]], 0, .648, 0, M.gold, 28);
  const sh = canvasTex(256, 128, (c, w, h) => { const gr = c.createLinearGradient(0, 0, 0, h); gr.addColorStop(0, '#b8793a'); gr.addColorStop(.45, '#ffe3ac'); gr.addColorStop(1, '#c98a44'); c.fillStyle = gr; c.fillRect(0, 0, w, h); for (let x = 0; x < w; x += 8) { c.fillStyle = 'rgba(120,60,10,.16)'; c.fillRect(x, 0, 2, h); } c.fillStyle = 'rgba(90,50,10,.6)'; c.fillRect(0, 0, w, 5); c.fillRect(0, h - 5, w, 5); });
  M.shade.map = sh;
  mesh(new THREE.CylinderGeometry(.16, .28, .3, 40, 1, true), M.shade, g, 0, 1.2, 0);
  lamp.light = new THREE.PointLight(0xffb46a, 7, 9, 1.6); lamp.light.position.set(0, 1.22, 0); g.add(lamp.light);
  lamp.light.shadow.bias = -.004; lamp.light.shadow.normalBias = .04; lamp.light.shadow.camera.near = .05; lamp.light.shadow.camera.far = 10;
  circles.push({ x: lamp.pos.x, z: lamp.pos.z, r: .34 });
  blob(scene, 'round', lamp.pos.x, .005, lamp.pos.z, 1.0, 1.0, .75); blob(g, 'round', 0, .649, 0, .34, .34, .6);
}

// ---------------------------------------------------------------- window (east) + exterior
const WX0 = -2.6, WX1 = 2.7;     // 東壁ローカル（= ワールド z − ZC）
let bokehMat, snowMat;
function curtainGeo(width, height, pleats, tie) {
  const g = new THREE.PlaneGeometry(width, height, 72, 40), p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const u = p.getX(i) / width + .5, v = p.getY(i) / height + .5;
    let k = 1; if (tie) k = v < .36 ? .36 + .3 * (.36 - v) / .36 : .36 + .64 * Math.pow((v - .36) / .64, .7);
    const amp = .085 * (.5 + .5 * k) * (1 - .5 * Math.exp(-Math.pow((1 - v) / .04, 2)));
    p.setX(i, u * width * k); p.setZ(i, Math.sin(u * pleats * TAU) * amp + Math.sin(u * 7 + v * 3) * .012 + (tie ? (1 - k) * .1 : 0));
  }
  g.computeVertexNormals(); return g;
}
function buildWindowWall() {
  const g = wallGroup(X1, ZC, -Math.PI / 2), half = (Z1 - Z0) / 2;
  wallRun(g, -half, WX0); wallRun(g, WX1, half);
  const ww = WX1 - WX0, wc = (WX0 + WX1) / 2, sill = .5, head = 3.0;
  box(g, ww, sill, .16, wc, sill / 2, -.02, M.wood); box(g, ww + .1, .05, .26, wc, sill + .025, .03, M.woodH); box(g, ww, .012, .012, wc, sill - .06, .07, M.gold, false);
  box(g, ww, WH - head, .16, wc, head + (WH - head) / 2, -.02, M.wood);
  for (let k = 0; k <= 4; k++) box(g, .07, head - sill, .1, WX0 + ww * k / 4, (sill + head) / 2, -.03, M.bronze);
  box(g, ww, .06, .1, wc, 2.42, -.03, M.bronze); box(g, ww, .06, .1, wc, head - .03, -.03, M.bronze);
  for (let k = 0; k < 4; k++) box(g, .012, 2.42 - sill, .012, WX0 + ww * (k + .5) / 4, (sill + 2.42) / 2, -.03, M.gold, false);
  const gl = new THREE.Mesh(new THREE.PlaneGeometry(ww, head - sill), M.glass); gl.position.set(wc, (sill + head) / 2, -.06); g.add(gl);
  trims(g, WX0, WX1);
  // カーテン
  const rod = cyl(g, .018, .018, ww + 1.7, wc, 3.02, .2, M.gold, 12); rod.rotation.z = Math.PI / 2;
  for (const s of [-1, 1]) mesh(new THREE.SphereGeometry(.04, 12, 10), M.gold, g, wc + s * (ww / 2 + .85), 3.02, .2);
  const cA = new THREE.Mesh(curtainGeo(1.75, 3.0, 11, true), M.curtain); cA.position.set(WX0 - .82, 1.5, .2); cA.castShadow = true; g.add(cA);
  const tie = mesh(new THREE.TorusGeometry(.2, .016, 8, 28), M.gold, g, WX0 - .52, 1.09, .26, false); tie.rotation.set(Math.PI / 2 - .25, 0, .1); tie.scale.set(1.7, 1, .7);
  cyl(g, .012, .012, .22, WX0 - .2, .98, .34, M.gold, 8, false); lathe(g, [[0, 0], [.035, 0], [.04, .1], [.026, .13], [.012, .15], [0, .15]], WX0 - .2, .72, .34, M.goldRough, 14, false);
  const cB = new THREE.Mesh(curtainGeo(1.0, 3.0, 7, false), M.curtain); cB.position.set(WX1 - .1, 1.5, .2); cB.castShadow = true; g.add(cB);

  // 外：空、街並み（3層）、ボケた灯、雪
  const sky = canvasTex(8, 256, (c, w, h) => { const gr = c.createLinearGradient(0, 0, 0, h); gr.addColorStop(0, '#01020a'); gr.addColorStop(.42, '#050818'); gr.addColorStop(.52, '#151530'); gr.addColorStop(.58, '#2a1c2c'); gr.addColorStop(.7, '#07060c'); gr.addColorStop(1, '#020203'); c.fillStyle = gr; c.fillRect(0, 0, w, h); });
  scene.add(new THREE.Mesh(new THREE.SphereGeometry(500, 24, 16), Basic({ map: sky, side: THREE.BackSide, depthWrite: false })));
  const city = (dist, dens, bright, tint, hmin, hmax, top, rep, bokehR) => {
    const CW = 2048, CH = 768, B = []; let x = 0;
    while (x < CW) {
      const bw = rr(26, 100), gap = rnd() < dens ? 0 : rr(20, 160), bh = CH * rr(hmin, hmax), tp = CH - bh, o = { x, tp, bw, bh, mast: rnd() < .3 ? rr(10, 46) : 0, win: [] };
      const cw = rr(5, 8), ch = rr(7, 11), lit = rr(.12, .5), warm = rnd(); o.cw = cw; o.ch = ch;
      for (let yy = tp + 6; yy < CH - 4; yy += ch) for (let xx = x + 4; xx < x + bw - 4; xx += cw) { if (rnd() > lit) continue; const k = rnd(), col = k < warm ? [255, rr(170, 225), rr(90, 150)] : k < .93 ? [rr(170, 215), rr(205, 235), 255] : [rr(40, 255), rr(60, 255), rr(120, 255)]; o.win.push([xx, yy, col[0] | 0, col[1] | 0, col[2] | 0, rr(.35, 1) * bright]); }
      B.push(o); x += bw + gap;
    }
    const body = `rgb(${tint[0] * .02 * 255},${tint[1] * .022 * 255},${tint[2] * .035 * 255})`;
    const draw = soft => canvasTex(CW, CH, c => {
      if (soft) c.filter = 'blur(' + (bokehR * .8).toFixed(1) + 'px)';
      for (const o of B) { c.fillStyle = body; c.fillRect(o.x, o.tp, o.bw, o.bh); if (o.mast) c.fillRect(o.x + o.bw * .3, o.tp - o.mast, o.bw * .4, 50); }
      c.filter = 'none';
      if (!soft) { for (const o of B) { if (o.mast) { c.fillStyle = '#ff3020'; c.fillRect(o.x + o.bw * .5 - 1, o.tp - 50, 3, 3); } for (const [xx, yy, r, g, b, a] of o.win) { c.fillStyle = `rgba(${r},${g},${b},${a})`; c.fillRect(xx, yy, o.cw - 2.2, o.ch - 3.4); } } return; }
      // ボケ：灯りを円盤として加算で重ねる（縁をわずかに明るく）
      c.globalCompositeOperation = 'lighter';
      const disc = (px, py, r, g, b, a, R) => { for (const ox of (px < R ? [0, CW] : px > CW - R ? [0, -CW] : [0])) { c.fillStyle = `rgba(${r},${g},${b},${a * .34})`; c.beginPath(); c.arc(px + ox, py, R, 0, TAU); c.fill(); c.strokeStyle = `rgba(${r},${g},${b},${a * .22})`; c.lineWidth = 1; c.beginPath(); c.arc(px + ox, py, R - .5, 0, TAU); c.stroke(); } };
      for (const o of B) { if (o.mast) disc(o.x + o.bw * .5, o.tp - 48, 255, 48, 32, 1.6, bokehR * .8); for (const [xx, yy, r, g, b, a] of o.win) disc(xx + o.cw * .4, yy + o.ch * .35, r, g, b, a, bokehR * (.8 + .4 * ((xx * 7 + yy * 13) % 10) / 10)); }
    });
    const W = dist * 7, Hh = W / rep * CH / CW, L = {};
    for (const key of ['sharp', 'soft']) {
      const t = draw(key === 'soft'); t.wrapS = THREE.RepeatWrapping; t.repeat.x = rep;
      const mat = Basic({ map: t, transparent: true, depthWrite: false, color: new THREE.Color(1.7, 1.7, 1.7) }), m = new THREE.Mesh(new THREE.PlaneGeometry(W, Hh), mat);
      m.rotation.y = -Math.PI / 2; m.position.set(X1 + dist, top - ((hmin + hmax) / 2 - .5) * Hh, 0); m.renderOrder = -dist; scene.add(m); L[key] = mat; L[key + 'Mesh'] = m;
    }
    const zz = ZC + rr(-20, 20); L.sharpMesh.position.z = L.softMesh.position.z = zz; cityLayers.push(L);
  };
  city(260, .95, .55, [1, 1.2, 2.2], .2, .62, -14, 5, 5); city(140, .75, .8, [1, 1.1, 1.8], .22, .8, -8, 4, 6.5); city(70, .4, 1, [1, 1, 1.4], .3, .98, -6, 3, 8);
  // ボケ
  { const n = 300, p = new Float32Array(n * 3), cc = new Float32Array(n * 3), sd = new Float32Array(n);
    for (let i = 0; i < n; i++) { p.set([X1 + rr(22, 150), rr(-55, 16), ZC + rr(-130, 130)], i * 3); const k = rnd(), col = k < .5 ? [1, .72, .36] : k < .78 ? [1, .9, .7] : k < .92 ? [.55, .75, 1] : [1, .3, .25]; cc.set(col, i * 3); sd[i] = rnd(); }
    const bg = new THREE.BufferGeometry(); bg.setAttribute('position', new THREE.BufferAttribute(p, 3)); bg.setAttribute('color', new THREE.BufferAttribute(cc, 3)); bg.setAttribute('sd', new THREE.BufferAttribute(sd, 1));
    bokehMat = new THREE.ShaderMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, uniforms: { time: { value: 0 }, vh: { value: 720 } },
      vertexShader: `attribute vec3 color; attribute float sd; uniform float time, vh; varying vec3 vC;
        void main(){ vec4 mv=modelViewMatrix*vec4(position,1.); gl_Position=projectionMatrix*mv; float px=(.7+sd*1.3)*projectionMatrix[1][1]*vh*.5/max(-mv.z,1.); gl_PointSize=clamp(px,3.,64.);
          vC=color*(.2+.16*sin(time*(.4+sd)+sd*40.))*(.5+sd); }`,
      fragmentShader: `varying vec3 vC; void main(){ float d=length(gl_PointCoord-.5)*2.; float a=smoothstep(1.,.86,d)*(.55+.45*smoothstep(.55,.95,d)); gl_FragColor=vec4(vC*a,1.); }` });
    const pts = new THREE.Points(bg, bokehMat); pts.frustumCulled = false; scene.add(pts); }
  // 雪
  { const n = 1100, p = new Float32Array(n * 3), sd = new Float32Array(n); for (let i = 0; i < n; i++) { p.set([X1 + rr(.6, 16), rr(0, 12), ZC + rr(-12, 12)], i * 3); sd[i] = rnd(); }
    const sg = new THREE.BufferGeometry(); sg.setAttribute('position', new THREE.BufferAttribute(p, 3)); sg.setAttribute('sd', new THREE.BufferAttribute(sd, 1));
    snowMat = new THREE.ShaderMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, uniforms: { time: { value: 0 }, vh: { value: 720 } },
      vertexShader: `attribute float sd; uniform float time, vh; varying float vA;
        void main(){ vec3 p=position; p.y=mod(p.y-time*(.35+sd*.45),12.)-4.; p.z+=sin(time*.5+sd*30.+p.y)*.3; p.x+=cos(time*.37+sd*17.)*.2;
          vec4 mv=modelViewMatrix*vec4(p,1.); gl_Position=projectionMatrix*mv; float px=(.018+sd*.02)*projectionMatrix[1][1]*vh*.5/max(-mv.z,.2); float k=min(px/1.3,1.); gl_PointSize=max(px,1.3); vA=k*k*(.3+.5*sd); }`,
      fragmentShader: `varying float vA; void main(){ float d=length(gl_PointCoord-.5); gl_FragColor=vec4(vec3(.8,.88,1.)*vA*smoothstep(.5,.1,d),1.); }` });
    const pts = new THREE.Points(sg, snowMat); pts.frustumCulled = false; scene.add(pts); snowMat.userData.pts = pts; }
}

// ---------------------------------------------------------------- west wall: console, radio, mirror / south wall: door
const radio = { on: true, pos: new THREE.Vector3(), glow: 1 };
function buildWestWall() {
  const half = (Z1 - Z0) / 2, g = wallGroup(X0, ZC, Math.PI / 2); wallRun(g, -half, half);
  const cx = -(1.55 - ZC);   // ワールド z=1.55 の位置
  rbox(g, 1.5, .05, .42, cx, .86, .23, M.marbleD, .008); box(g, 1.44, .1, .36, cx, .785, .22, M.woodH); box(g, 1.44, .012, .012, cx, .76, .402, M.gold, false);
  for (const s of [-1, 1]) { box(g, .04, .74, .04, cx + s * .68, .37, .37, M.brass); box(g, .04, .74, .04, cx + s * .68, .37, .07, M.brass); }
  box(g, 1.36, .02, .3, cx, .16, .22, M.brass);
  // ラジオ
  const r = new THREE.Group(); r.position.set(cx - .2, .885, .22); g.add(r);
  rbox(r, .5, .32, .22, 0, .16, 0, M.wood, .05); rbox(r, .54, .03, .24, 0, .015, 0, M.woodH, .01);
  const grille = dualTex(256, 160, (c, o, w, h) => { c.fillStyle = '#1a120a'; c.fillRect(0, 0, w, h); o.fillStyle = orm(.9); o.fillRect(0, 0, w, h); for (let k = 0; k < 9; k++) { const a = Math.PI * (k + .5) / 9; gold(c, o, [[w / 2, h - 8], [w / 2 + Math.cos(a) * 180, h - 8 - Math.sin(a) * 180]], 4); } gold(c, o, rectPts(4, 4, w - 8, h - 8), 5, true); });
  mesh(new THREE.PlaneGeometry(.26, .17), Std({ map: grille.map, roughnessMap: grille.orm, metalnessMap: grille.orm, roughness: 1, metalness: 1 }), r, -.08, .18, .112);
  const dt = canvasTex(128, 128, (c, w, h) => { c.fillStyle = '#ffd38a'; c.beginPath(); c.arc(64, 64, 62, 0, TAU); c.fill(); c.strokeStyle = '#3a1c06'; c.lineWidth = 2; for (let k = 0; k < 24; k++) { const a = k * TAU / 24; c.beginPath(); c.moveTo(64 + Math.cos(a) * 44, 64 + Math.sin(a) * 44); c.lineTo(64 + Math.cos(a) * (k % 3 ? 52 : 58), 64 + Math.sin(a) * (k % 3 ? 52 : 58)); c.stroke(); } c.lineWidth = 3; c.beginPath(); c.moveTo(64, 64); c.lineTo(96, 40); c.stroke(); });
  M.dial.map = dt; mesh(new THREE.CircleGeometry(.055, 28), M.dial, r, .14, .2, .112); mesh(new THREE.TorusGeometry(.058, .006, 6, 28), M.gold, r, .14, .2, .113, false);
  for (const x of [.1, .18]) cyl(r, .014, .014, .02, x, .08, .118, M.gold, 12, false).rotation.x = Math.PI / 2;
  radio.pos.copy(worldOf(g, cx - .2, 1.05, .22));
  // 小物：本と燭台
  for (let k = 0; k < 3; k++) box(g, .24, .04, .17, cx + .42, .905 + k * .042, .22, M.leather[k]).rotation.y = k * .15 - .1;
  // 太陽のかたちの鏡
  const mg = new THREE.Group(); mg.position.set(cx, 2.02, .03); g.add(mg);
  mesh(new THREE.CircleGeometry(.25, 48), M.mirror, mg, 0, 0, .012); mesh(new THREE.TorusGeometry(.26, .018, 8, 48), M.gold, mg, 0, 0, .012, false);
  for (let k = 0; k < 36; k++) { const a = k * TAU / 36, len = k % 2 ? .22 : .4, b = box(mg, len, k % 2 ? .012 : .02, .008, Math.cos(a) * (.29 + len / 2), Math.sin(a) * (.29 + len / 2), .006, M.gold, false); b.rotation.z = a; }
  const a = worldOf(g, cx - .78, 0, 0), b = worldOf(g, cx + .78, 0, .46); rectW(Math.min(a.x, b.x), Math.min(a.z, b.z), Math.max(a.x, b.x), Math.max(a.z, b.z));
}
function buildSouthWall() {
  const g = wallGroup(0, Z1, Math.PI); wallRun(g, X0, -1.05); wallRun(g, 1.05, X1);
  box(g, 2.1, WH - 2.42, .06, 0, 2.42 + (WH - 2.42) / 2, .0, M.wood); trims(g, -1.05, 1.05);
  for (const s of [-1, 1]) box(g, .14, 2.42, .09, s * .98, 1.21, .045, M.woodH); box(g, 2.1, .14, .09, 0, 2.42, .045, M.woodH); box(g, 1.84, .014, .014, 0, 2.345, .092, M.gold, false);
  const dt = dualTex(512, 1280, (c, o, w, h) => {
    woodGrain(c, o, 0, 0, w, h, { tone: [64, 28, 16], rough: .3 }); bevel(c, 20, 20, w - 40, h - 40, 7);
    gold(c, o, stepRect(54, 54, w - 108, h - 108, 26), 3.5, true);
    for (let k = 0; k < 5; k++) { const yy = 150 + k * 60, a = 60 + k * 30; gold(c, o, [[w / 2 - a, yy + a * .9], [w / 2, yy], [w / 2 + a, yy + a * .9]], 3); }
    for (let k = 0; k < 5; k++) { const yy = h - 150 - k * 60, a = 60 + k * 30; gold(c, o, [[w / 2 - a, yy - a * .9], [w / 2, yy], [w / 2 + a, yy - a * .9]], 3); }
    gold(c, o, [[w / 2, 150], [w / 2, h - 150]], 3);
  });
  const dm = Std({ map: dt.map, roughnessMap: dt.orm, metalnessMap: dt.orm, roughness: 1, metalness: 1 });
  for (const s of [-1, 1]) { mesh(new THREE.PlaneGeometry(.9, 2.34), dm, g, s * .455, 1.18, .012); box(g, .025, .5, .03, s * .07, 1.15, .04, M.gold); }
  box(g, .012, 2.34, .01, 0, 1.18, .014, M.black);
}

// ---------------------------------------------------------------- dust
let dustMat;
function buildDust() {
  const n = 420, p = new Float32Array(n * 3), sd = new Float32Array(n);
  for (let i = 0; i < n; i++) { p.set([rr(X0 + .3, X1 - .3), rr(.15, 3.0), rr(Z0 + .3, Z1 - .3)], i * 3); sd[i] = rnd(); }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(p, 3)); g.setAttribute('sd', new THREE.BufferAttribute(sd, 1));
  dustMat = new THREE.ShaderMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, uniforms: { time: { value: 0 }, vh: { value: 720 }, warm: { value: 1 } },
    vertexShader: `attribute float sd; uniform float time, vh, warm; varying float vA;
      void main(){ vec3 p=position; p.x+=sin(time*.11+sd*40.)*.35; p.y+=sin(time*.07+sd*23.)*.22+time*.004*(sd-.3); p.z+=cos(time*.09+sd*31.)*.35; p.y=mod(p.y,3.1);
        vec4 mv=modelViewMatrix*vec4(p,1.); gl_Position=projectionMatrix*mv; float px=(.006+sd*.008)*projectionMatrix[1][1]*vh*.5/max(-mv.z,.12); float k=min(px/1.3,1.); gl_PointSize=clamp(px,1.3,14.);
        float tw=pow(.5+.5*sin(time*(.6+sd*1.6)+sd*90.),3.); vA=k*k*(.12+.75*tw)*warm*smoothstep(.12,.5,-mv.z); }`,
    fragmentShader: `varying float vA; void main(){ float d=length(gl_PointCoord-.5); gl_FragColor=vec4(vec3(1.,.74,.36)*vA*smoothstep(.5,.05,d),1.); }` });
  const pts = new THREE.Points(g, dustMat); pts.frustumCulled = false; scene.add(pts); dustMat.userData.pts = pts;
}

// ---------------------------------------------------------------- lights
let hemi, winLight, roomFill;
function buildLights() {
  hemi = new THREE.HemisphereLight(0x5a4038, 0x2a120a, .85); scene.add(hemi);
  roomFill = new THREE.PointLight(0xffb888, 2.2, 12, 1.1); roomFill.position.set(0, 2.7, -.6); scene.add(roomFill);
  winLight = new THREE.SpotLight(0x5f7fd0, 10, 12, .7, 1, 1.4); winLight.position.set(X1 + 3.0, 3.6, ZC); winLight.target.position.set(1.2, 0, ZC); scene.add(winLight, winLight.target);
}

// ---------------------------------------------------------------- environment map（室内を撮って映りこみに使う）
const cubeRT = new THREE.WebGLCubeRenderTarget(COARSE ? 128 : 256, { type: THREE.HalfFloatType });
const cubeCam = new THREE.CubeCamera(.1, 600, cubeRT); cubeCam.position.set(0, 1.45, .7);
const pmrem = new THREE.PMREMGenerator(renderer);
let envRT = null, envUntil = 0, envTimer = 0;
function captureEnv() {
  dustMat.userData.pts.visible = false; snowMat.userData.pts.visible = false;
  const exp = renderer.toneMappingExposure; cubeCam.update(renderer, scene); renderer.toneMappingExposure = exp;
  dustMat.userData.pts.visible = true; snowMat.userData.pts.visible = true;
  const rt = pmrem.fromCubemap(cubeRT.texture); scene.environment = rt.texture;
  for (const m of [M.glass]) { if (!m.envMap) m.needsUpdate = true; m.envMap = rt.texture; }
  if (envRT) envRT.dispose(); envRT = rt;
}

// 映りこみの箱補正：部屋の中央で撮った環境マップを、部屋の箱（壁・床・天井）に当たった位置で引き直す
const BOX_GLSL = `vec3 boxProject( vec3 dir, vec3 wp ) {
  vec3 bmin = vec3( ${X0.toFixed(2)}, 0.0, ${Z0.toFixed(2)} ), bmax = vec3( ${X1.toFixed(2)}, ${WH.toFixed(2)}, ${Z1.toFixed(2)} ), probe = vec3( ${cubeCam.position.x.toFixed(2)}, ${cubeCam.position.y.toFixed(2)}, ${cubeCam.position.z.toFixed(2)} );
  if ( any( lessThan( wp, bmin - 0.3 ) ) || any( greaterThan( wp, bmax + 0.3 ) ) ) return dir;
  vec3 d = dir + ( 1.0 - step( 1e-5, abs( dir ) ) ) * 1e-5;
  vec3 rb = max( ( bmax - wp ) / d, ( bmin - wp ) / d );
  float t = max( min( min( rb.x, rb.y ), rb.z ), 0.0 );
  return normalize( wp + dir * t - probe );
}
`;
const BOX_CHUNK = THREE.ShaderChunk.envmap_physical_pars_fragment.replace('reflectVec = inverseTransformDirection( reflectVec, viewMatrix );', 'reflectVec = inverseTransformDirection( reflectVec, viewMatrix ); reflectVec = boxProject( reflectVec, vBoxWP );');
const BOX_OK = BOX_CHUNK !== THREE.ShaderChunk.envmap_physical_pars_fragment;
function boxify(mat) {
  if (!BOX_OK || mat.userData.box) return; mat.userData.box = true;
  mat.onBeforeCompile = sh => {
    sh.vertexShader = 'varying vec3 vBoxWP;\n' + sh.vertexShader.replace('#include <project_vertex>', '#include <project_vertex>\n\tvBoxWP = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;');
    sh.fragmentShader = 'varying vec3 vBoxWP;\n' + BOX_GLSL + sh.fragmentShader.replace('#include <envmap_physical_pars_fragment>', BOX_CHUNK);
  };
  mat.customProgramCacheKey = () => 'box';
}

// ---------------------------------------------------------------- post
let composer, bloom, finalPass, gtao = null, noAO = [], quality = COARSE ? 'low' : 'mid';
const FinalShader = {
  uniforms: { tDiffuse: { value: null }, time: { value: 0 }, res: { value: new THREE.Vector2(1, 1) }, haze: { value: new THREE.Vector4(.5, .5, .1, .1) }, hazeAmp: { value: 0 }, grade: { value: 1 } },
  vertexShader: `varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.); }`,
  fragmentShader: `uniform sampler2D tDiffuse; uniform float time, hazeAmp, grade; uniform vec2 res; uniform vec4 haze; varying vec2 vUv;
    float hash(vec2 p){ return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453); }
    float vnoise(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.-2.*f); return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x),f.y); }
    void main(){
      // 陽炎：暖炉の上の範囲だけ、上へ流れるノイズで読み取り位置をずらす
      vec2 uv=vUv;
      if(hazeAmp>0.001){ vec2 hz=(vUv-haze.xy)/haze.zw; float m=smoothstep(1.,.15,length(hz))*hazeAmp;
        if(m>0.){ vec2 q=hz*vec2(4.5,6.)-vec2(0.,time*1.7); vec2 n=vec2(vnoise(q)+.5*vnoise(q*2.3+7.),vnoise(q+31.)+.5*vnoise(q*2.3+53.))-.75; uv+=n*m*haze.w*.075; } }
      vec2 c=vUv-.5; float r2=dot(c,c); vec2 off=c*r2*.010;
      vec3 col=vec3(texture2D(tDiffuse,uv+off).r,texture2D(tDiffuse,uv).g,texture2D(tDiffuse,uv-off).b);
      col*=mix(1.,.42,smoothstep(.1,.62,r2));
      // カラーグレーディング：影を青緑へ、光を橙へ、軽いS字、彩度を少し
      float l=dot(col,vec3(.2126,.7152,.0722));
      vec3 g=mix(col,col*col*(3.-2.*col),.16);
      g*=mix(vec3(.86,1.0,1.14),vec3(1.08,1.0,.88),smoothstep(.03,.55,l));
      float l2=dot(g,vec3(.2126,.7152,.0722)); g=mix(vec3(l2),g,1.1);
      col=mix(pow(col,vec3(1.04,1.0,.98))*vec3(1.03,1.,.96),g,grade);
      float n=fract(sin(dot(floor(vUv*res)+time*61.,vec2(12.9898,78.233)))*43758.5453);
      col+=(n-.5)*.024; gl_FragColor=vec4(max(col,0.),1.); }`
};
// 画質ごとの設定。maxPx は描画バッファの画素数の上限、ao は GTAO の解像度の倍率（0 で無効）。
const QUAL = {
  low: { jp: '軽量', dpr: 1.25, maxPx: 1.6e6, msaa: 0, fxaa: false, ao: 0, aoSamples: 0, pdSamples: 0, lampShadow: false },
  mid: { jp: '標準', dpr: 1.5, maxPx: 2.1e6, msaa: 0, fxaa: true, ao: .5, aoSamples: 8, pdSamples: 8, lampShadow: true },
  high: { jp: '高', dpr: 2, maxPx: 2.4e6, msaa: 4, fxaa: false, ao: .5, aoSamples: 8, pdSamples: 8, lampShadow: true },
};
// 自動の解像度調整：fps が足りないとき、描く画素数を段階的に下げる（上げ戻しはしない）
const auto = { scale: 1, acc: 0, n: 0, slow: 0, good: 0, last: 0, grace: 0, triedUp: false, locked: false };
function autoReset() { auto.scale = 1; auto.slow = auto.good = 0; auto.triedUp = auto.locked = false; }
function autoScale(now) {
  const d = now - auto.last; auto.last = now;
  if (now < auto.grace || d > 250 || d <= 0) { auto.acc = auto.n = 0; return; }   // 作り直した直後と、止まっていたフレームは数えない
  auto.acc += d; auto.n++; if (auto.acc < 1000) return;
  const fps = auto.n * 1000 / auto.acc; auto.acc = auto.n = 0;
  auto.slow = fps < 50 ? auto.slow + 1 : 0; auto.good = fps >= 58 ? auto.good + 1 : 0;
  if (auto.slow >= 2 && auto.scale > .5) { if (auto.triedUp) auto.locked = true; auto.scale = Math.max(.5, auto.scale * .85); auto.slow = 0; buildComposer(); }
  // 15秒つづけて余裕があれば、一度だけ1段戻してみる。戻して足りなければ下げ直して、そこで固定する
  else if (auto.good >= 15 && auto.scale < 1 && !auto.locked) { auto.scale = Math.min(1, auto.scale / .85); auto.triedUp = true; auto.good = 0; buildComposer(); }
}
let cfgOver = null, bufSize = new THREE.Vector2(), gradeOn = true;
function buildComposer() {
  const Q = { ...QUAL[quality], ...(cfgOver || {}) }; auto.grace = performance.now() + 2500;
  const w = window.innerWidth, h = window.innerHeight;
  const dpr = Math.min(window.devicePixelRatio || 1, Q.dpr, Math.sqrt(Q.maxPx / (w * h))) * auto.scale;
  renderer.setPixelRatio(dpr); renderer.setSize(w, h, false);
  const size = renderer.getDrawingBufferSize(new THREE.Vector2()); bufSize.copy(size);
  const rt = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: Q.msaa });
  if (composer) composer.dispose();
  composer = new EffectComposer(renderer, rt);
  composer.addPass(new RenderPass(scene, camera));
  // アンビエントオクルージョン。半分の解像度で計算する。半透明・抜きのある物・粒・細い見切りは、法線と深度を撮る間だけ隠す。
  if (gtao) { gtao.dispose(); gtao = null; }
  if (Q.ao > 0) {
    const aw = Math.max(2, Math.round(size.x * Q.ao)), ah = Math.max(2, Math.round(size.y * Q.ao));
    gtao = new GTAOPass(scene, camera, aw, ah, undefined, { radius: .5, distanceExponent: 1.2, thickness: 1.2, scale: 1.7, samples: Q.aoSamples, distanceFallOff: 1, screenSpaceRadius: false }, { lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 5, rings: 2, samples: Q.pdSamples });
    gtao.blendIntensity = 1;
    const run = gtao.render.bind(gtao), setSize = gtao.setSize.bind(gtao);
    gtao.setSize = () => setSize(aw, ah);     // 合成器が全解像度に戻さないようにする
    gtao.render = (...a) => { for (const o of noAO) o.visible = false; run(...a); for (const o of noAO) o.visible = true; };
    composer.addPass(gtao);
  }
  for (const m of shMats) m.opacity = m.userData.op * (gtao ? .6 : 1);
  bloom = new UnrealBloomPass(new THREE.Vector2(size.x, size.y), quality === 'low' ? .44 : .5, .8, 1.0);
  composer.addPass(bloom); composer.addPass(new OutputPass());
  if (Q.fxaa) { const fx = new ShaderPass(FXAAShader); fx.uniforms.resolution.value.set(1 / size.x, 1 / size.y); composer.addPass(fx); }
  finalPass = new ShaderPass(FinalShader); finalPass.uniforms.res.value.set(size.x, size.y); finalPass.uniforms.grade.value = gradeOn ? 1 : 0; composer.addPass(finalPass);
  camera.aspect = w / h; camera.fov = w < h ? 80 : 66; camera.updateProjectionMatrix();
  for (const m of [fire.embers, bokehMat, snowMat, dustMat]) m.uniforms.vh.value = size.y;
  fire.light.shadow.mapSize.setScalar(quality === 'low' ? 512 : 1024);
  if (fire.light.shadow.map) { fire.light.shadow.map.dispose(); fire.light.shadow.map = null; }
  lamp.light.castShadow = Q.lampShadow; lamp.light.shadow.mapSize.setScalar(512);
  if (lamp.light.shadow.map) { lamp.light.shadow.map.dispose(); lamp.light.shadow.map = null; }
  renderer.shadowMap.needsUpdate = true;
}

// ---------------------------------------------------------------- player
const player = { x: 0, z: 2.5, yaw: 0, pitch: -.06, vx: 0, vz: 0, bob: 0, eye: 1.62, seat: null };
const keys = new Set(); const stick = { id: -1, ox: 0, oy: 0, x: 0, y: 0 }; const lookT = { id: -1, x: 0, y: 0 };
let state = 'menu', hadLock = false, time = 0;
const PR = .3;
function collide(p) {
  for (let it = 0; it < 3; it++) {
    for (const s of segs) {
      if (!s.on) continue; const dx = s.bx - s.ax, dz = s.bz - s.az;
      const t = clamp(((p.x - s.ax) * dx + (p.z - s.az) * dz) / (dx * dx + dz * dz), 0, 1), cx = s.ax + dx * t, cz = s.az + dz * t;
      const ox = p.x - cx, oz = p.z - cz, d = Math.hypot(ox, oz); if (d < PR && d > 1e-6) { p.x = cx + ox / d * PR; p.z = cz + oz / d * PR; }
    }
    for (const c of circles) { const ox = p.x - c.x, oz = p.z - c.z, d = Math.hypot(ox, oz), m = c.r + PR; if (d < m && d > 1e-6) { p.x = c.x + ox / d * m; p.z = c.z + oz / d * m; } }
  }
}
const onRug = () => Math.abs(player.x) < 2.9 && player.z > -2.75 && player.z < 1.25;
function sit(s) { player.seat = s; player.vx = player.vz = 0; audio.cloth(); toast('SEATED'); }
function stand() { const s = player.seat; if (!s) return; player.seat = null; player.x = s.ex; player.z = s.ez; audio.cloth(); }
function updatePlayer(dt) {
  let fx = 0, fz = 0;
  if (state === 'play') {
    if (keys.has('KeyW') || keys.has('ArrowUp')) fz += 1; if (keys.has('KeyS') || keys.has('ArrowDown')) fz -= 1;
    if (keys.has('KeyD') || keys.has('ArrowRight')) fx += 1; if (keys.has('KeyA') || keys.has('ArrowLeft')) fx -= 1;
    fx += stick.x; fz -= stick.y;
  }
  const l = Math.hypot(fx, fz); if (l > 1) { fx /= l; fz /= l; }
  const ke = 1 - Math.exp(-dt * 6);
  if (player.seat) {
    if (l > .6) stand();
    else { const s = player.seat; player.x += (s.x - player.x) * ke; player.z += (s.z - player.z) * ke; player.eye += (1.1 - player.eye) * ke; camera.position.set(player.x, player.eye + Math.sin(time * 1.1) * .004, player.z); camera.rotation.set(player.pitch, player.yaw, 0); return; }
  }
  player.eye += (1.62 - player.eye) * ke;
  const sp = (keys.has('ShiftLeft') || keys.has('ShiftRight') || l > 1.01) ? 3.4 : 2.1;
  const sn = Math.sin(player.yaw), cs = Math.cos(player.yaw);
  const tx = (-sn * fz + cs * fx) * sp, tz = (-cs * fz - sn * fx) * sp;
  const k = 1 - Math.exp(-dt * 11); player.vx += (tx - player.vx) * k; player.vz += (tz - player.vz) * k;
  player.x += player.vx * dt; player.z += player.vz * dt; collide(player);
  const v = Math.hypot(player.vx, player.vz), b0 = player.bob; player.bob += v * dt * 2.6;
  if (v > .8 && Math.floor(b0 / Math.PI + .25) !== Math.floor(player.bob / Math.PI + .25)) audio.step(onRug());
  camera.position.set(player.x, player.eye + Math.sin(player.bob * 2) * .012 * Math.min(v / 2.1, 1), player.z);
  camera.rotation.set(player.pitch, player.yaw, Math.sin(player.bob) * .0025 * Math.min(v / 2.1, 1));
}
function look(dx, dy, s) { player.yaw -= dx * s; player.pitch = clamp(player.pitch - dy * s, -1.35, 1.35); }

// ---------------------------------------------------------------- interaction
const interactables = [];
let focus = null, toastTimer = 0;
function toast(msg) { const t = $('toast'); t.textContent = msg; t.classList.add('on'); toastTimer = 2.4; }
const standIt = { label: () => '立ち上がる', act: stand };
function updateFocus() {
  focus = null;
  if (player.seat) {   // 座っている間は、正面にある物だけ操作できる。無ければ「立ち上がる」
    const sn = Math.sin(player.yaw), cs = Math.cos(player.yaw); let best = .9;
    for (const it of interactables) { if (it.seat) continue; const dx = it.pos.x - player.x, dz = it.pos.z - player.z, d = Math.hypot(dx, dz); if (d > it.r + .6) continue; const f = (dx * -sn + dz * -cs) / (d || 1); if (f > best) { best = f; focus = it; } }
    if (!focus) focus = standIt;
  } else {
    let best = 1e9; const sn = Math.sin(player.yaw), cs = Math.cos(player.yaw);
    for (const it of interactables) {
      const dx = it.pos.x - player.x, dz = it.pos.z - player.z, d = Math.hypot(dx, dz); if (d > it.r) continue;
      const facing = (dx * -sn + dz * -cs) / (d || 1); if (facing < .5 && d > .5) continue;
      const score = d - facing * .8; if (score < best) { best = score; focus = it; }
    }
  }
  const p = $('prompt'), on = !!focus && state === 'play';
  if (on) p.innerHTML = (COARSE ? '' : '<kbd>E</kbd>') + focus.label();
  p.classList.toggle('on', on); $('actBtn').classList.toggle('on', on && COARSE);
}
function interact() { if (state === 'play' && focus) focus.act(); }

const FIRE_T = [.3, .7, 1.08], FIRE_N = ['EMBERS', 'HEARTH', 'BLAZE'], FIRE_L = ['火を落とす ― 熾火', '火を整える ― ふつう', '薪をくべる ― 強火'];
function setFire(i, instant) { fire.level = i; if (instant) fire.cur = FIRE_T[i]; envUntil = time + 2.2; audio.fire(i); }
function setLamp(v, instant) { lamp.on = v; if (instant) lamp.cur = v ? 1 : 0; envUntil = time + 1.2; }

// ---------------------------------------------------------------- build
async function build() {
  buildShell(); buildLights(); buildFireplace(); buildWindowWall(); buildWestWall(); buildSouthWall();
  buildSofa(-2.08, -.8, Math.PI / 2, [[-.82, 'cushRed', .5, .5], [-.5, 'cushGold', .15], [.1, 'cushRed', -.2, .5]], .5);
  buildSofa(2.08, -.8, -Math.PI / 2, [[-.8, 'cushGold', .45, .44], [.78, 'cushAmber', -.5, .5], [.42, 'cushGold', -.1, .42]]);
  buildTable(); buildLamp(); buildDust();
  plant(3.0, -3.42, 1.05); plant(-4.02, -3.4, 1.15); plant(-3.95, 2.85, 1.0); plant(4.0, 2.9, .9);

  interactables.push({ pos: fire.pos, r: 2.0, label: () => FIRE_L[(fire.level + 1) % 3], act: () => { const n = (fire.level + 1) % 3; setFire(n); if (n === 2) audio.stoke(); toast('FIRE : ' + FIRE_N[n]); } });
  interactables.push({ pos: lamp.pos, r: 1.5, label: () => lamp.on ? 'ランプを消す' : 'ランプを点ける', act: () => { setLamp(!lamp.on); audio.click(); toast('LAMP : ' + (lamp.on ? 'ON' : 'OFF')); } });
  interactables.push({ pos: radio.pos, r: 1.7, label: () => radio.on ? 'ラジオを止める' : 'ラジオをかける', act: () => { radio.on = !radio.on; audio.radio(radio.on); toast('RADIO : ' + (radio.on ? 'ON' : 'OFF')); } });
  for (const s of seats) interactables.push({ seat: true, pos: s.pos, r: 1.25, label: () => 'ソファに座る', act: () => sit(s) });

  scene.traverse(o => { if (o.isMesh && o.material.isMeshStandardMaterial) boxify(o.material); });
  scene.traverse(o => { const m = o.material; if (o.isPoints || (o.isMesh && m && (m.transparent || m.alphaTest > 0 || m.isShaderMaterial))) { noAO.push(o); return; }
    if (o.isMesh) { o.geometry.computeBoundingBox(); const d = o.geometry.boundingBox.getSize(new THREE.Vector3()).multiply(o.scale).toArray().sort((p, q) => p - q); if (d[1] < .035) noAO.push(o); } });
  fire.cur = FIRE_T[fire.level]; applyDynamic(0); buildComposer(); captureEnv(); captureEnv();
  window.addEventListener('resize', () => { auto.slow = auto.good = 0; auto.triedUp = auto.locked = false; buildComposer(); });
  requestAnimationFrame(t => { last = t; tick(t); });
}

// 炎・ランプ・ラジオの明るさを毎フレーム反映する
function applyDynamic(dt) {
  fire.cur += (FIRE_T[fire.level] - fire.cur) * (1 - Math.exp(-dt * 1.3));
  lamp.cur += ((lamp.on ? 1 : 0) - lamp.cur) * (1 - Math.exp(-dt * 7));
  radio.glow += ((radio.on ? 1 : 0) - radio.glow) * (1 - Math.exp(-dt * 5));
  const t = time, fl = .84 + .09 * Math.sin(t * 11.3) + .055 * Math.sin(t * 23.7 + 1.3) + .05 * Math.sin(t * 5.1 + .7) + .04 * Math.sin(t * 37.1), L = fire.cur;
  for (const m of fire.mats) { m.uniforms.time.value = t; m.uniforms.level.value = L; }
  fire.coals.uniforms.time.value = t; fire.coals.uniforms.level.value = L; fire.embers.uniforms.time.value = t; fire.embers.uniforms.level.value = L;
  fire.light.intensity = (2.5 + 12 * L) * fl; fire.fill.intensity = (.5 + 2.2 * L) * fl; roomFill.intensity = (.7 + 1.6 * L + 1.1 * lamp.cur) * (.9 + .1 * fl);
  fire.light.color.setRGB(1, .44 + .1 * L, .14 + .07 * L);
  for (const m of fire.logs) m.emissiveIntensity = (1.1 + 1.6 * L) * (.8 + .2 * Math.sin(t * 3 + m.id));
  const lv = .5 + .7 * L * fl; fire.liner.color.setRGB(lv, lv * .9, lv * .8);
  const cf = .85 + .15 * Math.sin(t * 13.1) * Math.sin(t * 5.7);
  for (const f of candleFlames) f.scale.set(.8, 2.0 + .5 * Math.sin(t * 9 + f.id), .8);
  candleLight.intensity = 1.6 * cf;
  const lc = lamp.cur; M.shade.color.setRGB(.16 + 1.9 * lc, .11 + 1.25 * lc, .06 + .62 * lc); lamp.light.intensity = 11 * lc;
  const rg = radio.glow; M.dial.color.setRGB(.12 + 1.9 * rg, .09 + 1.3 * rg, .05 + .6 * rg);
  dustMat.uniforms.warm.value = .35 + .5 * L + .25 * lc;
}

// 陽炎の範囲（暖炉の上）を画面座標に直す
const hzA = new THREE.Vector3(), hzB = new THREE.Vector3(), hzC = new THREE.Vector3();
function updateHaze() {
  const u = finalPass.uniforms; camera.updateMatrixWorld();
  hzC.set(0, .95, Z0 + .3).applyMatrix4(camera.matrixWorldInverse);
  if (hzC.z > -.4) { u.hazeAmp.value = 0; return; }
  hzA.set(0, .3, Z0 + .3).project(camera); hzB.set(0, 1.75, Z0 + .3).project(camera);
  const hh = Math.abs(hzB.y - hzA.y) * .25;
  u.haze.value.set((hzA.x + hzB.x) * .25 + .5, (hzA.y + hzB.y) * .25 + .5, hh * .62 / camera.aspect, hh);
  u.hazeAmp.value = (.25 + .75 * fire.cur) * (hazeOn ? 1 : 0);
}
let hazeOn = true;
// 窓の外：離れているときはボケた街、窓に寄るとピントが合う
const cityLayers = []; let cityFocus = 0;
function updateCityFocus(dt) {
  const d = X1 - player.x, want = d < 1.2 ? 1 : d > 2.6 ? 0 : (2.6 - d) / 1.4;
  cityFocus += (want - cityFocus) * (1 - Math.exp(-dt * 3)); const f = cityFocus * cityFocus * (3 - 2 * cityFocus);
  for (const L of cityLayers) { L.sharp.opacity = f; L.soft.opacity = 1 - f; L.sharp.visible = f > .01; L.soft.visible = f < .99; }
}

// ---------------------------------------------------------------- loop
let last = 0, fpsAcc = 0, fpsN = 0;
function tick(now) {
  requestAnimationFrame(tick);
  const raw = (now - last) / 1000, dt = Math.min(raw, .05); last = now; time += dt; if (!document.hidden && !cfgOver) autoScale(now);
  if (state === 'menu' && !player.seat) { player.yaw = Math.sin(time * .14) * .3; player.pitch = -.07 + Math.sin(time * .1) * .025; }
  updatePlayer(dt); updateFocus(); applyDynamic(dt);
  if (time < envUntil) { envTimer += dt; if (envTimer > .3) { envTimer = 0; captureEnv(); } } else if (envUntil > 0) { envUntil = 0; captureEnv(); captureEnv(); }
  audio.listener(camera.position.x, camera.position.y, camera.position.z, player.yaw);
  updateHaze(); updateCityFocus(dt);
  bokehMat.uniforms.time.value = time; snowMat.uniforms.time.value = time; dustMat.uniforms.time.value = time; finalPass.uniforms.time.value = time % 100;
  if (toastTimer > 0) { toastTimer -= dt; if (toastTimer <= 0) $('toast').classList.remove('on'); }
  renderer.info.reset(); composer.render(dt);
  if (DEBUG) { fpsAcc += raw; fpsN++; if (fpsAcc > .5) { $('dbg').textContent = `${(fpsN / fpsAcc).toFixed(0)} fps  x ${player.x.toFixed(2)} z ${player.z.toFixed(2)}  yaw ${player.yaw.toFixed(2)}  ${quality} ${bufSize.x}x${bufSize.y} x${auto.scale.toFixed(2)} ao ${gtao ? 'on' : 'off'}  calls ${renderer.info.render.calls}  tris ${renderer.info.render.triangles}`; fpsAcc = fpsN = 0; } }
}

// ---------------------------------------------------------------- input / ui
function lock() { if (COARSE) return; try { const p = canvas.requestPointerLock(); if (p && p.catch) p.catch(() => { }); } catch (e) { } }
function start() {
  audio.init({ fireP: new THREE.Vector3(0, .5, Z0 + .4), radioP: radio.pos.clone(), winP: new THREE.Vector3(X1, 1.8, ZC) }, { fire: fire.level, radio: radio.on });
  state = 'play'; $('menu').classList.add('hide'); $('hud').classList.add('on'); if (!start.once) { start.once = true; player.yaw = 0; player.pitch = -.06; } lock(); canvas.focus();
}
function pause() { state = 'menu'; keys.clear(); stick.x = stick.y = 0; stick.id = -1; lookT.id = -1; $('stick').style.display = 'none'; $('menu').classList.remove('hide'); $('hud').classList.remove('on'); $('startBtn').firstChild.textContent = 'RESUME'; $('startSub').textContent = '戻る'; if (document.pointerLockElement) document.exitPointerLock(); }
$('startBtn').addEventListener('click', start);
$('qualBtn').addEventListener('click', () => { quality = { low: 'mid', mid: 'high', high: 'low' }[quality]; $('qualSub').textContent = QUAL[quality].jp; autoReset(); buildComposer(); });
$('qualSub').textContent = QUAL[quality].jp;
$('pauseBtn').addEventListener('click', pause);
// 全画面（ブラウザや埋めこみ先が拒否することがある）
const fsOn = () => !!(document.fullscreenElement || document.webkitFullscreenElement);
function toggleFs() {
  const el = document.documentElement;
  try { const p = fsOn() ? (document.exitFullscreen || document.webkitExitFullscreen).call(document) : (el.requestFullscreen || el.webkitRequestFullscreen).call(el); if (p && p.catch) p.catch(() => { $('fsSub').textContent = '使えません'; }); }
  catch (e) { $('fsSub').textContent = '使えません'; }
}
$('fsBtn').addEventListener('click', toggleFs);
$('gradeBtn').addEventListener('click', () => { gradeOn = !gradeOn; finalPass.uniforms.grade.value = gradeOn ? 1 : 0; $('gradeSub').textContent = gradeOn ? '入' : '切'; });
for (const ev of ['fullscreenchange', 'webkitfullscreenchange']) document.addEventListener(ev, () => { $('fsSub').textContent = fsOn() ? '入' : '切'; });
$('sndBtn').addEventListener('click', () => { $('sndSub').textContent = audio.toggle() ? '入' : '切'; });
for (const k of ['bgm', 'se']) {
  const el = $(k + 'Vol'), out = $(k + 'Val'); let v = k === 'bgm' ? 50 : 60;
  try { const sv = localStorage.getItem('lounge.vol.' + k); if (sv !== null && isFinite(+sv)) v = clamp(+sv, 0, 100); } catch (e) { }
  const set = (n, save) => { el.value = n; out.textContent = n + '%'; el.style.setProperty('--p', n + '%'); audio.volume(k, n / 100); if (save) try { localStorage.setItem('lounge.vol.' + k, n); } catch (e) { } };
  set(v, false); el.addEventListener('input', () => set(+el.value, true));
}
$('actBtn').addEventListener('pointerdown', e => { e.stopPropagation(); interact(); });
document.addEventListener('pointerlockchange', () => { const l = document.pointerLockElement === canvas; if (l) hadLock = true; else if (hadLock && state === 'play') pause(); });
addEventListener('keydown', e => {
  if (e.code === 'F3') { DEBUG = !DEBUG; if (!DEBUG) $('dbg').textContent = ''; e.preventDefault(); return; }
  if (e.code === 'Escape') { state === 'play' ? pause() : 0; return; }
  if (state !== 'play') return; keys.add(e.code);
  if ((e.code === 'KeyE' || e.code === 'Enter') && !e.repeat) interact();
  if (e.code.startsWith('Arrow') || e.code === 'Space') e.preventDefault();
});
addEventListener('keyup', e => keys.delete(e.code)); addEventListener('blur', () => keys.clear());
canvas.addEventListener('pointerdown', e => {
  if (state !== 'play') return;
  if (e.pointerType === 'touch') {
    e.preventDefault();
    if (e.clientX < innerWidth * .45 && stick.id < 0) { stick.id = e.pointerId; stick.ox = e.clientX; stick.oy = e.clientY; const s = $('stick'); s.style.display = 'block'; s.style.left = e.clientX + 'px'; s.style.top = e.clientY + 'px'; s.firstChild.style.transform = ''; }
    else if (lookT.id < 0) { lookT.id = e.pointerId; lookT.x = e.clientX; lookT.y = e.clientY; }
  } else if (document.pointerLockElement === canvas) { if (e.button === 0) interact(); } else lock();
});
addEventListener('pointermove', e => {
  if (state !== 'play') return;
  if (e.pointerType === 'touch') {
    if (e.pointerId === stick.id) { let dx = e.clientX - stick.ox, dy = e.clientY - stick.oy; const l = Math.hypot(dx, dy), mx = 52; if (l > mx) { dx *= mx / l; dy *= mx / l; } stick.x = dx / mx; stick.y = dy / mx; $('stick').firstChild.style.transform = `translate(${dx}px,${dy}px)`; }
    else if (e.pointerId === lookT.id) { look(e.clientX - lookT.x, e.clientY - lookT.y, .0048); lookT.x = e.clientX; lookT.y = e.clientY; }
  } else if (document.pointerLockElement === canvas || (e.buttons & 1)) look(e.movementX || 0, e.movementY || 0, .0022);
});
const endTouch = e => { if (e.pointerId === stick.id) { stick.id = -1; stick.x = stick.y = 0; $('stick').style.display = 'none'; } if (e.pointerId === lookT.id) lookT.id = -1; };
addEventListener('pointerup', endTouch); addEventListener('pointercancel', endTouch);
canvas.addEventListener('contextmenu', e => e.preventDefault());

// 確認用の窓口
window.ROOM = {
  pose(x, z, yaw, pitch = 0) { player.seat = null; player.x = x; player.z = z; player.yaw = yaw; player.pitch = pitch; player.vx = player.vz = 0; player.eye = 1.62; state = 'play'; $('menu').classList.add('hide'); $('hud').classList.add('on'); },
  fire(i) { setFire(i, true); }, lamp(v) { setLamp(v, true); }, sit(i) { const s = seats[i]; player.seat = s; player.yaw = s.yaw; player.x = s.x; player.z = s.z; player.eye = 1.1; state = 'play'; $('menu').classList.add('hide'); $('hud').classList.add('on'); },
  env() { captureEnv(); captureEnv(); }, ao(mode) { if (gtao) gtao.output = mode; return !!gtao; }, grade(v) { gradeOn = !!v; finalPass.uniforms.grade.value = v ? 1 : 0; }, haze(v) { hazeOn = !!v; }, get box() { return BOX_OK; }, cfg(o) { cfgOver = o; autoReset(); buildComposer(); return { w: bufSize.x, h: bufSize.y, noAO: noAO.length }; },
  bench(n = 20) { const gl = renderer.getContext(), px = new Uint8Array(4); const t = performance.now(); for (let i = 0; i < n; i++) { renderer.info.reset(); composer.render(.016); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); } return +((performance.now() - t) / n).toFixed(1); }, exposure(v) { renderer.toneMappingExposure = v; }, audio, quality(q) { quality = q; autoReset(); buildComposer(); $('qualSub').textContent = QUAL[q].jp; },
  get state() { return { x: player.x, z: player.z, yaw: player.yaw, eye: player.eye, seated: !!player.seat, fire: fire.level, lamp: lamp.on, radio: radio.on, audio: audio.ready, state, prompt: $('prompt').textContent, calls: renderer.info.render.calls, tris: renderer.info.render.triangles }; },
  get dev() { return { auto, autoScale, bufSize, scene, renderer, composer, bloom, fire, lamp, winLight, roomFill, candleLight, hemi, M, THREE }; },
  ready: false
};
build().then(() => { window.ROOM.ready = true; }).catch(e => { console.error(e); $('startSub').textContent = '起動に失敗しました'; });
