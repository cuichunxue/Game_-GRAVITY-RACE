// Sound effects synthesised with Web Audio (素材リスト S-01〜S-20). Zero bytes of audio files on first load;
// the list's rule is "合成版で試作して聞き比べる" before buying anything. Starts muted (通勤中のプレイ想定).
// Levels: master gain 0.5 ≈ -6 dBFS peak, a compressor catches stacked one-shots.
'use strict';
const SFX = (() => {
  let ac = null, master = null, noiseBuf = null, muted = true, roll = null;

  function ensure() {
    if (muted) return null;
    if (!ac) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      ac = new AC();
      const comp = ac.createDynamicsCompressor();
      master = ac.createGain(); master.gain.value = 0.5;
      master.connect(comp); comp.connect(ac.destination);
    }
    if (ac.state === 'suspended') ac.resume();
    return ac;
  }
  function noise() {
    if (!noiseBuf) {
      const n = ac.sampleRate * 2; noiseBuf = ac.createBuffer(1, n, ac.sampleRate);
      const d = noiseBuf.getChannelData(0); let b = 0;
      // slightly brown noise: rolling sounds are mostly low-mid rumble
      for (let i = 0; i < n; i++) { b = 0.86 * b + 0.14 * (Math.random() * 2 - 1); d[i] = b * 2.4; }
    }
    return noiseBuf;
  }
  function env(g, t0, peak, attack, dur) {
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(peak, t0 + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  }
  // one oscillator note, optionally sliding to f2
  function tone(f, { f2, type = 'sine', at = 0, dur = 0.1, gain = 0.3, attack = 0.005 } = {}) {
    const a = ensure(); if (!a) return;
    const t0 = a.currentTime + at, o = a.createOscillator(), g = a.createGain();
    o.type = type; o.frequency.setValueAtTime(f, t0);
    if (f2) o.frequency.exponentialRampToValueAtTime(f2, t0 + dur);
    env(g, t0, gain, attack, dur);
    o.connect(g); g.connect(master); o.start(t0); o.stop(t0 + dur + 0.03);
  }
  // filtered noise burst (impacts, clicks, shutters)
  function burst({ at = 0, dur = 0.1, gain = 0.3, type = 'lowpass', f = 800, f2, q = 1 } = {}) {
    const a = ensure(); if (!a) return;
    const t0 = a.currentTime + at, s = a.createBufferSource(), bq = a.createBiquadFilter(), g = a.createGain();
    s.buffer = noise(); bq.type = type; bq.frequency.setValueAtTime(f, t0); bq.Q.value = q;
    if (f2) bq.frequency.exponentialRampToValueAtTime(f2, t0 + dur);
    env(g, t0, gain, 0.003, dur);
    s.connect(bq); bq.connect(g); g.connect(master); s.start(t0, Math.random() * 1.5); s.stop(t0 + dur + 0.03);
  }
  function bell(f, at = 0, dur = 0.6, gain = 0.25) {
    tone(f, { at, dur, gain }); tone(f * 2.76, { at, dur: dur * 0.5, gain: gain * 0.3 }); tone(f * 5.4, { at, dur: dur * 0.25, gain: gain * 0.12 });
  }
  const notes = (seq, type, gain) => seq.forEach(([f, at, dur]) => tone(f, { type, at, dur, gain, attack: 0.01 }));

  // S-01〜S-04: one noise loop per ball, pitch/volume follow the real speed; wind joins above 5 m/s
  const ROLL = { solid: { f: 260, q: 2.5, g: 0.55 }, hollow: { f: 170, q: 3.5, g: 0.5 }, ring: { f: 140, q: 4, g: 0.5 }, ice: { f: 2600, q: 0.6, g: 0.18 } };
  function rollStart(kind) {
    const a = ensure(); if (!a || roll) return;
    const mk = () => { const s = a.createBufferSource(); s.buffer = noise(); s.loop = true; return s; };
    const src = mk(), bq = a.createBiquadFilter(), g = a.createGain();
    const wsrc = mk(), wbq = a.createBiquadFilter(), wg = a.createGain();
    const p = ROLL[kind] || ROLL.solid;
    bq.type = kind === 'ice' ? 'highpass' : 'bandpass'; bq.frequency.value = p.f; bq.Q.value = p.q; g.gain.value = 0;
    wbq.type = 'bandpass'; wbq.frequency.value = 900; wbq.Q.value = 0.4; wg.gain.value = 0;
    src.connect(bq); bq.connect(g); g.connect(master); wsrc.connect(wbq); wbq.connect(wg); wg.connect(master);
    src.start(); wsrc.start(Math.random());
    roll = { src, bq, g, wsrc, wbq, wg, p };
  }
  function rollSet(speed, airborne, kind) {
    if (muted) return;
    if (!roll) rollStart(kind);
    if (!roll) return;
    const t = ac.currentTime, p = roll.p;
    roll.src.playbackRate.setTargetAtTime(0.55 + speed / 7, t, 0.04);
    roll.bq.frequency.setTargetAtTime(p.f * (0.7 + speed / 6), t, 0.04);
    roll.g.gain.setTargetAtTime(airborne ? 0.0001 : Math.min(p.g, 0.04 + speed / 7 * p.g), t, 0.03);
    roll.wbq.frequency.setTargetAtTime(600 + speed * 120, t, 0.08);
    roll.wg.gain.setTargetAtTime(speed > 5 ? Math.min(0.28, (speed - 5) / 4 * 0.28) : 0.0001, t, 0.1);
  }
  function rollStop() {
    if (!roll) return;
    const r = roll, t = ac.currentTime; roll = null;
    r.g.gain.setTargetAtTime(0.0001, t, 0.05); r.wg.gain.setTargetAtTime(0.0001, t, 0.05);
    r.src.stop(t + 0.3); r.wsrc.stop(t + 0.3);
  }

  return {
    get muted() { return muted; },
    setMuted(m) {
      muted = m;
      if (m) { rollStop(); if (ac) ac.suspend(); } else ensure();
    },
    tap: () => tone(720, { dur: 0.06, gain: 0.12 }),                                                    // S-18
    grab: () => { tone(1500, { type: 'square', dur: 0.03, gain: 0.06 }); burst({ type: 'highpass', f: 4000, dur: 0.02, gain: 0.1 }); }, // S-16
    release: () => tone(950, { type: 'square', dur: 0.035, gain: 0.05 }),                              // S-16
    tick: () => tone(2600, { type: 'square', dur: 0.015, gain: 0.025 }),                               // S-17 every 0.1 m
    count: () => tone(880, { type: 'square', dur: 0.09, gain: 0.1 }),                                  // S-05 3・2・1
    go: () => { bell(1320, 0, 0.9, 0.28); tone(660, { type: 'triangle', dur: 0.25, gain: 0.12 }); },  // S-05 bell
    roll: rollSet, rollStop,                                                                           // S-01〜S-04
    jump: () => { tone(260, { f2: 760, dur: 0.18, gain: 0.18 }); burst({ type: 'bandpass', f: 1800, f2: 3500, dur: 0.12, gain: 0.08 }); }, // S-06
    land(hit) {                                                                                        // S-07 weak / strong
      tone(120, { f2: 50, dur: 0.14 + 0.16 * hit, gain: 0.25 + 0.4 * hit });
      burst({ f: 700 + 900 * hit, dur: 0.06 + 0.1 * hit, gain: 0.18 + 0.3 * hit });
      if (hit > 0.5) tone(190, { type: 'triangle', at: 0.01, dur: 0.12, gain: 0.15 });
    },
    slow() {                                                                                           // S-08 time stretching
      tone(520, { f2: 110, type: 'sawtooth', dur: 0.9, gain: 0.05, attack: 0.02 });
      tone(260, { f2: 70, dur: 1.0, gain: 0.16, attack: 0.02 });
      burst({ type: 'bandpass', f: 3000, f2: 300, q: 2, dur: 0.8, gain: 0.08 });
    },
    goal: mine => bell(mine ? 1568 : 1175, 0, 0.5, mine ? 0.22 : 0.12),                                 // S-09
    shutter: () => { burst({ type: 'highpass', f: 2500, dur: 0.035, gain: 0.3 }); burst({ type: 'highpass', f: 1800, at: 0.07, dur: 0.05, gain: 0.22 }); }, // S-10
    win: () => { notes([[523, 0, .14], [659, .12, .14], [784, .24, .14]], 'triangle', 0.2); notes([[1047, .36, .9]], 'triangle', 0.22); bell(2093, 0.36, 1.1, 0.08); }, // S-11
    lose: () => notes([[392, 0, .2], [330, .18, .22], [349, .42, .16], [392, .58, .8]], 'triangle', 0.17), // S-12 悔しいが前向き
    best: () => notes([[1568, 0, .1], [2093, .08, .1], [2637, .16, .5]], 'sine', 0.14),                 // S-13
    courseOut() {                                                                                      // S-14
      tone(700, { f2: 90, dur: 0.6, gain: 0.18 });
      [[0.65, 0.3], [0.9, 0.18], [1.06, 0.1], [1.16, 0.05]].forEach(([at, g]) => burst({ at, f: 500, dur: 0.07, gain: g }));
    },
    stall: () => { tone(320, { f2: 140, dur: 0.5, gain: 0.16 }); tone(140, { f2: 210, at: 0.5, dur: 0.4, gain: 0.12 }); }, // S-15
    unlock: () => notes([[523, 0, .12], [784, .1, .12], [1047, .2, .6]], 'square', 0.06),              // S-19
    copy: () => { tone(1200, { dur: 0.05, gain: 0.1 }); tone(1600, { at: 0.06, dur: 0.08, gain: 0.1 }); } // S-20
  };
})();
