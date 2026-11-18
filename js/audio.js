// 音はすべて Web Audio で合成する（音声ファイルなし）。
// 構成：暖炉（燃える音・はぜる音）、ラジオから流れるピアノ（BGM）、窓の外の風、足音、操作音。
const mtof = m => 440 * Math.pow(2, (m - 69) / 12);
const hash = (k, s) => { const v = Math.sin(k * 12.9898 + s * 78.233) * 43758.5453; return v - Math.floor(v); };

// BGM の和声（オリジナル）。b は低音、v は和音。
const BARS = [
  { b: 50, v: [53, 57, 60, 64] }, { b: 55, v: [53, 59, 64, 69] }, { b: 48, v: [52, 59, 62, 67] }, { b: 45, v: [55, 61, 64, 70] },
  { b: 50, v: [53, 57, 60, 64] }, { b: 49, v: [53, 59, 63, 67] }, { b: 48, v: [52, 57, 62, 67] }, { b: 52, v: [55, 58, 62, 67] },
];
export const BEAT = 60 / 58, BAR = BEAT * 4;
export const MUSIC_GAIN = 3.0;   // BGM つまみ 100% のときの倍率
export const FIRE = { roar: [.056, .126, .217], hiss: [.012, .025, .042], gap: [.6, .17, .08] };

export function buildGraph(ctx) {
  const G = (v, to) => { const g = ctx.createGain(); g.gain.value = v; if (to) g.connect(to); return g; };
  const master = G(1.5);
  const comp = ctx.createDynamicsCompressor(); comp.threshold.value = -16; comp.ratio.value = 3; comp.attack.value = .02; comp.release.value = .3;
  const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 70; hp.Q.value = .5;
  master.connect(hp); hp.connect(comp); comp.connect(ctx.destination);

  // 残響（短め：絨毯とベルベットの部屋）
  const len = Math.floor(ctx.sampleRate * 1.7), ir = ctx.createBuffer(2, len, ctx.sampleRate);
  let s = 24680; const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
  for (let c = 0; c < 2; c++) { const d = ir.getChannelData(c); let lp = 0; for (let i = 0; i < len; i++) { const t = i / len; const n = (rnd() * 2 - 1) * Math.pow(1 - t, 3.2) * (i < 300 ? i / 300 : 1); lp += (n - lp) * (0.5 - t * 0.38); d[i] = lp; } }
  const conv = ctx.createConvolver(); conv.buffer = ir; const rev = G(1); rev.connect(conv); conv.connect(G(0.4, master));
  const se = G(1, master); se.connect(G(0.18, rev));

  const nb = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate); { const d = nb.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = rnd() * 2 - 1; }
  const noise = (loop = true) => { const n = ctx.createBufferSource(); n.buffer = nb; n.loop = loop; return n; };
  const filt = (type, f, q = .7) => { const b = ctx.createBiquadFilter(); b.type = type; b.frequency.value = f; b.Q.value = q; return b; };
  const panner = (dest, ref = 1.2, roll = 1.4) => { const p = ctx.createPanner(); p.panningModel = 'equalpower'; p.distanceModel = 'inverse'; p.refDistance = ref; p.rolloffFactor = roll; p.maxDistance = 30; p.connect(dest); return p; };
  function blip(t, f, dest, v = .03, dur = .07, type = 'sine') { const o = ctx.createOscillator(), g = ctx.createGain(); o.type = type; o.frequency.value = f; g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(v, t + .004); g.gain.exponentialRampToValueAtTime(.0001, t + dur); o.connect(g); g.connect(dest); o.start(t); o.stop(t + dur + .02); }
  function burst(t, type, f, q, v, atk, dur, dest) { const n = noise(false), b = filt(type, f, q), g = ctx.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(v, t + atk); g.gain.exponentialRampToValueAtTime(.0001, t + atk + dur); n.connect(b).connect(g); g.connect(dest); n.start(t, rnd() * 1.5); n.stop(t + atk + dur + .05); return b; }

  // ---- ラジオ（BGM）：ピアノ → 帯域を絞る → 音量つまみ → ラジオの位置
  const musicBus = G(MUSIC_GAIN * .5); const radioP = panner(master, 1.6, 1.0); musicBus.connect(radioP); musicBus.connect(G(.3, rev));
  const radioSw = G(1, musicBus);
  const rHP = filt('highpass', 240, .6), rLP = filt('lowpass', 3300, .5), rPk = filt('peaking', 1300, .8); rPk.gain.value = 3.5;
  const musicIn = G(1); musicIn.connect(rHP).connect(rPk).connect(rLP).connect(radioSw);
  const hissN = noise(); hissN.connect(filt('bandpass', 5200, .5)).connect(G(.0016, radioSw)); hissN.start(.2);
  function piano(m, t, vel) {
    const f = mtof(m), T = Math.max(1.1, 3.4 - (m - 45) * .045), g = ctx.createGain(), lp = filt('lowpass', 5200, .3);
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vel, t + .006); g.gain.exponentialRampToValueAtTime(vel * .35, t + .28); g.gain.exponentialRampToValueAtTime(.0001, t + T);
    lp.frequency.setValueAtTime(Math.min(6000, f * 9), t); lp.frequency.exponentialRampToValueAtTime(Math.max(500, f * 1.6), t + T * .8);
    lp.connect(g); g.connect(musicIn);
    for (const [h, a] of [[1, 1], [2.001, .46], [3.003, .2], [4.007, .1], [5.012, .05]]) { const o = ctx.createOscillator(); o.frequency.value = f * h; o.detune.value = (h * 31 % 5) - 2; const og = G(a / 1.8, lp); o.connect(og); o.start(t); o.stop(t + T + .05); }
  }
  // BGM を [from, to) の時間ぶん予約する。t0 は曲の開始時刻。
  function scheduleMusic(t0, from, to) {
    for (let k = Math.max(0, Math.floor((from - t0) / (BEAT / 2)) - 2); ; k++) {
      const t = t0 + Math.floor(k / 2) * BEAT + (k % 2 ? BEAT * .62 : 0); if (t >= to) break; if (t < from) continue;
      const bar = Math.floor(k / 8), st = k % 8, B = BARS[bar % BARS.length], ph = bar % 16, quiet = ph >= 14;
      if (st === 0) { piano(B.b, t, .085); B.v.forEach((m, i) => piano(m, t + .03 + i * .034, .042)); }
      if (st === 3 && hash(bar, 1) < .55 && !quiet) B.v.slice(1).forEach((m, i) => piano(m, t + i * .012, .024));
      if (st === 6 && hash(bar, 2) < .35) piano(B.b + 7, t, .04);
      if (st >= 2 && !quiet && hash(bar, 9) > .18 && hash(k, 3) < .34) { const pool = [...B.v.map(m => m + 12), B.v[3] + 14, B.v[2] + 24]; piano(pool[Math.floor(hash(k, 5) * pool.length)], t, .05 + hash(k, 7) * .035); }
    }
  }

  // ---- 暖炉
  const fireP = panner(se, 2.0, 1.0);
  const roar = noise(), roarG = G(FIRE.roar[1], fireP); roar.connect(filt('lowpass', 430, .5)).connect(filt('highpass', 95, .5)).connect(roarG); roar.playbackRate.value = .8; roar.start();
  const lfo = ctx.createOscillator(); lfo.frequency.value = .43; lfo.connect(G(.03, roarG.gain)); lfo.start();
  const lfo2 = ctx.createOscillator(); lfo2.frequency.value = 2.7; lfo2.connect(G(.016, roarG.gain)); lfo2.start();
  const fh = noise(), hissG = G(FIRE.hiss[1], fireP); fh.connect(filt('bandpass', 2700, .6)).connect(hissG); fh.playbackRate.value = 1.13; fh.start(.4);
  function crackle(t, big) {
    const r = rnd(), v = big ? .5 : .05 + .3 * r * r * r;
    burst(t, 'bandpass', 1100 + rnd() * 4300, 1.5 + rnd() * 4, v, .001, .008 + rnd() * .035, fireP);
    if (big || r > .9) { blip(t, 120 + rnd() * 60, fireP, big ? .2 : .09, .06); burst(t + .012 + rnd() * .02, 'bandpass', 2400 + rnd() * 2000, 3, v * .5, .001, .02, fireP); }
  }
  // ---- 窓の外
  const winP = panner(se, 2.0, 1.2);
  const wind = noise(), windG = G(.016, winP); wind.connect(filt('lowpass', 300, .4)).connect(filt('highpass', 110, .5)).connect(windG); wind.playbackRate.value = .6; wind.start(.9);
  const wl = ctx.createOscillator(); wl.frequency.value = .09; wl.connect(G(.009, windG.gain)); wl.start();

  return {
    master, se, musicBus, radioSw, fireP, radioP, winP, roarG, hissG, scheduleMusic, piano, crackle, blip, burst, rnd, G,
    fire(level) { const t = ctx.currentTime; roarG.gain.setTargetAtTime(FIRE.roar[level], t, .8); hissG.gain.setTargetAtTime(FIRE.hiss[level], t, .8); },
    stoke() { const t = ctx.currentTime + .02; blip(t, 92, fireP, .4, .16); blip(t + .09, 68, fireP, .25, .2); burst(t, 'lowpass', 700, .5, .25, .004, .12, fireP); for (let i = 0; i < 20; i++) crackle(t + .15 + rnd() * rnd() * 1.6, i < 3); const b = burst(t + .1, 'bandpass', 260, .8, .18, .5, .9, fireP); b.frequency.setValueAtTime(260, t + .1); b.frequency.exponentialRampToValueAtTime(1300, t + 1.3); },
    radio(on) { const t = ctx.currentTime; blip(t, 1900, radioP, .02, .02); blip(t + .004, 300, radioP, .05, .05); radioSw.gain.setTargetAtTime(on ? 1 : 0, t + .03, on ? .12 : .04); if (on) burst(t + .03, 'bandpass', 2600, 1.5, .02, .02, .3, radioP); },
    click() { const t = ctx.currentTime; blip(t, 2300, se, .018, .014); blip(t + .003, 340, se, .05, .045); },
    cloth() { const t = ctx.currentTime; burst(t, 'lowpass', 950, .5, .05, .05, .22, se); burst(t + .16, 'lowpass', 700, .5, .03, .04, .2, se); blip(t + .1, 80, se, .05, .12); },
    step(soft) { const t = ctx.currentTime; burst(t, 'lowpass', soft ? 380 : 820, .6, soft ? .045 : .07, .006, soft ? .11 : .075, se); if (!soft) { blip(t, 150 + rnd() * 40, se, .035, .05); blip(t + .002, 1500 + rnd() * 500, se, .004, .018); } },
  };
}

export function createAudio() {
  const vol = { bgm: .5, se: .6 };
  let ctx = null, A = null, on = true, t0 = 0, sched = 0, nextCrackle = 0, level = 1;
  const api = {
    get ready() { return !!ctx; }, get on() { return on; },
    init(pos, st) {
      if (ctx) { if (ctx.state === 'suspended' && on) ctx.resume(); return; }
      const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
      try { ctx = new AC(); A = buildGraph(ctx); } catch (e) { ctx = null; return; }
      for (const k of ['fireP', 'radioP', 'winP']) { const p = pos[k]; A[k].positionX.value = p.x; A[k].positionY.value = p.y; A[k].positionZ.value = p.z; }
      level = st.fire; A.fire(level); A.radioSw.gain.value = st.radio ? 1 : 0;
      A.musicBus.gain.value = MUSIC_GAIN * vol.bgm; A.se.gain.value = vol.se;
      A.master.gain.setValueAtTime(0, ctx.currentTime); A.master.gain.linearRampToValueAtTime(on ? 1.5 : 0, ctx.currentTime + 2.5);
      t0 = ctx.currentTime + 1.5; sched = t0; nextCrackle = ctx.currentTime + .5;
      const pump = () => {
        if (!ctx || ctx.state !== 'running') return; const now = ctx.currentTime;
        if (sched < now) { t0 += Math.ceil((now - sched) / BAR) * BAR; sched = now; }      // 止まっていた分は飛ばす
        if (sched < now + 1.2) { A.scheduleMusic(t0, sched, now + 1.2); sched = now + 1.2; }
        if (nextCrackle < now) nextCrackle = now;
        while (nextCrackle < now + .3) { A.crackle(nextCrackle, A.rnd() < .03); nextCrackle += FIRE.gap[level] * (.15 + A.rnd() * 1.9); }
      };
      setInterval(pump, 200); pump();
      document.addEventListener('visibilitychange', () => { if (!ctx) return; document.hidden ? ctx.suspend() : (on && ctx.resume()); });
    },
    // 音量（つまみの値 0〜1）
    volume(kind, v) { vol[kind] = v; if (!ctx) return; (kind === 'bgm' ? A.musicBus.gain : A.se.gain).setTargetAtTime(kind === 'bgm' ? MUSIC_GAIN * v : v, ctx.currentTime, .05); },
    get vol() { return vol; },
    toggle() { on = !on; if (ctx) { if (on) ctx.resume(); A.master.gain.setTargetAtTime(on ? 1.5 : 0, ctx.currentTime, .15); } return on; },
    listener(x, y, z, yaw) {
      if (!ctx) return; const L = ctx.listener, fx = -Math.sin(yaw), fz = -Math.cos(yaw);
      if (L.positionX) { L.positionX.value = x; L.positionY.value = y; L.positionZ.value = z; L.forwardX.value = fx; L.forwardY.value = 0; L.forwardZ.value = fz; L.upX.value = 0; L.upY.value = 1; L.upZ.value = 0; }
      else { L.setPosition(x, y, z); L.setOrientation(fx, 0, fz, 0, 1, 0); }
    },
    fire(i) { level = i; ctx && A.fire(i); }, stoke() { ctx && on && A.stoke(); }, radio(v) { ctx && A.radio(v); },
    click() { ctx && on && A.click(); }, cloth() { ctx && on && A.cloth(); }, step(s) { ctx && on && A.step(s); },
  };
  return api;
}
