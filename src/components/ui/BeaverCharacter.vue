<template>
  <div
    ref="rootEl"
    class="beaver-character"
    role="img"
    aria-label="Beaver Notes mascot"
    @click="greet"
    @touchstart.prevent="greet"
    @mousemove="onMouseMove"
  >
    <svg
      ref="stage"
      viewBox="-500 -400 4258 3145"
      xmlns="http://www.w3.org/2000/svg"
      preserveAspectRatio="xMidYMid meet"
    >
      <g ref="head">
        <g ref="earL">
          <path
            d="M250.933 816.547C112.346 644.51 138.887 391.987 310.213 252.523C481.539 113.058 732.772 139.464 871.359 311.501L878.08 319.845C934.999 390.503 924.099 494.217 853.733 551.497L488.124 849.114C417.758 906.394 314.573 895.549 257.654 824.891L250.933 816.547Z"
            fill="#B36028"
          />
        </g>
        <g ref="earR">
          <path
            d="M2441.3 260.938C2613.34 122.352 2865.86 148.893 3005.33 320.219C3144.79 491.545 3118.39 742.778 2946.35 881.364L2938.01 888.086C2867.35 945.005 2763.63 934.105 2706.35 863.739L2408.74 498.13C2351.46 427.764 2362.3 324.579 2432.96 267.66L2441.3 260.938Z"
            fill="#B36028"
          />
        </g>
        <g>
          <path
            d="M160.012 1457.63C160.012 701.761 772.766 89.0068 1528.64 89.0068H1691.39C2447.26 89.0068 3060.01 701.761 3060.01 1457.63V2045C3060.01 2210.68 2925.7 2345 2760.01 2345H460.012C294.326 2345 160.012 2210.68 160.012 2045V1457.63Z"
            fill="#EFA432"
            stroke="#CB862A"
            stroke-width="20"
          />
          <path
            d="M1440.49 1879H1690.49V2039C1690.49 2108.03 1634.53 2164 1565.49 2164C1496.46 2164 1440.49 2108.03 1440.49 2039V1879Z"
            fill="#EFA532"
          />
          <path
            d="M1657.49 1879H1906.49V2039.5C1906.49 2108.26 1850.75 2164 1781.99 2164C1713.23 2164 1657.49 2108.26 1657.49 2039.5V1879Z"
            fill="#EFA532"
          />
        </g>
        <g ref="eyeL">
          <ellipse class="eye-normal" cx="1168.99" cy="1278.5" rx="127.5" ry="177.5" fill="#562001" />
          <g class="eye-x" opacity="0">
            <path
              d="M1090 1200 L1250 1360 M1250 1200 L1090 1360"
              stroke="#562001"
              stroke-width="46"
              stroke-linecap="round"
            />
          </g>
          <path
            class="eye-happy"
            opacity="0"
            d="M1049 1330C1049 1330 1080 1260 1169 1260C1258 1260 1289 1330 1289 1330"
            stroke="#562001"
            stroke-width="70"
            stroke-linecap="round"
            fill="none"
          />
        </g>
        <g ref="eyeR">
          <ellipse class="eye-normal" cx="2141.99" cy="1278.5" rx="127.5" ry="177.5" fill="#562001" />
          <g class="eye-x" opacity="0">
            <path
              d="M2063 1200 L2223 1360 M2223 1200 L2063 1360"
              stroke="#562001"
              stroke-width="46"
              stroke-linecap="round"
            />
          </g>
          <path
            class="eye-happy"
            opacity="0"
            d="M2022 1330C2022 1330 2053 1260 2142 1260C2231 1260 2262 1330 2262 1330"
            stroke="#562001"
            stroke-width="70"
            stroke-linecap="round"
            fill="none"
          />
        </g>
        <g ref="ebL">
          <rect x="1049.49" y="859.996" width="240" height="161" rx="80.5" fill="#B75C25" />
        </g>
        <g ref="ebR">
          <rect x="2014.49" y="859.996" width="240" height="161" rx="80.5" fill="#B75C25" />
        </g>
        <g ref="toothL">
          <path
            d="M1503.49 1879H1678.49V1991.5C1678.49 2039.82 1639.32 2079 1590.99 2079C1542.67 2079 1503.49 2039.82 1503.49 1991.5V1879Z"
            fill="#FBFCFF"
          />
        </g>
        <g ref="toothR">
          <path
            d="M1679.49 1879H1854.49V1991.5C1854.49 2039.82 1815.32 2079 1766.99 2079C1718.67 2079 1679.49 2039.82 1679.49 1991.5V1879Z"
            fill="#FBFCFF"
          />
        </g>
        <g ref="muzzle">
          <rect x="1185.49" y="1623" width="990" height="320" rx="160" fill="#FAE5B8" />
        </g>
        <g ref="nose">
          <path
            d="M1535.49 1641.66C1535.49 1604.84 1565.34 1575 1602.16 1575H1753.83C1790.64 1575 1820.49 1604.84 1820.49 1641.66C1820.49 1715.3 1760.8 1775 1687.16 1775H1668.83C1595.19 1775 1535.49 1715.3 1535.49 1641.66Z"
            fill="#B45F28"
          />
        </g>
      </g>
    </svg>
  </div>
</template>

<script>
import { ref, onMounted, onUnmounted } from 'vue';

export default {
  name: 'BeaverCharacter',
  setup() {
    const rootEl = ref(null);
    const stage = ref(null);
    const head = ref(null);
    const earL = ref(null);
    const earR = ref(null);
    const ebL = ref(null);
    const ebR = ref(null);
    const eyeL = ref(null);
    const eyeR = ref(null);
    const nose = ref(null);
    const muzzle = ref(null);
    const toothL = ref(null);
    const toothR = ref(null);

    const EBL_CX = 1169.49;
    const EBL_CY = 940.5;
    const EBR_CX = 2134.49;
    const EBR_CY = 940.5;
    const EYEL_CX = 1168.99;
    const EYEL_CY = 1278.5;
    const EYER_CX = 2141.99;
    const EYER_CY = 1278.5;
    const EARL_PX = 610;
    const EARL_PY = 700;
    const EARR_PX = 2648;
    const EARR_PY = 700;
    const HEAD_PIVOT_X = 1610;
    const HEAD_PIVOT_Y = 1100;

    function ease(t) {
      return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
    }
    function easeOutCubic(t) {
      return 1 - Math.pow(1 - t, 3);
    }
    function lerp(a, b, t) {
      return a + (b - a) * t;
    }

    // Dirty-checked CSS-transform writes: style.transform/opacity (not SVG
    // attributes) so the browser composites on the GPU; no-op writes are
    // skipped entirely.
    const _lastT = new WeakMap();
    const _lastO = new WeakMap();
    function set(el, x, y, rot, sx, sy, ox, oy) {
      ox = ox || 0;
      oy = oy || 0;
      sx = sx === undefined ? 1 : sx;
      sy = sy === undefined ? 1 : sy;
      rot = rot || 0;
      const v =
        `translate(${x}px,${y}px) translate(${ox}px,${oy}px) rotate(${rot}deg) scale(${sx},${sy}) translate(${-ox}px,${-oy}px)`;
      if (_lastT.get(el) !== v) {
        el.style.transform = v;
        _lastT.set(el, v);
      }
    }
    function fade(el, v) {
      if (_lastO.get(el) !== v) {
        el.style.opacity = v;
        _lastO.set(el, v);
      }
    }

    const SNAP = 0.11;
    function saccade(points, t) {
      let cur = points[0];
      let prev = points[0];
      for (let i = 0; i < points.length; i++) {
        if (points[i].t <= t) {
          prev = cur;
          cur = points[i];
        }
      }
      const frac = Math.min(1, (t - cur.t) / SNAP);
      const e = easeOutCubic(frac);
      return { x: lerp(prev.x, cur.x, e), y: lerp(prev.y, cur.y, e) };
    }
    function microjitter(t, seed) {
      return {
        x: Math.sin(t * 9 + seed) * 2.2 + Math.sin(t * 23 + seed) * 1.1,
        y: Math.cos(t * 7 + seed) * 1.6 + Math.sin(t * 19 + seed) * 0.9,
      };
    }

    const PHASES = [
      { name: 'idle', dur: 3 },
      { name: 'thinking', dur: 3 },
      { name: 'searching', dur: 3 },
      { name: 'writing', dur: 3 },
      { name: 'error', dur: 2 },
      { name: 'greeting', dur: 3 },
    ];
    const TOTAL = PHASES.reduce((s, p) => s + p.dur, 0);
    let starts = [0];
    PHASES.forEach((p, i) => starts.push(starts[i] + p.dur));

    const THINK_PTS = [
      { t: 0, x: 0, y: 0 },
      { t: 0.35, x: -72, y: -12 },
      { t: 1.2, x: 74, y: -14 },
      { t: 2.1, x: -10, y: 14 },
      { t: 2.7, x: 0, y: 0 },
    ];
    const SEARCH_PTS = [
      { t: 0, x: 0, y: 0 },
      { t: 0.15, x: -60, y: -32 },
      { t: 0.65, x: 55, y: -32 },
      { t: 1.15, x: 0, y: 0 },
      { t: 1.6, x: -60, y: -32 },
      { t: 2.1, x: 55, y: -32 },
      { t: 2.6, x: 0, y: 0 },
    ];

    function smooth(state, key, target, dt, speed) {
      state[key] += (target - state[key]) * Math.min(1, dt * speed);
      return state[key];
    }

    const ebLs = { x: 0, y: 0, rot: 0 };
    const ebRs = { x: 0, y: 0, rot: 0 };
    const toothS = { ly: 0, ry: 0, sc: 1 };
    let earLstate = 0;
    let earRstate = 0;
    let lastNow = 0;
    let t0 = 0;

    // Cursor tracking (normalized -1..1 relative to the component center).
    let cursorX = 0;
    let cursorY = 0;
    // Forced greeting window (on click / touch).
    let forcedStart = 0;
    let forcedUntil = 0;

    let rafId = 0;
    let els = null;
    let running = false;

    function greet() {
      const now = performance.now();
      forcedStart = now;
      forcedUntil = now + 3000;
    }

    function onMouseMove(e) {
      const rect = rootEl.value?.getBoundingClientRect();
      if (!rect || rect.width === 0) return;
      cursorX = ((e.clientX - rect.left) / rect.width - 0.5) * 2;
      cursorY = ((e.clientY - rect.top) / rect.height - 0.5) * 2;
    }

    function frame(now) {
      rafId = requestAnimationFrame(frame);
      // Skip all work while the tab is hidden (rAF is throttled anyway, but
      // the dt clamp + early return keep the timeline from jumping).
      if (document.hidden) {
        lastNow = now;
        return;
      }
      const dt = Math.min(0.05, (now - lastNow) / 1000);
      lastNow = now;

      const greets = now < forcedUntil;
      let t;
      let idx;
      if (greets) {
        t = (now - forcedStart) / 1000;
        idx = PHASES.findIndex((p) => p.name === 'greeting');
      } else {
        t = ((now - t0) / 1000) % TOTAL;
        idx = 0;
        while (idx < PHASES.length - 1 && t >= starts[idx + 1]) idx++;
      }
      const local = greets ? t : t - starts[idx];
      const dur = PHASES[idx].dur;

      fade(els.eyeLX, 0);
      fade(els.eyeRX, 0);
      fade(els.eyeLHappy, 0);
      fade(els.eyeRHappy, 0);
      fade(els.eyeLNorm, 1);
      fade(els.eyeRNorm, 1);

      let headX = 0;
      let headY = 0;
      let headRot = 0;
      let ebLx = 0;
      let ebLy = 0;
      let ebLrot = 0;
      let ebRx = 0;
      let ebRy = 0;
      let ebRrot = 0;
      let eyeLsy = 1;
      let eyeRsy = 1;
      let eyeSc = 1;
      let eyeLdx = 0;
      let eyeLdy = 0;
      let eyeRdx = 0;
      let eyeRdy = 0;
      let noseY = 0;
      let muzzleSX = 1;
      let toothLy = 0;
      let toothRy = 0;
      let toothSc = 1;
      let earPose = 0;

      const phase = PHASES[idx].name;

      if (phase === 'idle') {
        if (local > 0.9 && local < 1.05) {
          const b = 1 - Math.abs((local - 0.975) / 0.075);
          eyeLsy = 1 - 0.9 * b;
          eyeRsy = 1 - 0.9 * b;
          ebLy = 10 * b;
          ebRy = 10 * b;
        }
        if (local > 1.5 && local < 1.9) {
          const b = ease(Math.min(1, (local - 1.5) / 0.2));
          noseY = -14 * Math.sin(b * Math.PI);
          toothSc = 1 + 0.12 * Math.sin(b * Math.PI * 2);
        }
        const j = microjitter(t, 0);
        eyeLdx = j.x;
        eyeLdy = j.y;
        eyeRdx = j.x;
        eyeRdy = j.y;
      } else if (phase === 'thinking') {
        const s = saccade(THINK_PTS, local);
        eyeLdx = s.x;
        eyeLdy = s.y;
        eyeRdx = s.x;
        eyeRdy = s.y;
        ebLrot = -8;
        ebLy = -24;
        ebRrot = 6;
        ebRy = -6;
        muzzleSX = 1 + 0.02 * Math.sin(t * Math.PI * 2 * 4);
      } else if (phase === 'searching') {
        eyeSc = 1.1;
        const s = saccade(SEARCH_PTS, local);
        eyeLdx = s.x;
        eyeLdy = s.y;
        eyeRdx = s.x;
        eyeRdy = s.y;
        noseY = -16 * Math.abs(Math.sin(t * Math.PI * 4));
        headRot = 0;
        earPose = 6;
        ebLx = s.x * 0.5;
        ebLy = -12 + s.y * 0.35;
        ebRx = s.x * 0.5;
        ebRy = -12 + s.y * 0.35;
      } else if (phase === 'writing') {
        const freq = 2; // 120 bpm
        const bounce = Math.abs(Math.sin(t * Math.PI * 2 * freq));
        headY = -bounce * (2345 * 0.0013);
        toothSc = 1 + 0.25 * bounce;
        ebLy = -8 * bounce;
        ebRy = -8 * bounce;
        const j = microjitter(t, 5);
        eyeLdx = j.x * 0.6;
        eyeLdy = j.y * 0.6 + 8;
        eyeRdx = j.x * 0.6;
        eyeRdy = j.y * 0.6 + 8;
      } else if (phase === 'error') {
        const shakeT = Math.min(1, local / 0.35);
        headX = local < 0.35 ? Math.sin(local * Math.PI * 10) * (1 - shakeT) * 25 : 0;
        ebLrot = 16;
        ebLy = -6;
        ebLx = 0;
        ebRrot = -16;
        ebRy = -6;
        ebRx = 0;
        fade(els.eyeLNorm, 0);
        fade(els.eyeRNorm, 0);
        const blinkPhase = (local * 4) % 1;
        const blinkOn = blinkPhase < 0.5 && local > 0.5;
        fade(els.eyeLX, blinkOn ? 0 : 1);
        fade(els.eyeRX, blinkOn ? 0 : 1);
      } else if (phase === 'greeting') {
        const holdEase = ease(Math.min(1, local / 0.4));
        headY = -holdEase * 8;
        ebLy = -22 * holdEase;
        ebRy = -22 * holdEase;
        fade(els.eyeLNorm, 1 - holdEase);
        fade(els.eyeRNorm, 1 - holdEase);
        fade(els.eyeLHappy, holdEase);
        fade(els.eyeRHappy, holdEase);
        muzzleSX = 1 + 0.12 * holdEase;
        earPose = 9 * holdEase * Math.sin(t * Math.PI * 2 * 3);
        if (local > dur - 0.6) {
          const back = ease((local - (dur - 0.6)) / 0.6);
          headY = lerp(headY, 0, back);
          ebLy = lerp(ebLy, 0, back);
          ebRy = lerp(ebRy, 0, back);
          fade(els.eyeLNorm, lerp(1 - holdEase, 1, back));
          fade(els.eyeRNorm, lerp(1 - holdEase, 1, back));
          fade(els.eyeLHappy, lerp(holdEase, 0, back));
          fade(els.eyeRHappy, lerp(holdEase, 0, back));
          muzzleSX = lerp(muzzleSX, 1, back);
          earPose = lerp(earPose, 0, back);
        }
      }

      // Eyes subtly track the cursor (on top of the phase pose).
      eyeLdx += cursorX * 14;
      eyeLdy += cursorY * 10;
      eyeRdx += cursorX * 14;
      eyeRdy += cursorY * 10;

      const earLtarget = Math.max(-16, Math.min(16, headRot * 0.8 + earPose * 1.1));
      const earRtarget = Math.max(-16, Math.min(16, headRot * 0.8 - earPose * 1.1));
      earLstate += (earLtarget - earLstate) * Math.min(1, dt * 8);
      earRstate += (earRtarget - earRstate) * Math.min(1, dt * 8);

      const SP = 11;
      const ebLxS = smooth(ebLs, 'x', ebLx, dt, SP);
      const ebLyS = smooth(ebLs, 'y', ebLy, dt, SP);
      const ebLrotS = smooth(ebLs, 'rot', ebLrot, dt, SP);
      const ebRxS = smooth(ebRs, 'x', ebRx, dt, SP);
      const ebRyS = smooth(ebRs, 'y', ebRy, dt, SP);
      const ebRrotS = smooth(ebRs, 'rot', ebRrot, dt, SP);
      const toothLyS = smooth(toothS, 'ly', toothLy, dt, SP);
      const toothRyS = smooth(toothS, 'ry', toothRy, dt, SP);
      const toothScS = smooth(toothS, 'sc', toothSc, dt, SP);

      set(els.head, headX, headY, headRot, 1, 1, HEAD_PIVOT_X, HEAD_PIVOT_Y);
      set(els.earL, 0, 0, earLstate, 1, 1, EARL_PX, EARL_PY);
      set(els.earR, 0, 0, earRstate, 1, 1, EARR_PX, EARR_PY);
      set(els.ebL, ebLxS, ebLyS, ebLrotS, 1, 1, EBL_CX, EBL_CY);
      set(els.ebR, ebRxS, ebRyS, ebRrotS, 1, 1, EBR_CX, EBR_CY);
      set(els.eyeL, eyeLdx, eyeLdy, 0, eyeSc, eyeSc * eyeLsy, EYEL_CX, EYEL_CY);
      set(els.eyeR, eyeRdx, eyeRdy, 0, eyeSc, eyeSc * eyeRsy, EYER_CX, EYER_CY);
      set(els.nose, 0, noseY, 0, 1, 1, 1687, 1675);
      set(els.muzzle, 0, 0, 0, muzzleSX, 1, 1680, 1783);
      set(els.toothL, headX * 0.3, toothLyS, 0, toothScS, toothScS, 1590, 1980);
      set(els.toothR, headX * 0.3, toothRyS, 0, toothScS, toothScS, 1767, 1980);
    }

    onMounted(() => {
      els = {
        head: head.value,
        earL: earL.value,
        earR: earR.value,
        ebL: ebL.value,
        ebR: ebR.value,
        eyeL: eyeL.value,
        eyeR: eyeR.value,
        nose: nose.value,
        muzzle: muzzle.value,
        toothL: toothL.value,
        toothR: toothR.value,
        eyeLNorm: eyeL.value.querySelector('.eye-normal'),
        eyeRNorm: eyeR.value.querySelector('.eye-normal'),
        eyeLX: eyeL.value.querySelector('.eye-x'),
        eyeRX: eyeR.value.querySelector('.eye-x'),
        eyeLHappy: eyeL.value.querySelector('.eye-happy'),
        eyeRHappy: eyeR.value.querySelector('.eye-happy'),
      };
      t0 = performance.now();
      lastNow = t0;
      running = true;

      // Respect reduced-motion: show a static beaver, no animation.
      const reducedMotion =
        typeof document !== 'undefined' &&
        document.documentElement?.classList.contains('prefers-reduced-motion');
      if (reducedMotion) return;

      rafId = requestAnimationFrame(frame);
    });

    onUnmounted(() => {
      running = false;
      if (rafId) cancelAnimationFrame(rafId);
    });

    return {
      rootEl,
      stage,
      head,
      earL,
      earR,
      ebL,
      ebR,
      eyeL,
      eyeR,
      nose,
      muzzle,
      toothL,
      toothR,
      greet,
      onMouseMove,
    };
  },
};
</script>

<style scoped>
.beaver-character {
  display: inline-flex;
  cursor: pointer;
  user-select: none;
  -webkit-user-select: none;
  touch-action: manipulation;
}
.beaver-character svg {
  width: 100%;
  height: auto;
  display: block;
}
/* Promote animated parts to their own compositor layers; CSS transforms must
   pivot at 0 0 because the JS already bakes the pivot into the transform chain. */
.beaver-character :deep(g) {
  transform-origin: 0 0;
  will-change: transform, opacity;
}
@media (prefers-reduced-motion: reduce) {
  .beaver-character :deep(g) {
    will-change: auto;
  }
}
</style>
