// Sound: the asset pack's recordings (audio/sfx, audio/music) played through Web Audio, with the
// synthesised versions as a fallback while files load or when they cannot (file://, old browsers).
// Nothing is downloaded while muted, and the game starts muted (素材リスト: 初回は消音).
// Levels: files are normalised to -6 dBFS peak (SFX) and -16 LUFS (BGM) by tools/import-assets.sh.
'use strict';
const SFX = (() => {
  let ac = null, master = null, sfxBus = null, musicBus = null, musicLP = null, noiseBuf = null;
  let muted = true, roll = null, music = null, wantMusic = null, musicReady = false;
  const buf = {}, loading = {};
  const EXT = (() => { try { return new Audio().canPlayType('audio/ogg; codecs="vorbis"') ? 'ogg' : 'm4a'; } catch (e) { return 'ogg'; } })();
  const SFX_FILES = ['steel-loop', 'hollow-loop', 'ring-loop', 'ice-loop', 'wind-loop', 'start', 'jump', 'landing-soft', 'landing-hard',
    'slow-motion', 'finish', 'photo-finish', 'victory-jingle', 'close-loss-jingle', 'personal-best', 'course-out', 'stall',
    'grab', 'release', 'ratchet', 'tap', 'unlock', 'copy'];

  function ensure() {
    if (muted) return null;
    if (!ac) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      ac = new AC();
      const comp = ac.createDynamicsCompressor();
      master = ac.createGain(); master.gain.value = 0.9;
      sfxBus = ac.createGain(); sfxBus.gain.value = 1;
      // BGM sits under the effects; the low-pass muffles it during the slow-motion finish (M-02 仕様)
      musicBus = ac.createGain(); musicBus.gain.value = 0.32;
      musicLP = ac.createBiquadFilter(); musicLP.type = 'lowpass'; musicLP.frequency.value = 18000;
      sfxBus.connect(master); musicBus.connect(musicLP); musicLP.connect(master); master.connect(comp); comp.connect(ac.destination);
      loadAll(SFX_FILES.map(n => 'sfx/' + n));
    }
    if (ac.state === 'suspended') ac.resume();
    return ac;
  }
  function load(path) {
    if (buf[path] || loading[path]) return loading[path] || Promise.resolve(buf[path]);
    loading[path] = fetch(`audio/${path}.${EXT}`).then(r => { if (!r.ok) throw r.status; return r.arrayBuffer(); })
      .then(d => new Promise((res, rej) => ac.decodeAudioData(d, res, rej)))
      .then(b => (buf[path] = b), () => null);
    return loading[path];
  }
  const loadAll = paths => Promise.all(paths.map(load));
  // stereo placement: pan -1 (left of the screen) … +1 (right); 0 or no panner support → centre
  function out(pan) {
    if (!pan || !ac.createStereoPanner) return sfxBus;
    const p = ac.createStereoPanner(); p.pan.value = Math.max(-1, Math.min(1, pan)); p.connect(sfxBus); return p;
  }
  // play a loaded file; returns false so callers can fall back to the synthesised sound
  function play(name, { gain = 1, rate = 1, at = 0, pan = 0 } = {}) {
    const a = ensure(), b = buf['sfx/' + name];
    if (!a || !b) return false;
    const s = a.createBufferSource(), g = a.createGain();
    s.buffer = b; s.playbackRate.value = rate; g.gain.value = gain;
    s.connect(g); g.connect(out(pan)); s.start(a.currentTime + at);
    return true;
  }

  // ---- synthesis fallback ----
  function noise() {
    if (!noiseBuf) {
      const n = ac.sampleRate * 2; noiseBuf = ac.createBuffer(1, n, ac.sampleRate);
      const d = noiseBuf.getChannelData(0); let b = 0;
      for (let i = 0; i < n; i++) { b = 0.86 * b + 0.14 * (Math.random() * 2 - 1); d[i] = b * 2.4; }
    }
    return noiseBuf;
  }
  function env(g, t0, peak, attack, dur) {
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(peak, t0 + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  }
  function tone(f, { f2, type = 'sine', at = 0, dur = 0.1, gain = 0.3, attack = 0.005, pan = 0 } = {}) {
    const a = ensure(); if (!a) return;
    const t0 = a.currentTime + at, o = a.createOscillator(), g = a.createGain();
    o.type = type; o.frequency.setValueAtTime(f, t0);
    if (f2) o.frequency.exponentialRampToValueAtTime(f2, t0 + dur);
    env(g, t0, gain * 0.55, attack, dur);
    o.connect(g); g.connect(out(pan)); o.start(t0); o.stop(t0 + dur + 0.03);
  }
  function burst({ at = 0, dur = 0.1, gain = 0.3, type = 'lowpass', f = 800, f2, q = 1, pan = 0 } = {}) {
    const a = ensure(); if (!a) return;
    const t0 = a.currentTime + at, s = a.createBufferSource(), bq = a.createBiquadFilter(), g = a.createGain();
    s.buffer = noise(); bq.type = type; bq.frequency.setValueAtTime(f, t0); bq.Q.value = q;
    if (f2) bq.frequency.exponentialRampToValueAtTime(f2, t0 + dur);
    env(g, t0, gain * 0.55, 0.003, dur);
    s.connect(bq); bq.connect(g); g.connect(out(pan)); s.start(t0, Math.random() * 1.5); s.stop(t0 + dur + 0.03);
  }
  function bell(f, at = 0, dur = 0.6, gain = 0.25) {
    tone(f, { at, dur, gain }); tone(f * 2.76, { at, dur: dur * 0.5, gain: gain * 0.3 }); tone(f * 5.4, { at, dur: dur * 0.25, gain: gain * 0.12 });
  }
  const notes = (seq, type, gain) => seq.forEach(([f, at, dur]) => tone(f, { type, at, dur, gain, attack: 0.01 }));

  // ---- S-01〜S-04: a speed-driven loop per ball, wind above 5 m/s ----
  // The pack's three rolling loops share almost the same spectrum, so each ball gets its own colour here:
  //   steel = dark and heavy (+ a sub rumble), hollow = boomy resonance, ring = bright rattle, ice = airy hiss.
  const LOOP = { solid: 'steel-loop', hollow: 'hollow-loop', ring: 'ring-loop', ice: 'ice-loop' };
  const FEEL = {
    solid: { rate: 0.8, peak: 180, q: 1.2, boost: 6, lp: 2400, rumble: 0.55 },
    hollow: { rate: 1.05, peak: 420, q: 6, boost: 12, lp: 5000, rumble: 0.15 },
    ring: { rate: 1.3, peak: 1500, q: 4, boost: 10, lp: 9000, rumble: 0.1 },
    ice: { rate: 1.2, peak: 4000, q: 0.7, boost: 4, lp: 16000, rumble: 0 }
  };
  const SYN = { solid: { f: 260, q: 2.5 }, hollow: { f: 170, q: 3.5 }, ring: { f: 140, q: 4 }, ice: { f: 2600, q: 0.6 } };
  function loopSource(name) {
    const s = ac.createBufferSource(), b = buf['sfx/' + name];
    s.buffer = b || noise(); s.loop = true;
    return { s, real: !!b };
  }
  function rollStart(kind) {
    const a = ensure(); if (!a || roll) return;
    const fe = FEEL[kind] || FEEL.solid, p = SYN[kind] || SYN.solid;
    const main = loopSource(LOOP[kind] || LOOP.solid), wind = loopSource('wind-loop');
    const bq = a.createBiquadFilter(), col = a.createBiquadFilter(), g = a.createGain(), wbq = a.createBiquadFilter(), wg = a.createGain();
    const pan = a.createStereoPanner ? a.createStereoPanner() : a.createGain();
    // real recordings: per-ball resonance + low-pass; the noise fallback is shaped into a rumble
    bq.type = main.real ? 'lowpass' : (kind === 'ice' ? 'highpass' : 'bandpass');
    bq.frequency.value = main.real ? fe.lp : p.f; bq.Q.value = main.real ? 0.7 : p.q;
    col.type = 'peaking'; col.frequency.value = fe.peak; col.Q.value = fe.q; col.gain.value = main.real ? fe.boost : 0;
    wbq.type = wind.real ? 'lowpass' : 'bandpass'; wbq.frequency.value = wind.real ? 20000 : 900; wbq.Q.value = 0.5;
    g.gain.value = 0; wg.gain.value = 0;
    main.s.connect(col); col.connect(bq); bq.connect(g); g.connect(pan); wind.s.connect(wbq); wbq.connect(wg); wg.connect(pan); pan.connect(sfxBus);
    // weight: a sub-bass rumble that follows speed, strongest for the solid steel ball
    const sub = a.createOscillator(), sg = a.createGain(); sub.type = 'sine'; sub.frequency.value = 48; sg.gain.value = 0;
    sub.connect(sg); sg.connect(pan);
    main.s.start(); wind.s.start(0, Math.random()); sub.start();
    roll = { src: main.s, real: main.real, wreal: wind.real, bq, g, wsrc: wind.s, wbq, wg, p, fe, pan, sub, sg };
  }
  function rollSet(speed, airborne, kind, slow, panX) {
    if (muted) return;
    if (!roll) rollStart(kind);
    if (!roll) return;
    const t = ac.currentTime, r = roll, fe = r.fe, sl = slow ? 0.45 : 1;   // slow motion: everything drops and dulls
    r.src.playbackRate.setTargetAtTime((r.real ? fe.rate * (0.7 + speed / 10) : 0.55 + speed / 7) * sl, t, 0.04);
    r.bq.frequency.setTargetAtTime(r.real ? fe.lp * (slow ? 0.25 : 1) : r.p.f * (0.7 + speed / 6) * sl, t, 0.05);
    r.g.gain.setTargetAtTime(airborne ? 0.0001 : Math.min(r.real ? 0.9 : 0.5, 0.05 + speed / 7), t, 0.03);
    if (!r.wreal) r.wbq.frequency.setTargetAtTime((600 + speed * 120) * sl, t, 0.08);
    r.wsrc.playbackRate.setTargetAtTime((r.wreal ? 0.85 + speed / 20 : 1) * sl, t, 0.08);
    r.wg.gain.setTargetAtTime(speed > 4 ? Math.min(0.55, (speed - 4) / 4 * 0.55) : 0.0001, t, 0.1);
    r.sub.frequency.setTargetAtTime((38 + speed * 4) * sl, t, 0.05);
    r.sg.gain.setTargetAtTime(airborne ? 0.0001 : fe.rumble * Math.min(1, speed / 6), t, 0.04);
    if (r.pan.pan) r.pan.pan.setTargetAtTime(Math.max(-0.8, Math.min(0.8, panX || 0)), t, 0.05);
  }
  function rollStop() {
    if (!roll) return;
    const r = roll, t = ac.currentTime; roll = null;
    r.g.gain.setTargetAtTime(0.0001, t, 0.05); r.wg.gain.setTargetAtTime(0.0001, t, 0.05); r.sg.gain.setTargetAtTime(0.0001, t, 0.05);
    r.src.stop(t + 0.3); r.wsrc.stop(t + 0.3); r.sub.stop(t + 0.3);
  }

  // ---- M-01 / M-02: background music, fetched only after the first race (初回の読み込みを軽く) ----
  function setMusic(which) {
    wantMusic = which;
    const a = ensure(); if (!a || !musicReady) return;
    if (music && music.which === which) return;
    const t = a.currentTime;
    if (music) { const m = music; m.g.gain.setTargetAtTime(0.0001, t, 0.25); m.s.stop(t + 1.5); music = null; }
    const b = which && buf['music/' + which];
    if (!b) return;
    const s = a.createBufferSource(), g = a.createGain();
    // the tracks fade out at the end: loop the steady part so the seam does not dip
    s.buffer = b; s.loop = true; s.loopStart = 0.5; s.loopEnd = Math.max(1, b.duration - 4);
    g.gain.value = 0.0001; g.gain.setTargetAtTime(1, t, 0.4);
    s.connect(g); g.connect(musicBus); s.start(t, which === 'race' ? 0 : (t * 7) % 20);
    music = { which, s, g };
  }

  return {
    get muted() { return muted; },
    setMuted(m) {
      muted = m;
      if (m) { rollStop(); if (music) { music.s.stop(); music = null; } if (ac) ac.suspend(); }
      else { ensure(); setMusic(wantMusic); }
    },
    enableMusic() {
      if (musicReady || muted || !ensure()) return;
      loadAll(['music/edit', 'music/race']).then(() => { musicReady = true; setMusic(wantMusic); });
    },
    music: setMusic,
    muffle(on) { if (musicLP) musicLP.frequency.setTargetAtTime(on ? 500 : 18000, ac.currentTime, 0.08); },
    tap: () => play('tap', { gain: 0.5 }) || tone(720, { dur: 0.06, gain: 0.12 }),                                         // S-18
    grab: () => play('grab', { gain: 0.6 }) || tone(1500, { type: 'square', dur: 0.03, gain: 0.06 }),                          // S-16
    release: () => play('release', { gain: 0.6 }) || tone(950, { type: 'square', dur: 0.035, gain: 0.05 }),                    // S-16
    tick: () => play('ratchet', { gain: 0.25 }) || tone(2600, { type: 'square', dur: 0.015, gain: 0.025 }),                    // S-17
    // S-05: one file for 3・2・1 + bell (beats at 0 / 0.40 / 0.84 s, bell at 1.28 s — the game's countdown follows it)
    start() {
      if (play('start', { gain: 0.8 })) return;
      [0, 0.4, 0.84].forEach(at => tone(880, { type: 'square', at, dur: 0.09, gain: 0.1 }));
      bell(1320, 1.28, 0.9, 0.28);
    },
    roll: rollSet, rollStop,                                                                                                   // S-01〜S-04
    jump: () => play('jump', { gain: 0.7 }) || tone(260, { f2: 760, dur: 0.18, gain: 0.18 }),                                 // S-06
    land(hit, kind, pan) {                                                                                                     // S-07 + weight
      play(hit > 0.5 ? 'landing-hard' : 'landing-soft', { gain: 0.4 + 0.4 * hit, pan });
      // the pack's landings are almost all click (>10 kHz): add the body of the impact per ball
      if (kind === 'ice') { burst({ type: 'highpass', f: 3500, f2: 7000, dur: 0.18 + 0.1 * hit, gain: 0.25 + 0.3 * hit, pan }); tone(900, { f2: 500, dur: 0.08, gain: 0.08, pan }); return; }
      if (kind === 'hollow') { tone(150, { f2: 90, dur: 0.25, gain: 0.3 + 0.3 * hit, pan }); [460, 690, 1030].forEach((f, i) => tone(f, { type: 'triangle', dur: 0.35 - i * 0.07, gain: (0.12 - i * 0.03) * (0.6 + hit), pan })); return; }
      if (kind === 'ring') { tone(130, { f2: 80, dur: 0.2, gain: 0.3 + 0.3 * hit, pan }); [1320, 1980].forEach((f, i) => tone(f, { type: 'triangle', dur: 0.25, gain: 0.07 * (0.6 + hit) / (i + 1), pan })); return; }
      tone(95, { f2: 38, dur: 0.22 + 0.2 * hit, gain: 0.45 + 0.5 * hit, pan }); burst({ f: 380 + 500 * hit, dur: 0.08 + 0.1 * hit, gain: 0.25 + 0.35 * hit, pan });   // steel: deep thud
    },
    // one "カタン" per 0.5 m of track: the rhythm tightens as the ball speeds up
    clack(kind, pan) {
      const heavy = kind === 'solid', icy = kind === 'ice';
      if (icy) { burst({ type: 'highpass', f: 5000, dur: 0.025, gain: 0.08, pan }); return; }
      play('ratchet', { rate: heavy ? 0.55 : 0.8, gain: 0.35, pan }) || burst({ type: 'bandpass', f: 1800, q: 3, dur: 0.02, gain: 0.12, pan });
      tone(heavy ? 120 : 210, { f2: heavy ? 80 : 160, dur: 0.05, gain: heavy ? 0.16 : 0.09, pan });
    },
    // a ball passing the player's ball: wind sweeping across the stereo field
    whoosh(from, to) {
      const a = ensure(); if (!a) return;
      const t0 = a.currentTime, s = a.createBufferSource(), bq = a.createBiquadFilter(), g = a.createGain();
      const p = a.createStereoPanner ? a.createStereoPanner() : null;
      s.buffer = buf['sfx/wind-loop'] || noise(); bq.type = 'bandpass'; bq.Q.value = 1.2;
      bq.frequency.setValueAtTime(700, t0); bq.frequency.exponentialRampToValueAtTime(2400, t0 + 0.18); bq.frequency.exponentialRampToValueAtTime(600, t0 + 0.45);
      env(g, t0, 0.5, 0.12, 0.45);
      s.connect(bq); bq.connect(g);
      if (p) { p.pan.setValueAtTime(from, t0); p.pan.linearRampToValueAtTime(to, t0 + 0.45); g.connect(p); p.connect(sfxBus); } else g.connect(sfxBus);
      s.start(t0, Math.random()); s.stop(t0 + 0.5);
    },
    slow: () => play('slow-motion', { gain: 0.7 }) || tone(260, { f2: 70, dur: 1.0, gain: 0.16, attack: 0.02 }),               // S-08
    goal: (mine, pan) => play('finish', { gain: mine ? 0.8 : 0.35, rate: mine ? 1 : 0.84, pan }) || bell(mine ? 1568 : 1175, 0, 0.5, mine ? 0.22 : 0.12), // S-09
    // S-10 at the frozen photo-finish frame, with a flash "pop" under it
    shutter: () => { (play('photo-finish', { gain: 0.9 }) || burst({ type: 'highpass', f: 2500, dur: 0.035, gain: 0.3 })); burst({ type: 'bandpass', f: 1200, f2: 300, dur: 0.25, gain: 0.18 }); },
    win: () => play('victory-jingle', { gain: 0.8 }) || notes([[523, 0, .14], [659, .12, .14], [784, .24, .14], [1047, .36, .9]], 'triangle', 0.2), // S-11
    lose: () => play('close-loss-jingle', { gain: 0.8 }) || notes([[392, 0, .2], [330, .18, .22], [349, .42, .16], [392, .58, .8]], 'triangle', 0.17), // S-12
    best: () => play('personal-best', { gain: 0.7 }) || notes([[1568, 0, .1], [2093, .08, .1], [2637, .16, .5]], 'sine', 0.14), // S-13
    courseOut: () => play('course-out', { gain: 0.8 }) || tone(700, { f2: 90, dur: 0.6, gain: 0.18 }),                         // S-14
    stall: () => play('stall', { gain: 0.8 }) || tone(320, { f2: 140, dur: 0.5, gain: 0.16 }),                                 // S-15
    unlock: () => play('unlock', { gain: 0.6 }) || notes([[523, 0, .12], [784, .1, .12], [1047, .2, .6]], 'square', 0.06),     // S-19
    copy: () => play('copy', { gain: 0.6 }) || tone(1600, { dur: 0.08, gain: 0.1 })                                             // S-20
  };
})();
