<template>
  <div
    ref="root"
    class="bm-root"
    :class="{ 'bm-ready': ready }"
    role="img"
    aria-label="Beaver Notes mascot"
  >
    <div ref="shadow" class="bm-shadow" />

    <div ref="rig" class="bm-rig">
      <div ref="lean" class="bm-lean">
        <!-- body: feet, single-stroke arms, torso, belly -->
        <svg class="bm-body" viewBox="-1350 -60 5900 4650" fill="none">
          <defs>
            <linearGradient
              :id="gid"
              gradientUnits="userSpaceOnUse"
              x1="0"
              y1="2345"
              x2="0"
              y2="2750"
            >
              <stop offset="0" stop-color="#CB862A" stop-opacity="0" />
              <stop offset="1" stop-color="#CB862A" />
            </linearGradient>
          </defs>

          <rect ref="footL" class="bm-foot" x="931" y="2549" width="680" height="2082" rx="340" fill="#F0A431" stroke="#CB862A" stroke-width="10" />
          <rect ref="footR" class="bm-foot" x="1642" y="2549" width="680" height="2082" rx="340" fill="#F0A431" stroke="#CB862A" stroke-width="10" />

          <g fill="none" stroke-linecap="round" stroke-linejoin="round">
            <path ref="armLo" stroke="#CB862A" stroke-width="676" />
            <path ref="armLf" stroke="#EFA432" stroke-width="640" />
            <path ref="armRo" stroke="#CB862A" stroke-width="676" />
            <path ref="armRf" stroke="#EFA432" stroke-width="640" />
            <!-- invisible controllers: animations rotate these, the arm engine reads them -->
            <g ref="armLc" class="bm-ctl" />
            <g ref="armRc" class="bm-ctl" />
          </g>

          <path d="M160 1500H3060V3239C3060 3681 2702 4039 2260 4039H960C518 4039 160 3681 160 3239Z" fill="#EFA432" />
          <path d="M160 2345V3239C160 3681 518 4039 960 4039H2260C2702 4039 3060 3681 3060 3239V2345" :stroke="`url(#${gid})`" stroke-width="20" fill="none" />

          <g transform="translate(-1322 -5201)">
            <rect x="2136.27" y="7757.95" width="1705.46" height="1329.87" rx="664.934" fill="#FAE3B7" />
            <rect width="266.341" height="38.0142" transform="matrix(0.640813 -0.767697 0.764386 0.644759 2889 8804.73)" fill="#EFA432" />
            <rect width="266.341" height="38.0142" transform="matrix(0.640813 0.767697 -0.764386 0.644759 2918.05 8600.26)" fill="#EFA432" />
          </g>
        </svg>

        <!-- head: the existing expression component, drawn over the body -->
        <div ref="headWrap" class="bm-head">
          <ui-beaver-character :state="headState" :auto="false" />
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
/**
 * Full-body Beaver mascot (front view).
 *
 * - Head = <ui-beaver-character> (all expressions keep working).
 * - Head and torso move as one block; arms are single strokes with a
 *   shoulder angle + elbow bend and a stiff spring follow-through.
 * - Exposes play(name) for scripted moves, plus an optional idle loop.
 */
import { ref, onMounted, onBeforeUnmount, watch, nextTick } from 'vue';

const props = defineProps({
  /** Baseline expression(s) passed to the head. */
  state: { type: [String, Array], default: () => ['idle', 'cursorTrack'] },
  /** Pop up from the bottom and wave when mounted. */
  intro: { type: Boolean, default: true },
  /** Random little actions while nothing else is happening. */
  autoplay: { type: Boolean, default: true },
  /** Eyes follow the pointer anywhere in the window. */
  trackCursor: { type: Boolean, default: true },
});
const emit = defineEmits(['start', 'end']);

const gid = `bm-og-${Math.random().toString(36).slice(2, 8)}`;
const root = ref(null);
const rig = ref(null);
const lean = ref(null);
const shadow = ref(null);
const headWrap = ref(null);
const footL = ref(null);
const footR = ref(null);
const armLc = ref(null);
const armRc = ref(null);
const armLo = ref(null);
const armLf = ref(null);
const armRo = ref(null);
const armRf = ref(null);

const ready = ref(false);
const headState = ref(props.state);
const baseline = () => props.state;

const reduce =
  typeof window !== 'undefined' &&
  !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

/* ---------------- helpers ---------------- */
const EO = 'cubic-bezier(.2,.7,.3,1)';
const EI = 'cubic-bezier(.5,0,.85,.4)';
const EB = 'cubic-bezier(.3,1.5,.5,1)';
const H = () => rig.value.offsetHeight;
const tf = (x = 0, y = 0, r = 0, sx = 1, sy = 1) =>
  `translate(${x}px,${y}px) rotate(${r}deg) scale(${sx},${sy})`;
/** Arm raise in degrees from hanging (right arm rotates clockwise, left mirrors). */
const ua = (side, u) => `rotate(${side === 'right' ? u : -u}deg)`;
const REST = { L: ua('left', 0), R: ua('right', 0) };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const frame = () => new Promise((r) => requestAnimationFrame(() => r()));

function A(el, fr, ms, opts = {}) {
  return el.animate(
    fr.map((f) => {
      const k = { transform: f.t };
      if (f.e) k.easing = f.e;
      if (f.o !== undefined) k.offset = f.o;
      return k;
    }),
    { duration: ms, fill: 'both', easing: EO, ...opts }
  ).finished;
}
const feet = (fr, ms) => Promise.all([A(footL.value, fr, ms), A(footR.value, fr, ms)]);
const arms = (l, r, ms) => Promise.all([A(armLc.value, l, ms), A(armRc.value, r, ms)]);
const shade = (fr, ms) =>
  A(shadow.value, fr.map((f) => ({ ...f, t: `translateX(-50%) scale(${f.s})` })), ms);

/* ---------------- moves ---------------- */
const runPop = () => {
  const h = H();
  return Promise.all([
    A(rig.value, [{ t: tf(0, h * 1.05) }, { t: tf(0, -h * 0.07, 0, 0.95, 1.08), o: 0.55 }, { t: tf(0, 0, 0, 1.05, 0.94), o: 0.78 }, { t: tf() }], 1100),
    arms([{ t: REST.L }, { t: ua('left', 25), o: 0.55 }, { t: REST.L }], [{ t: REST.R }, { t: ua('right', 25), o: 0.55 }, { t: REST.R }], 1100),
    shade([{ s: 0.2, o: 0 }, { s: 1.1, o: 0.6 }, { s: 1, o: 1 }], 1100),
  ]);
};
const runDuck = () => {
  const h = H();
  return Promise.all([
    A(rig.value, [{ t: tf() }, { t: tf(0, -h * 0.04, 0, 1, 1.05), o: 0.25, e: EI }, { t: tf(0, h * 1.1, 0, 0.95, 0.9) }], 700),
    shade([{ s: 1, o: 0 }, { s: 0.2, o: 1 }], 700),
  ]);
};

const ANIMS = {
  popUp: { mood: 'happy', run: runPop },

  wave: {
    mood: 'excited',
    run: () => {
      const h = H();
      const u = (v) => ({ t: ua('right', v) });
      return Promise.all([
        A(rig.value, [{ t: tf() }, { t: tf(0, 0, 0, 1.04, 0.94), o: 0.1 }, { t: tf(0, -h * 0.05, -2, 0.98, 1.04), o: 0.24 }, { t: tf(0, 0, -2, 1.03, 0.96), o: 0.34 }, { t: tf(0, 0, -2), o: 0.85 }, { t: tf() }], 2400),
        A(armRc.value, [u(0), { ...u(0), o: 0.08 }, { ...u(-7), o: 0.14, e: EB }, { ...u(80), o: 0.28 }, { ...u(67), o: 0.36 }, { ...u(58), o: 0.44 }, { ...u(76), o: 0.52 }, { ...u(58), o: 0.6 }, { ...u(76), o: 0.68 }, { ...u(60), o: 0.76 }, { ...u(66), o: 0.84 }, { ...u(-4), o: 0.94 }, u(0)], 2400),
        A(lean.value, [{ t: tf() }, { t: tf(0, 0, -3), o: 0.25 }, { t: tf(0, 0, -3), o: 0.85 }, { t: tf() }], 2400),
      ]);
    },
  },

  celebrate: {
    mood: 'excited',
    run: () => {
      const h = H();
      const hop = (o) => [
        { t: tf(0, 0, 0, 1.1, 0.85), o },
        { t: tf(0, -h * 0.14, 0, 0.92, 1.12), o: o + 0.14, e: EO },
        { t: tf(0, 0, 0, 1.08, 0.88), o: o + 0.3, e: EI },
      ];
      const up = (s, R) => [{ t: R }, { t: ua(s, 70), o: 0.1 }, { t: ua(s, 85), o: 0.35 }, { t: ua(s, 65), o: 0.55 }, { t: ua(s, 85), o: 0.8 }, { t: R }];
      return Promise.all([
        A(rig.value, [{ t: tf(), o: 0 }, ...hop(0.05), ...hop(0.45), { t: tf(), o: 1 }], 2000),
        arms(up('left', REST.L), up('right', REST.R), 2000),
        feet([{ t: tf() }, { t: tf(), o: 0.05 }, { t: tf(0, -260), o: 0.19 }, { t: tf(), o: 0.35 }, { t: tf(), o: 0.45 }, { t: tf(0, -260), o: 0.59 }, { t: tf(), o: 0.75 }, { t: tf() }], 2000),
        A(lean.value, [{ t: tf() }, { t: tf(0, 0, -3), o: 0.2 }, { t: tf(0, 0, 3), o: 0.5 }, { t: tf(0, 0, -2), o: 0.8 }, { t: tf() }], 2000),
        shade([{ s: 1, o: 0 }, { s: 0.8, o: 0.2 }, { s: 1, o: 0.35 }, { s: 0.8, o: 0.6 }, { s: 1, o: 0.75 }], 2000),
      ]);
    },
  },

  nod: {
    mood: 'happy',
    run: () => A(lean.value, [{ t: tf() }, { t: tf(0, 0, 0, 1.02, 0.94), o: 0.2 }, { t: tf(), o: 0.4 }, { t: tf(0, 0, 0, 1.02, 0.94), o: 0.6 }, { t: tf() }], 900),
  },

  shake: {
    mood: 'confused',
    run: () => A(lean.value, [{ t: tf() }, { t: tf(0, 0, -3), o: 0.2 }, { t: tf(0, 0, 3), o: 0.4 }, { t: tf(0, 0, -2.5), o: 0.6 }, { t: tf(0, 0, 1.5), o: 0.8 }, { t: tf() }], 1000),
  },

  surprise: {
    mood: 'surprised',
    run: () => {
      const h = H();
      return Promise.all([
        A(rig.value, [{ t: tf() }, { t: tf(0, -h * 0.07, 0, 1.06, 1.08), o: 0.1, e: EO }, { t: tf(0, -h * 0.09, 0, 1.05, 1.06), o: 0.3 }, { t: tf(0, 0, 0, 0.97, 1.04), o: 0.5, e: EB }, { t: tf() }], 1400),
        arms([{ t: REST.L }, { t: ua('left', 30), o: 0.12 }, { t: ua('left', 30), o: 0.65 }, { t: REST.L }], [{ t: REST.R }, { t: ua('right', 30), o: 0.12 }, { t: ua('right', 30), o: 0.65 }, { t: REST.R }], 1400),
      ]);
    },
  },

  wink: {
    mood: 'wink',
    run: () => A(lean.value, [{ t: tf() }, { t: tf(0, 0, 2), o: 0.2 }, { t: tf(0, 0, 2), o: 0.7 }, { t: tf() }], 1500),
  },

  think: {
    mood: 'thinking',
    run: () => A(lean.value, [{ t: tf() }, { t: tf(0, 0, 2.5), o: 0.25 }, { t: tf(0, 0, 2.5), o: 0.8 }, { t: tf() }], 2200),
  },

  /** duck out of sight, then pop back up */
  peekaboo: {
    mood: 'shy',
    run: async () => {
      await runDuck();
      await sleep(900);
      headState.value = 'happy';
      await runPop();
    },
  },
};

/* ---------------- player ---------------- */
let gen = 0;
let destroyed = false;
let idleTimer = 0;
let lastIdle = '';

async function play(name) {
  const def = ANIMS[name];
  if (!def || destroyed) return false;
  const my = ++gen;
  clearTimeout(idleTimer);
  ready.value = true;
  if (reduce) return true;
  root.value?.getAnimations?.({ subtree: true }).forEach((a) => a.cancel());
  headState.value = def.mood ?? baseline();
  emit('start', name);
  try {
    await def.run();
  } catch {
    /* animation was cancelled */
  }
  if (my !== gen || destroyed) return false;
  headState.value = baseline();
  emit('end', name);
  scheduleIdle();
  return true;
}

function scheduleIdle() {
  clearTimeout(idleTimer);
  if (!props.autoplay || reduce || destroyed) return;
  idleTimer = setTimeout(() => {
    if (document.hidden) return scheduleIdle();
    const pool = ['wave', 'nod', 'think', 'wink', 'peekaboo'].filter((n) => n !== lastIdle);
    lastIdle = pool[Math.floor(Math.random() * pool.length)];
    play(lastIdle);
  }, 8000 + Math.random() * 6000);
}

async function runIntro() {
  if (!props.intro || reduce) {
    ready.value = true;
    return scheduleIdle();
  }
  await nextTick();
  if (!(await play('popUp'))) return;
  await sleep(200);
  if (destroyed) return;
  play('wave');
}

watch(
  () => props.state,
  () => {
    headState.value = baseline();
  }
);

/* ---------------- arms: single strokes, stiff spring follow-through ---------------- */
const mat = (el) => {
  const s = getComputedStyle(el).transform;
  return s && s !== 'none' ? new DOMMatrix(s) : new DOMMatrix();
};
const mid = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
const SEG = 280;
const K = [1000, 720, 520, 380];
let armList = [];
let raf = 0;
let lastT = 0;
let prevRig = { x: 0, y: 0 };

function initArms() {
  armList = [
    { sd: -1, c: armLc.value, o: armLo.value, f: armLf.value, S: [293, 2366] },
    { sd: 1, c: armRc.value, o: armRo.value, f: armRf.value, S: [2927, 2366] },
  ];
  armList.forEach((a) => {
    a.th = [38, 28, 18, 8];
    a.w = [0, 0, 0, 0];
  });
}

function tick(now) {
  raf = requestAnimationFrame(tick);
  const dt = Math.min(0.04, Math.max(0.001, (now - lastT) / 1000));
  lastT = now;
  if (document.hidden || !rig.value) return;
  const mr = mat(rig.value);
  const jump = Math.abs(mr.e - prevRig.x) > 150 || Math.abs(mr.f - prevRig.y) > 150;
  const vx = jump ? 0 : Math.max(-1500, Math.min(1500, (mr.e - prevRig.x) / dt));
  const vy = jump ? 0 : (mr.f - prevRig.y) / dt;
  prevRig = { x: mr.e, y: mr.f };
  const flare = Math.min(18, Math.abs(vy) * 0.005);

  for (const a of armList) {
    const m = mat(a.c);
    const u = a.sd * Math.atan2(m.b, m.a) * 57.2958;
    const lift = Math.min(150, 38 + u);
    const bend = Math.min(52, -26 + (u > 0 ? 1.4 : 1) * u);
    const inset = 190 * Math.max(0, Math.min(1, u / 45)); // keep the shoulder end hidden when raised
    const P = [[a.S[0] - a.sd * inset, a.S[1]]];
    for (let i = 0; i < 4; i++) {
      const T = Math.min(172, lift + (bend * i) / 3 - a.sd * vx * 0.005 * (i / 3) + (flare * (i + 1)) / 4);
      a.w[i] += ((T - a.th[i]) * K[i] - a.w[i] * 1.7 * Math.sqrt(K[i])) * dt;
      a.th[i] += a.w[i] * dt;
      const r = (a.th[i] * Math.PI) / 180;
      P.push([P[i][0] + a.sd * Math.sin(r) * SEG, P[i][1] + Math.cos(r) * SEG]);
    }
    const d = `M${P[0]}L${mid(P[0], P[1])}Q${P[1]} ${mid(P[1], P[2])}Q${P[2]} ${mid(P[2], P[3])}Q${P[3]} ${P[4]}`;
    a.o.setAttribute('d', d);
    a.f.setAttribute('d', d);
  }
}

/* ---------------- eyes follow the pointer anywhere ---------------- */
let pending = null;
function forwardPointer(e) {
  pending = e;
  if (forwardPointer.raf) return;
  forwardPointer.raf = requestAnimationFrame(() => {
    forwardPointer.raf = 0;
    const el = headWrap.value?.querySelector('.beaver-character');
    if (!el || !pending) return;
    const r = el.getBoundingClientRect();
    if (!r.width) return;
    const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
    const x = clamp(pending.clientX, r.left - r.width * 0.3, r.right + r.width * 0.3);
    const y = clamp(pending.clientY, r.top - r.height * 0.3, r.bottom + r.height * 0.3);
    el.dispatchEvent(new MouseEvent('mousemove', { clientX: x, clientY: y, bubbles: false }));
  });
}

onMounted(() => {
  initArms();
  // paint the resting arm pose immediately
  lastT = performance.now();
  raf = requestAnimationFrame(tick);
  if (props.trackCursor) window.addEventListener('pointermove', forwardPointer, { passive: true });
  runIntro();
});

onBeforeUnmount(() => {
  destroyed = true;
  cancelAnimationFrame(raf);
  clearTimeout(idleTimer);
  window.removeEventListener('pointermove', forwardPointer);
});

defineExpose({ play, cheer: () => play('celebrate') });
</script>

<style scoped>
.bm-root {
  position: relative;
  width: 100%;
  aspect-ratio: 5900 / 4650;
  /* clip only the bottom edge so he can rise out of "the floor" */
  clip-path: inset(-30% -20% -1% -20%);
}
.bm-shadow {
  position: absolute;
  left: 50%;
  bottom: 1%;
  width: 46%;
  height: 7%;
  transform: translateX(-50%);
  border-radius: 50%;
  background: radial-gradient(ellipse at center, rgba(0, 0, 0, 0.16), rgba(0, 0, 0, 0) 70%);
}
.bm-rig {
  position: absolute;
  inset: 0;
  transform-origin: 50% 100%;
  opacity: 0;
}
.bm-ready .bm-rig {
  opacity: 1;
}
.bm-lean {
  position: relative;
  width: 100%;
  height: 100%;
  transform-origin: 50% 100%;
}
.bm-body {
  width: 100%;
  height: 100%;
  display: block;
  overflow: visible;
}
.bm-ctl {
  transform-box: view-box;
  transform-origin: 0 0;
}
.bm-foot {
  transform-box: fill-box;
  transform-origin: 50% 0;
}

/* head overlay: same coordinate space as the body svg */
.bm-head {
  position: absolute;
  left: 14.407%;
  top: -7.312%;
  width: 72.169%;
  height: 67.634%;
}
.bm-head :deep(.beaver-character) {
  display: block;
  width: 100%;
  height: 100%;
}
.bm-head :deep(svg) {
  width: 100%;
  height: 100%;
  display: block;
  overflow: visible;
}
/* the head must not move separately from the body */
.bm-head :deep(svg > g:first-of-type) {
  transform: none !important;
}
/* the head's own outline would draw a seam across the torso */
.bm-head :deep(path[stroke='#CB862A']) {
  stroke: none;
}
</style>
