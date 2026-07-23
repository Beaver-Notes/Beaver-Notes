import { ref } from 'vue';
import { getSettingSync } from '@/composable/settings';
import { isMobileRuntime } from '@/lib/tauri/runtime';

const _isMobile = isMobileRuntime();

let _ctx = null;
let V = 0.5;

function ctx() {
  if (!_ctx) _ctx = new (window.AudioContext || window.webkitAudioContext)();
  if (_ctx.state === 'suspended') _ctx.resume();
  return _ctx;
}

function master(c) {
  const comp = c.createDynamicsCompressor();
  comp.threshold.value = -18;
  comp.knee.value = 6;
  comp.ratio.value = 3;
  comp.attack.value = 0.003;
  comp.release.value = 0.1;
  comp.connect(c.destination);
  return comp;
}

function pluck(c, dest, freq, t, decay = 0.18, gain = 0.22, detune = 4) {
  const g = c.createGain();
  g.gain.setValueAtTime(gain * V, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + decay);
  [freq, freq * (1 + detune / 1200)].forEach((f) => {
    const o = c.createOscillator();
    o.type = 'triangle';
    o.frequency.value = f;
    const o2 = c.createOscillator();
    o2.type = 'sine';
    o2.frequency.value = f * 2;
    const g2 = c.createGain();
    g2.gain.value = 0.25;
    o2.connect(g2);
    g2.connect(g);
    o.connect(g);
    o.start(t);
    o.stop(t + decay + 0.05);
    o2.start(t);
    o2.stop(t + decay + 0.05);
  });
  g.connect(dest);
}

function nburst(
  c,
  dest,
  t,
  dur,
  lpFreq = 1200,
  hpFreq = 80,
  gain = 0.14,
  attack = 0.002,
  release = 0.07
) {
  const sz = (c.sampleRate * (dur + release + 0.05)) | 0;
  const buf = c.createBuffer(1, sz, c.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  const src = c.createBufferSource();
  src.buffer = buf;
  const lp = c.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = lpFreq;
  const hp = c.createBiquadFilter();
  hp.type = 'highpass';
  hp.frequency.value = hpFreq;
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain * V, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur + release);
  src.connect(lp);
  lp.connect(hp);
  hp.connect(g);
  g.connect(dest);
  src.start(t);
  src.stop(t + dur + release + 0.05);
}

function whoosh(
  c,
  dest,
  t,
  dur,
  f1,
  f2,
  gain = 0.13,
  attack = 0.004,
  release = 0.08
) {
  const sz = (c.sampleRate * (dur + release + 0.06)) | 0;
  const buf = c.createBuffer(1, sz, c.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  const src = c.createBufferSource();
  src.buffer = buf;
  const bp = c.createBiquadFilter();
  bp.type = 'bandpass';
  bp.Q.value = 2.5;
  bp.frequency.setValueAtTime(f1, t);
  bp.frequency.exponentialRampToValueAtTime(f2, t + dur);
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain * V, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur + release);
  src.connect(bp);
  bp.connect(g);
  g.connect(dest);
  src.start(t);
  src.stop(t + dur + release + 0.06);
}

function bell(c, dest, freq, t, decay = 0.6, gain = 0.1) {
  const mod = c.createOscillator();
  const modG = c.createGain();
  const carrier = c.createOscillator();
  const outG = c.createGain();
  mod.frequency.value = freq * 2.756; // classic bell inharmonicity ratio
  modG.gain.setValueAtTime(freq * 5 * V, t);
  modG.gain.exponentialRampToValueAtTime(0.0001, t + decay * 0.4);
  mod.connect(modG);
  modG.connect(carrier.frequency);
  carrier.frequency.value = freq;
  carrier.type = 'sine';
  outG.gain.setValueAtTime(gain * V, t);
  outG.gain.exponentialRampToValueAtTime(0.0001, t + decay);
  carrier.connect(outG);
  outG.connect(dest);
  mod.start(t);
  mod.stop(t + decay + 0.05);
  carrier.start(t);
  carrier.stop(t + decay + 0.05);
}


const sounds = {
  noteCreate: () => {
    const c = ctx(),
      t = c.currentTime,
      m = master(c);
    pluck(c, m, 440, t, 0.22, 0.2);
    pluck(c, m, 554, t + 0.07, 0.18, 0.14);
    bell(c, m, 1760, t + 0.1, 0.3, 0.04);
  },

  delete: () => {
    const c = ctx(),
      t = c.currentTime,
      m = master(c);
    nburst(c, m, t, 0.012, 900, 60, 0.22, 0.001, 0.18);
    const o = c.createOscillator(),
      g = c.createGain();
    o.type = 'sine';
    o.frequency.value = 100;
    o.frequency.exponentialRampToValueAtTime(55, t + 0.09);
    g.gain.setValueAtTime(0.28 * V, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.11);
    o.connect(g);
    g.connect(m);
    o.start(t);
    o.stop(t + 0.15);
  },

  archive: () => {
    const c = ctx(),
      t = c.currentTime,
      m = master(c);
    whoosh(c, m, t, 0.16, 3000, 280, 0.11, 0.003, 0.2);
    pluck(c, m, 220, t + 0.13, 0.18, 0.1, 2);
  },

  unarchive: () => {
    const c = ctx(),
      t = c.currentTime,
      m = master(c);
    pluck(c, m, 220, t, 0.12, 0.1, 2);
    whoosh(c, m, t + 0.06, 0.17, 240, 3200, 0.11, 0.005, 0.14);
    pluck(c, m, 440, t + 0.2, 0.16, 0.09);
  },

  bookmark: () => {
    const c = ctx(),
      t = c.currentTime,
      m = master(c);
    bell(c, m, 880, t, 0.7, 0.13);
    bell(c, m, 1320, t + 0.04, 0.5, 0.07);
  },

  folderCreate: () => {
    const c = ctx(),
      t = c.currentTime,
      m = master(c);
    pluck(c, m, 330, t, 0.18, 0.16);
    pluck(c, m, 415, t + 0.065, 0.16, 0.13);
    pluck(c, m, 520, t + 0.12, 0.2, 0.11);
  },

  sync: () => {
    const c = ctx(),
      t = c.currentTime,
      m = master(c);
    pluck(c, m, 523, t, 0.14, 0.13, 6);
    pluck(c, m, 659, t + 0.1, 0.12, 0.1, 6);
    pluck(c, m, 523, t + 0.19, 0.16, 0.12, 3);
  },

  lock: () => {
    const c = ctx(),
      t = c.currentTime,
      m = master(c);
    nburst(c, m, t, 0.008, 2000, 200, 0.2, 0.001, 0.04);
    nburst(c, m, t + 0.005, 0.04, 300, 40, 0.18, 0.001, 0.12);
    const o = c.createOscillator(),
      g = c.createGain();
    o.type = 'sine';
    o.frequency.value = 160;
    o.frequency.exponentialRampToValueAtTime(80, t + 0.08);
    g.gain.setValueAtTime(0.18 * V, t + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.1);
    o.connect(g);
    g.connect(m);
    o.start(t + 0.005);
    o.stop(t + 0.15);
  },

  unlock: () => {
    const c = ctx(),
      t = c.currentTime,
      m = master(c);
    nburst(c, m, t, 0.008, 1800, 150, 0.16, 0.001, 0.04);
    const o = c.createOscillator(),
      g = c.createGain();
    o.type = 'sine';
    o.frequency.value = 140;
    o.frequency.exponentialRampToValueAtTime(340, t + 0.1);
    g.gain.setValueAtTime(0.14 * V, t + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.14);
    o.connect(g);
    g.connect(m);
    o.start(t + 0.005);
    o.stop(t + 0.18);
    bell(c, m, 1100, t + 0.08, 0.35, 0.06);
  },

  move: () => {
    const c = ctx(),
      t = c.currentTime,
      m = master(c);
    whoosh(c, m, t, 0.1, 600, 1600, 0.1, 0.003, 0.09);
    pluck(c, m, 370, t + 0.09, 0.14, 0.1, 3);
  },

  danger: () => {
    const c = ctx(),
      t = c.currentTime,
      m = master(c);
    [220, 233].forEach((f, i) => {
      const o = c.createOscillator(),
        g = c.createGain();
      o.type = 'sawtooth';
      o.frequency.value = f;
      g.gain.setValueAtTime(0.0001, t + i * 0.04);
      g.gain.exponentialRampToValueAtTime(0.11 * V, t + i * 0.04 + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t + i * 0.04 + 0.18);
      o.connect(g);
      g.connect(m);
      o.start(t + i * 0.04);
      o.stop(t + 0.3);
    });
    nburst(c, m, t, 0.006, 400, 80, 0.1, 0.001, 0.05);
  },

  error: () => {
    const c = ctx(),
      t = c.currentTime,
      m = master(c);
    nburst(c, m, t, 0.01, 2400, 100, 0.26, 0.001, 0.05);
    [
      [280, 0],
      [220, 0.025],
    ].forEach(([f, d]) => {
      const o = c.createOscillator(),
        g = c.createGain();
      o.type = 'sawtooth';
      o.frequency.value = f;
      o.frequency.exponentialRampToValueAtTime(f * 0.7, t + d + 0.07);
      g.gain.setValueAtTime(0.13 * V, t + d);
      g.gain.exponentialRampToValueAtTime(0.0001, t + d + 0.09);
      o.connect(g);
      g.connect(m);
      o.start(t + d);
      o.stop(t + 0.18);
    });
  },

  intro: () => {
    const c = ctx(),
      t = c.currentTime,
      m = master(c);
    [220, 277, 330, 415, 523].forEach((f, i) => {
      pluck(c, m, f, t + i * 0.09, 0.6 - i * 0.05, 0.14 - i * 0.01, 3);
    });
    bell(c, m, 523, t + 0.45, 1.1, 0.1);
    bell(c, m, 1046, t + 0.55, 0.9, 0.07);
    bell(c, m, 1568, t + 0.65, 0.7, 0.04);
    nburst(c, m, t + 0.4, 0.5, 3000, 800, 0.05, 0.04, 0.6);
  },
};

const enabled = ref(getSettingSync('soundsEnabled') ?? true);

export function useSounds() {
  function play(name) {
    if (!enabled.value) return;
    if (_isMobile) return;
    try {
      sounds[name]?.();
    } catch {}
  }

  return { play, enabled };
}
