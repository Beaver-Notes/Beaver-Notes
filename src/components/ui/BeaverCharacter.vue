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
          <ellipse
            class="eye-normal"
            cx="1168.99"
            cy="1278.5"
            rx="127.5"
            ry="177.5"
            fill="#562001"
          />
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
          <path
            class="eye-closed"
            opacity="0"
            d="M1049 1250C1049 1250 1080 1330 1169 1330C1258 1330 1289 1250 1289 1250"
            stroke="#562001"
            stroke-width="70"
            stroke-linecap="round"
            fill="none"
          />
          <g class="eye-heart" opacity="0">
            <g transform="translate(1169 1302)">
              <path
                d="M0 95C-45 62 -130 5 -130 -52C-130 -92 -100 -118 -66 -118C-38 -118 -14 -103 0 -78C14 -103 38 -118 66 -118C100 -118 130 -92 130 -52C130 5 45 62 0 95Z"
                fill="#562001"
                stroke="#562001"
                stroke-width="20"
                stroke-linejoin="round"
              />
            </g>
          </g>
          <g class="eye-star" opacity="0">
            <g transform="translate(1169 1286)">
              <path
                d="M0 -150L36 -50L143 -46L59 19L88 121L0 62L-88 121L-59 19L-143 -46L-36 -50Z"
                fill="#562001"
                stroke="#562001"
                stroke-width="24"
                stroke-linejoin="round"
              />
            </g>
          </g>
          <g class="eye-spiral" opacity="0">
            <g class="eye-spiral-spin">
              <path
                d="M0 0 L2 1 L3 2 L4 4 L3 7 L2 9 L-1 11 L-5 12 L-9 12 L-14 10 L-18 6 L-21 1 L-22 -5 L-21 -12 L-19 -18 L-14 -24 L-7 -29 L2 -32 L11 -32 L20 -29 L29 -24 L36 -15 L41 -5 L43 7 L41 19 L35 31 L26 41 L15 48 L1 52 L-14 52 L-29 48 L-43 39 L-54 27 L-61 11 L-63 -6 L-61 -24 L-53 -41 L-41 -56 L-25 -67 L-6 -73 L15 -73 L36 -68 L54 -57 L70 -40 L80 -20 L84 3 L82 27 L73 49 L58 69 L37 84 L13 93 L-14 94 L-40 89 L-64 76 L-84 56 L-98 31 L-105 3"
                stroke="#562001"
                stroke-width="26"
                stroke-linecap="round"
                stroke-linejoin="round"
                fill="none"
              />
            </g>
          </g>
        </g>
        <g ref="eyeR">
          <ellipse
            class="eye-normal"
            cx="2141.99"
            cy="1278.5"
            rx="127.5"
            ry="177.5"
            fill="#562001"
          />
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
          <path
            class="eye-closed"
            opacity="0"
            d="M2022 1250C2022 1250 2053 1330 2142 1330C2231 1330 2262 1250 2262 1250"
            stroke="#562001"
            stroke-width="70"
            stroke-linecap="round"
            fill="none"
          />
          <g class="eye-heart" opacity="0">
            <g transform="translate(2142 1302)">
              <path
                d="M0 95C-45 62 -130 5 -130 -52C-130 -92 -100 -118 -66 -118C-38 -118 -14 -103 0 -78C14 -103 38 -118 66 -118C100 -118 130 -92 130 -52C130 5 45 62 0 95Z"
                fill="#562001"
                stroke="#562001"
                stroke-width="20"
                stroke-linejoin="round"
              />
            </g>
          </g>
          <g class="eye-star" opacity="0">
            <g transform="translate(2142 1286)">
              <path
                d="M0 -150L36 -50L143 -46L59 19L88 121L0 62L-88 121L-59 19L-143 -46L-36 -50Z"
                fill="#562001"
                stroke="#562001"
                stroke-width="24"
                stroke-linejoin="round"
              />
            </g>
          </g>
          <g class="eye-spiral" opacity="0">
            <g class="eye-spiral-spin">
              <path
                d="M0 0 L2 1 L3 2 L4 4 L3 7 L2 9 L-1 11 L-5 12 L-9 12 L-14 10 L-18 6 L-21 1 L-22 -5 L-21 -12 L-19 -18 L-14 -24 L-7 -29 L2 -32 L11 -32 L20 -29 L29 -24 L36 -15 L41 -5 L43 7 L41 19 L35 31 L26 41 L15 48 L1 52 L-14 52 L-29 48 L-43 39 L-54 27 L-61 11 L-63 -6 L-61 -24 L-53 -41 L-41 -56 L-25 -67 L-6 -73 L15 -73 L36 -68 L54 -57 L70 -40 L80 -20 L84 3 L82 27 L73 49 L58 69 L37 84 L13 93 L-14 94 L-40 89 L-64 76 L-84 56 L-98 31 L-105 3"
                stroke="#562001"
                stroke-width="26"
                stroke-linecap="round"
                stroke-linejoin="round"
                fill="none"
              />
            </g>
          </g>
        </g>
        <g class="lid-l" opacity="0">
          <rect x="919" y="1075" width="500" height="400" fill="#EFA432" />
        </g>
        <g class="lid-r" opacity="0">
          <rect x="1892" y="1075" width="500" height="400" fill="#EFA432" />
        </g>
        <g ref="ebL">
          <rect
            x="1049.49"
            y="859.996"
            width="240"
            height="161"
            rx="80.5"
            fill="#B75C25"
          />
        </g>
        <g ref="ebR">
          <rect
            x="2014.49"
            y="859.996"
            width="240"
            height="161"
            rx="80.5"
            fill="#B75C25"
          />
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
          <rect
            x="1185.49"
            y="1623"
            width="990"
            height="320"
            rx="160"
            fill="#FAE5B8"
          />
        </g>
        <g ref="nose">
          <path
            d="M1535.49 1641.66C1535.49 1604.84 1565.34 1575 1602.16 1575H1753.83C1790.64 1575 1820.49 1604.84 1820.49 1641.66C1820.49 1715.3 1760.8 1775 1687.16 1775H1668.83C1595.19 1775 1535.49 1715.3 1535.49 1641.66Z"
            fill="#B45F28"
          />
        </g>
        <g class="tear-l" opacity="0">
          <path
            d="M0 -62C30 -16 44 10 44 32A44 44 0 0 1 -44 32C-44 10 -30 -16 0 -62Z"
            fill="#6EC3FF"
          />
          <ellipse
            cx="-14"
            cy="30"
            rx="8"
            ry="15"
            fill="#FFFFFF"
            fill-opacity="0.6"
          />
        </g>
        <g class="tear-r" opacity="0">
          <path
            d="M0 -62C30 -16 44 10 44 32A44 44 0 0 1 -44 32C-44 10 -30 -16 0 -62Z"
            fill="#6EC3FF"
          />
          <ellipse
            cx="-14"
            cy="30"
            rx="8"
            ry="15"
            fill="#FFFFFF"
            fill-opacity="0.6"
          />
        </g>
        <g class="sweat" opacity="0">
          <g transform="scale(1.35)">
            <path
              d="M0 -62C30 -16 44 10 44 32A44 44 0 0 1 -44 32C-44 10 -30 -16 0 -62Z"
              fill="#6EC3FF"
            />
            <ellipse
              cx="-14"
              cy="30"
              rx="8"
              ry="15"
              fill="#FFFFFF"
              fill-opacity="0.6"
            />
          </g>
        </g>
      </g>
      <g class="mark-q" opacity="0">
        <path
          d="M-62 -70C-62 -135 62 -145 62 -70C62 -20 0 -25 0 35"
          stroke="#E8962B"
          stroke-width="38"
          stroke-linecap="round"
          fill="none"
        />
        <circle cx="0" cy="100" r="24" fill="#E8962B" />
      </g>
      <g class="mark-ex" opacity="0">
        <rect x="-26" y="-125" width="52" height="170" rx="26" fill="#E8962B" />
        <circle cx="0" cy="100" r="30" fill="#E8962B" />
      </g>
      <g class="mark-anger" opacity="0">
        <path
          d="M-72 -22C-30 -22 -22 -30 -22 -72M22 -72C22 -30 30 -22 72 -22M72 22C30 22 22 30 22 72M-22 72C-22 30 -30 22 -72 22"
          stroke="#E5483A"
          stroke-width="26"
          stroke-linecap="round"
          fill="none"
        />
      </g>
      <g class="fx-heart" opacity="0">
        <path
          d="M0 95C-45 62 -130 5 -130 -52C-130 -92 -100 -118 -66 -118C-38 -118 -14 -103 0 -78C14 -103 38 -118 66 -118C100 -118 130 -92 130 -52C130 5 45 62 0 95Z"
          fill="#B36028"
          stroke="#B36028"
          stroke-width="16"
          stroke-linejoin="round"
        />
      </g>
      <g class="fx-heart" opacity="0">
        <path
          d="M0 95C-45 62 -130 5 -130 -52C-130 -92 -100 -118 -66 -118C-38 -118 -14 -103 0 -78C14 -103 38 -118 66 -118C100 -118 130 -92 130 -52C130 5 45 62 0 95Z"
          fill="#B36028"
          stroke="#B36028"
          stroke-width="16"
          stroke-linejoin="round"
        />
      </g>
      <g class="fx-heart" opacity="0">
        <path
          d="M0 95C-45 62 -130 5 -130 -52C-130 -92 -100 -118 -66 -118C-38 -118 -14 -103 0 -78C14 -103 38 -118 66 -118C100 -118 130 -92 130 -52C130 5 45 62 0 95Z"
          fill="#B36028"
          stroke="#B36028"
          stroke-width="16"
          stroke-linejoin="round"
        />
      </g>
      <g class="fx-z" opacity="0">
        <path
          d="M-60 -60H60L-60 60H60"
          stroke="#6C9BE8"
          stroke-width="34"
          stroke-linecap="round"
          stroke-linejoin="round"
          fill="none"
        />
      </g>
      <g class="fx-z" opacity="0">
        <path
          d="M-60 -60H60L-60 60H60"
          stroke="#6C9BE8"
          stroke-width="34"
          stroke-linecap="round"
          stroke-linejoin="round"
          fill="none"
        />
      </g>
      <g class="fx-z" opacity="0">
        <path
          d="M-60 -60H60L-60 60H60"
          stroke="#6C9BE8"
          stroke-width="34"
          stroke-linecap="round"
          stroke-linejoin="round"
          fill="none"
        />
      </g>
      <g class="fx-spark" opacity="0">
        <path
          d="M0 -100Q8 -8 100 0Q8 8 0 100Q-8 8 -100 0Q-8 -8 0 -100Z"
          fill="#FFD23F"
          stroke="#E9A800"
          stroke-width="8"
          stroke-linejoin="round"
        />
      </g>
      <g class="fx-spark" opacity="0">
        <path
          d="M0 -100Q8 -8 100 0Q8 8 0 100Q-8 8 -100 0Q-8 -8 0 -100Z"
          fill="#FFD23F"
          stroke="#E9A800"
          stroke-width="8"
          stroke-linejoin="round"
        />
      </g>
      <g class="fx-spark" opacity="0">
        <path
          d="M0 -100Q8 -8 100 0Q8 8 0 100Q-8 8 -100 0Q-8 -8 0 -100Z"
          fill="#FFD23F"
          stroke="#E9A800"
          stroke-width="8"
          stroke-linejoin="round"
        />
      </g>
      <g class="fx-spark" opacity="0">
        <path
          d="M0 -100Q8 -8 100 0Q8 8 0 100Q-8 8 -100 0Q-8 -8 0 -100Z"
          fill="#FFD23F"
          stroke="#E9A800"
          stroke-width="8"
          stroke-linejoin="round"
        />
      </g>
    </svg>
  </div>
</template>

<script>
import { ref, computed, onMounted, onUnmounted } from 'vue';

export default {
  name: 'BeaverCharacter',
  props: {
    state: { type: [String, Array], default: null },
    auto: { type: Boolean, default: true },
    poses: { type: Array, default: null },
  },
  setup(props) {
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
    const LID_TOP = 1075;
    // Floating marks (?, !, anger) share one anchor above the right ear.
    const MARK_X = 3280;
    const MARK_Y = 140;
    const SPARK_POS = [
      [-190, 300],
      [3330, 520],
      [2980, -200],
      [40, -190],
    ];
    // Pose values that are eased in/out each frame instead of snapping.
    const SMOOTH_KEYS = [
      'lidL',
      'lidR',
      'lidRotL',
      'lidRotR',
      'eyeClosed',
      'eyeHeart',
      'eyeStar',
      'eyeSpiral',
      'winkL',
      'winkR',
      'fxQ',
      'fxEx',
      'fxZ',
      'fxHeart',
      'fxSpark',
      'fxAnger',
    ];

    function ease(t) {
      return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
    }
    function easeOutCubic(t) {
      return 1 - Math.pow(1 - t, 3);
    }
    function lerp(a, b, t) {
      return a + (b - a) * t;
    }

    const _lastT = new WeakMap();
    const _lastO = new WeakMap();
    function set(el, x, y, rot, sx, sy, ox, oy) {
      ox = ox || 0;
      oy = oy || 0;
      sx = sx === undefined ? 1 : sx;
      sy = sy === undefined ? 1 : sy;
      rot = rot || 0;
      const v = `translate(${x}px,${y}px) translate(${ox}px,${oy}px) rotate(${rot}deg) scale(${sx},${sy}) translate(${-ox}px,${-oy}px)`;
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

    function basePose() {
      return {
        headX: 0,
        headY: 0,
        headRot: 0,
        ebLx: 0,
        ebLy: 0,
        ebLrot: 0,
        ebRx: 0,
        ebRy: 0,
        ebRrot: 0,
        eyeLdx: 0,
        eyeLdy: 0,
        eyeRdx: 0,
        eyeRdy: 0,
        eyeLsy: 1,
        eyeRsy: 1,
        eyeSc: 1,
        noseY: 0,
        muzzleSX: 1,
        toothLy: 0,
        toothRy: 0,
        toothSc: 1,
        earPose: 0,
        eyeNorm: 1,
        eyeX: 0,
        eyeHappy: 0,
        // eyelids: 0 = open, 1 = fully closed; rot tilts the lid edge
        lidL: 0,
        lidR: 0,
        lidRotL: 0,
        lidRotR: 0,
        // extra eye shapes (cross-fade with the normal eye)
        eyeClosed: 0,
        eyeHeart: 0,
        eyeStar: 0,
        eyeSpiral: 0,
        winkL: 0,
        winkR: 0,
        // 0..1 progress of a falling drop (0 = hidden)
        tear: 0,
        sweat: 0,
        // floating marks, 0..1
        fxQ: 0,
        fxEx: 0,
        fxZ: 0,
        fxHeart: 0,
        fxSpark: 0,
        fxAnger: 0,
      };
    }

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

    function idlePose(t, local) {
      const p = basePose();
      if (local > 0.9 && local < 1.05) {
        const b = 1 - Math.abs((local - 0.975) / 0.075);
        p.eyeLsy = 1 - 0.9 * b;
        p.eyeRsy = 1 - 0.9 * b;
        p.ebLy = 10 * b;
        p.ebRy = 10 * b;
      }
      if (local > 1.5 && local < 1.9) {
        const b = ease(Math.min(1, (local - 1.5) / 0.2));
        p.noseY = -14 * Math.sin(b * Math.PI);
        p.toothSc = 1 + 0.12 * Math.sin(b * Math.PI * 2);
      }
      const j = microjitter(t, 0);
      p.eyeLdx = j.x;
      p.eyeLdy = j.y;
      p.eyeRdx = j.x;
      p.eyeRdy = j.y;
      return p;
    }

    function thinkingPose(t, local) {
      const p = basePose();
      const s = saccade(THINK_PTS, local);
      p.eyeLdx = s.x;
      p.eyeLdy = s.y;
      p.eyeRdx = s.x;
      p.eyeRdy = s.y;
      p.ebLrot = -8;
      p.ebLy = -24;
      p.ebRrot = 6;
      p.ebRy = -6;
      p.muzzleSX = 1 + 0.02 * Math.sin(t * Math.PI * 2 * 4);
      return p;
    }

    function searchingPose(t, local) {
      const p = basePose();
      p.eyeSc = 1; // keep eyes same size per review
      const s = saccade(SEARCH_PTS, local);
      p.eyeLdx = s.x;
      p.eyeLdy = s.y;
      p.eyeRdx = s.x;
      p.eyeRdy = s.y;
      p.noseY = -16 * Math.abs(Math.sin(t * Math.PI * 4));
      p.earPose = 6;
      p.ebLx = s.x * 0.5;
      p.ebLy = -12 + s.y * 0.35;
      p.ebRx = s.x * 0.5;
      p.ebRy = -12 + s.y * 0.35;
      return p;
    }

    function writingPose(t, local) {
      const p = basePose();
      const freq = 2; // 120 bpm
      const bounce = Math.abs(Math.sin(t * Math.PI * 2 * freq));
      p.headY = -bounce * (2345 * 0.0013);
      p.toothSc = 1 + 0.25 * bounce;
      p.ebLy = -8 * bounce;
      p.ebRy = -8 * bounce;
      const j = microjitter(t, 5);
      p.eyeLdx = j.x * 0.6;
      p.eyeLdy = j.y * 0.6 + 8;
      p.eyeRdx = j.x * 0.6;
      p.eyeRdy = j.y * 0.6 + 8;
      return p;
    }

    function errorPose(t, local) {
      const p = basePose();
      const shakeT = Math.min(1, local / 0.35);
      p.headX =
        local < 0.35 ? Math.sin(local * Math.PI * 10) * (1 - shakeT) * 25 : 0;
      p.ebLrot = 16;
      p.ebLy = -6;
      p.ebRrot = -16;
      p.ebRy = -6;
      p.eyeNorm = 0;
      const blinkPhase = (local * 4) % 1;
      const blinkOn = blinkPhase < 0.5 && local > 0.5;
      p.eyeX = blinkOn ? 0 : 1;
      return p;
    }

    function greetingPose(t, local) {
      const p = basePose();
      const holdEase = ease(Math.min(1, local / 0.4));
      p.headY = -holdEase * 8;
      p.ebLy = -22 * holdEase;
      p.ebRy = -22 * holdEase;
      p.eyeNorm = 1 - holdEase;
      p.eyeHappy = holdEase;
      p.muzzleSX = 1 + 0.12 * holdEase;
      p.earPose = 9 * holdEase * Math.sin(t * Math.PI * 2 * 3);
      return p;
    }

    // ── Emotions ──────────────────────────────────────────────────────
    // Use as <BeaverCharacter state="happy" /> or merge several, e.g.
    // :state="['thinking', 'confused']".
    const CONFUSED_PTS = [
      { t: 0, x: 0, y: 0 },
      { t: 0.4, x: -62, y: -22 },
      { t: 1.1, x: 54, y: -30 },
      { t: 1.8, x: -44, y: 10 },
      { t: 2.5, x: 58, y: -8 },
      { t: 3, x: 0, y: 0 },
    ];
    const NERVOUS_PTS = [
      { t: 0, x: -50, y: 8 },
      { t: 0.3, x: 56, y: -6 },
      { t: 0.55, x: -30, y: 18 },
      { t: 0.9, x: 62, y: 4 },
      { t: 1.2, x: -58, y: -10 },
    ];
    const SHY_PTS = [
      { t: 0, x: -34, y: 22 },
      { t: 2.2, x: 14, y: -6 },
      { t: 2.9, x: -34, y: 22 },
    ];

    // Occasional blink for states whose eyes are open.
    function autoBlink(p, t, seed) {
      const c = (t + seed) % 3.7;
      if (c < 0.12) {
        const b = 1 - Math.abs(c / 0.06 - 1);
        p.eyeLsy *= 1 - 0.9 * b;
        p.eyeRsy *= 1 - 0.9 * b;
      }
    }

    function happyPose(t) {
      const p = basePose();
      const w = Math.sin(t * Math.PI * 2 * 1.2);
      p.headY = -Math.abs(w) * 12;
      p.headRot = w * 1.8;
      p.eyeNorm = 0;
      p.eyeHappy = 1;
      p.ebLy = -16;
      p.ebRy = -16;
      p.muzzleSX = 1.05;
      p.earPose = 5 * w;
      return p;
    }

    function sadPose(t) {
      const p = basePose();
      const sob = Math.sin(t * Math.PI * 2 * 0.6);
      p.headY = 28 + sob * 4;
      p.headRot = -2;
      p.ebLrot = -16;
      p.ebRrot = 16;
      p.ebLy = -2;
      p.ebRy = -2;
      p.lidL = 0.3;
      p.lidR = 0.3;
      p.lidRotL = -14;
      p.lidRotR = 14;
      p.eyeLdy = 20;
      p.eyeRdy = 20;
      p.earPose = -10;
      p.muzzleSX = 0.97;
      p.tear = (t % 2.6) / 2.6;
      autoBlink(p, t, 1.3);
      return p;
    }

    function surprisedPose(t) {
      const p = basePose();
      p.headX = Math.sin(t * Math.PI * 2 * 9) * 2.5;
      p.headY = -14;
      p.eyeSc = 1.22;
      p.ebLy = -52;
      p.ebRy = -52;
      p.ebLrot = -4;
      p.ebRrot = 4;
      p.toothLy = 20;
      p.toothRy = 20;
      p.noseY = -6;
      p.earPose = 11;
      p.fxEx = 1;
      autoBlink(p, t, 2.1);
      return p;
    }

    function angryPose(t) {
      const p = basePose();
      const pulse = 0.5 + 0.5 * Math.sin(t * Math.PI * 2 * 3);
      p.headX = Math.sin(t * Math.PI * 2 * 14) * 3.5;
      p.headY = 10;
      p.ebLrot = 22;
      p.ebRrot = -22;
      p.ebLy = 20;
      p.ebRy = 20;
      p.ebLx = 12;
      p.ebRx = -12;
      p.lidL = 0.3;
      p.lidR = 0.3;
      p.lidRotL = 14;
      p.lidRotR = -14;
      p.toothSc = 1 + 0.08 * pulse;
      p.muzzleSX = 0.97;
      p.earPose = -7;
      p.fxAnger = 1;
      return p;
    }

    function sleepyPose(t) {
      const p = basePose();
      const br = Math.sin(t * Math.PI * 2 * 0.35);
      p.headY = 20 + br * 7;
      p.headRot = Math.sin(t * 0.8) * 4;
      p.eyeClosed = 1;
      p.ebLy = 8;
      p.ebRy = 8;
      p.earPose = -6;
      p.noseY = br * 3;
      p.muzzleSX = 1 + br * 0.012;
      p.fxZ = 1;
      return p;
    }

    function lovePose(t) {
      const p = basePose();
      const beat = Math.pow(Math.max(0, Math.sin(t * Math.PI * 2 * 1.6)), 3);
      p.headY = -beat * 8;
      p.headRot = Math.sin(t * Math.PI * 2 * 0.6) * 4;
      p.eyeHeart = 1;
      p.eyeSc = 1 + 0.14 * beat;
      p.ebLy = -18;
      p.ebRy = -18;
      p.muzzleSX = 1.05;
      p.earPose = 5 * Math.sin(t * Math.PI * 2 * 1.6);
      p.fxHeart = 1;
      return p;
    }

    function confusedPose(t) {
      const p = basePose();
      const s = saccade(CONFUSED_PTS, t % 3);
      p.headRot = 7 + Math.sin(t * Math.PI * 2 * 0.5) * 2;
      p.headY = 4;
      p.eyeLdx = s.x;
      p.eyeLdy = s.y;
      p.eyeRdx = s.x;
      p.eyeRdy = s.y;
      p.eyeLsy = 1.1;
      p.eyeRsy = 0.8;
      p.ebLy = -36;
      p.ebLrot = -10;
      p.ebRy = 14;
      p.ebRrot = -12;
      p.fxQ = 1;
      autoBlink(p, t, 0.7);
      return p;
    }

    function excitedPose(t) {
      const p = basePose();
      const a = t * Math.PI * 3;
      const b = Math.abs(Math.sin(a));
      p.headY = -b * 22;
      p.headRot = Math.sin(a) * 3;
      p.eyeStar = 1;
      p.eyeSc = 1 + 0.1 * b;
      p.ebLy = -34;
      p.ebRy = -34;
      p.muzzleSX = 1.08;
      p.toothSc = 1 + 0.2 * b;
      p.earPose = 10 * Math.sin(t * Math.PI * 2 * 3);
      p.fxSpark = 1;
      return p;
    }

    function smugPose(t) {
      const p = basePose();
      p.headRot = -5;
      p.headY = 4 + Math.sin(t * Math.PI * 2 * 0.4) * 2;
      p.lidL = 0.42;
      p.lidR = 0.42;
      p.ebLy = 8;
      p.ebLrot = 8;
      p.ebRy = -30;
      p.ebRrot = -6;
      p.eyeLdx = 20;
      p.eyeRdx = 20;
      p.muzzleSX = 1.03;
      autoBlink(p, t, 3.1);
      return p;
    }

    function winkPose(t) {
      const p = basePose();
      const on = t % 2.6 > 0.5 && t % 2.6 < 2.0 ? 1 : 0;
      p.winkR = on;
      p.headRot = 5;
      p.headY = -4;
      p.ebLy = -16;
      p.ebRy = on ? 10 : -4;
      p.muzzleSX = 1.04;
      p.fxSpark = on * 0.8;
      return p;
    }

    function nervousPose(t) {
      const p = basePose();
      const tr = Math.sin(t * Math.PI * 2 * 11);
      const s = saccade(NERVOUS_PTS, t % 1.5);
      p.headX = tr * 4;
      p.eyeLdx = s.x;
      p.eyeLdy = s.y;
      p.eyeRdx = s.x;
      p.eyeRdy = s.y;
      p.ebLrot = -12;
      p.ebRrot = 12;
      p.ebLy = -22;
      p.ebRy = -22;
      p.toothLy = tr * 5;
      p.toothRy = -tr * 5;
      p.earPose = -4;
      p.sweat = (t % 1.8) / 1.8;
      autoBlink(p, t, 0.4);
      return p;
    }

    function shyPose(t) {
      const p = basePose();
      const s = saccade(SHY_PTS, t % 3.8);
      p.headRot = -6 + Math.sin(t * Math.PI * 2 * 0.45) * 1.5;
      p.headY = 14;
      p.eyeLdx = s.x;
      p.eyeLdy = s.y;
      p.eyeRdx = s.x;
      p.eyeRdy = s.y;
      p.ebLrot = -10;
      p.ebRrot = 10;
      p.ebLy = -6;
      p.ebRy = -6;
      p.earPose = -5;
      p.muzzleSX = 0.98;
      autoBlink(p, t, 2.6);
      return p;
    }

    function dizzyPose(t) {
      const p = basePose();
      const w = t * Math.PI * 2 * 0.9;
      p.headRot = Math.sin(w) * 9;
      p.headX = Math.sin(w + 1.2) * 16;
      p.headY = Math.cos(w * 2) * 5;
      p.eyeSpiral = 1;
      p.ebLy = -8;
      p.ebRy = -8;
      p.ebLrot = -6;
      p.ebRrot = 6;
      p.earPose = 8 * Math.sin(w + 2);
      p.fxSpark = 0.8;
      return p;
    }

    // Beaver-specific: gnawing on a log.
    function chewingPose(t) {
      const p = basePose();
      const c = Math.sin(t * Math.PI * 2 * 3.2);
      p.eyeNorm = 0;
      p.eyeHappy = 1;
      p.headY = -Math.abs(c) * 6;
      p.headRot = c * 1.2;
      p.ebLy = -8;
      p.ebRy = -8;
      p.muzzleSX = 1 + 0.07 * c;
      p.toothLy = 12 * c;
      p.toothRy = 12 * c;
      p.noseY = -6 * Math.abs(c);
      p.earPose = 7 * c;
      return p;
    }

    function cursorTrackPose() {
      const p = basePose();
      // smoothed cursor for natural lag (spring-like)
      p.eyeLdx = cursorS.x * 13;
      p.eyeLdy = cursorS.y * 9;
      p.eyeRdx = cursorS.x * 13;
      p.eyeRdy = cursorS.y * 9;
      // subtle head micro-follow
      p.headX = cursorS.x * 1.2;
      p.headY = cursorS.y * 0.9;
      return p;
    }

    const STATE_POSES = {
      idle: idlePose,
      thinking: thinkingPose,
      searching: searchingPose,
      writing: writingPose,
      error: errorPose,
      greeting: greetingPose,
      cursorTrack: cursorTrackPose,
      // emotions
      happy: happyPose,
      sad: sadPose,
      surprised: surprisedPose,
      angry: angryPose,
      sleepy: sleepyPose,
      love: lovePose,
      confused: confusedPose,
      excited: excitedPose,
      smug: smugPose,
      wink: winkPose,
      nervous: nervousPose,
      shy: shyPose,
      dizzy: dizzyPose,
      chewing: chewingPose,
    };

    const ADDITIVE_KEYS = ['eyeLdx', 'eyeLdy', 'eyeRdx', 'eyeRdy'];

    function mergeStates(names, t, local) {
      const useLocal = local === undefined ? t : local;
      const defaults = basePose();
      const pose = basePose();
      const additive = { eyeLdx: 0, eyeLdy: 0, eyeRdx: 0, eyeRdy: 0 };
      const touched = {
        eyeLdx: false,
        eyeLdy: false,
        eyeRdx: false,
        eyeRdy: false,
      };
      for (const name of names) {
        const fn = STATE_POSES[name];
        if (!fn) continue;
        const part = fn(t, useLocal);
        for (const key of Object.keys(pose)) {
          if (part[key] === defaults[key]) continue;
          if (ADDITIVE_KEYS.includes(key)) {
            additive[key] += part[key];
            touched[key] = true;
          } else {
            pose[key] = part[key];
          }
        }
      }
      for (const key of ADDITIVE_KEYS) {
        if (touched[key]) pose[key] = additive[key];
      }
      return pose;
    }

    const DEFAULT_PHASES = [
      { name: 'idle', dur: 3 },
      { name: 'thinking', dur: 3 },
      { name: 'searching', dur: 3 },
      { name: 'writing', dur: 3 },
      { name: 'error', dur: 2 },
      { name: 'greeting', dur: 3 },
      { name: 'happy', dur: 3 },
      { name: 'excited', dur: 3 },
      { name: 'love', dur: 3 },
      { name: 'wink', dur: 3 },
      { name: 'shy', dur: 3 },
      { name: 'smug', dur: 3 },
      { name: 'confused', dur: 3 },
      { name: 'surprised', dur: 3 },
      { name: 'nervous', dur: 3 },
      { name: 'sad', dur: 3 },
      { name: 'angry', dur: 3 },
      { name: 'dizzy', dur: 3 },
      { name: 'chewing', dur: 3 },
      { name: 'sleepy', dur: 3 },
    ];

    const phases = computed(() => {
      const src =
        Array.isArray(props.poses) && props.poses.length
          ? props.poses
          : DEFAULT_PHASES;
      return src.map((p) => ({
        names: Array.isArray(p.name) ? p.name : [p.name],
        dur: p.dur,
      }));
    });
    const total = computed(() => phases.value.reduce((s, p) => s + p.dur, 0));
    const starts = computed(() => {
      const arr = [0];
      phases.value.forEach((p, i) => arr.push(arr[i] + p.dur));
      return arr;
    });

    function smooth(state, key, target, dt, speed) {
      state[key] += (target - state[key]) * Math.min(1, dt * speed);
      return state[key];
    }

    const ebLs = { x: 0, y: 0, rot: 0 };
    const ebRs = { x: 0, y: 0, rot: 0 };
    const toothS = { ly: 0, ry: 0, sc: 1 };
    const fxS = Object.fromEntries(SMOOTH_KEYS.map((k) => [k, 0]));

    function smoothFx(key, target, dt) {
      fxS[key] += (target - fxS[key]) * Math.min(1, dt * 10);
      if (target === 0 && fxS[key] < 0.002) fxS[key] = 0;
    }
    function showFx(el, amt, x, y, rot, sc) {
      if (amt < 0.01) {
        fade(el, 0);
        return;
      }
      fade(el, amt);
      set(el, x, y, rot, sc, sc, 0, 0);
    }
    function dropFx(el, prog, x, y, fall) {
      if (prog <= 0) {
        fade(el, 0);
        return;
      }
      const sc = 0.45 + 0.55 * Math.min(1, prog * 3);
      fade(el, Math.min(1, prog * 6, (1 - prog) * 3.5));
      set(el, x, y + prog * fall, 0, sc, sc, 0, 0);
    }
    let earLstate = 0;
    let earRstate = 0;
    let lastNow = 0;
    let t0 = 0;

    let cursorX = 0;
    let cursorY = 0;
    const cursorS = { x: 0, y: 0 };
    let forcedStart = 0;
    let forcedUntil = 0;

    let rafId = 0;
    let els = null;

    function requestedStates() {
      if (props.state == null) return [];
      if (Array.isArray(props.state)) return props.state.filter(Boolean);
      const s = String(props.state).trim();
      return s ? [s] : [];
    }

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
      if (document.hidden) {
        lastNow = now;
        return;
      }
      const dt = Math.min(0.05, (now - lastNow) / 1000);
      lastNow = now;
      // Natural cursor follow: critically damped spring (no overshoot).
      cursorS.x += (cursorX - cursorS.x) * Math.min(1, dt * 7);
      cursorS.y += (cursorY - cursorS.y) * Math.min(1, dt * 7);

      const greets = now < forcedUntil;
      let pose;
      const states = requestedStates();
      if (greets) {
        pose = greetingPose(
          (now - forcedStart) / 1000,
          (now - forcedStart) / 1000,
        );
      } else if (states.length > 0) {
        pose = mergeStates(states, (now - t0) / 1000);
      } else if (props.auto) {
        const ph = phases.value;
        const tot = total.value;
        const st = starts.value;
        const t = ((now - t0) / 1000) % tot;
        let idx = 0;
        while (idx < ph.length - 1 && t >= st[idx + 1]) idx++;
        const local = t - st[idx];
        pose = mergeStates(ph[idx].names, t, local);
      } else {
        pose = idlePose((now - t0) / 1000, 0);
      }

      const tNow = (now - t0) / 1000;
      for (const k of SMOOTH_KEYS) smoothFx(k, pose[k], dt);

      const specialEye = Math.max(
        fxS.eyeClosed,
        fxS.eyeHeart,
        fxS.eyeStar,
        fxS.eyeSpiral,
      );
      const normEye = pose.eyeNorm * (1 - specialEye);
      fade(els.eyeLX, pose.eyeX);
      fade(els.eyeRX, pose.eyeX);
      fade(els.eyeLHappy, Math.max(pose.eyeHappy, fxS.winkL));
      fade(els.eyeRHappy, Math.max(pose.eyeHappy, fxS.winkR));
      fade(els.eyeLNorm, normEye * (1 - fxS.winkL));
      fade(els.eyeRNorm, normEye * (1 - fxS.winkR));
      fade(els.eyeLClosed, fxS.eyeClosed);
      fade(els.eyeRClosed, fxS.eyeClosed);
      fade(els.eyeLHeart, fxS.eyeHeart);
      fade(els.eyeRHeart, fxS.eyeHeart);
      fade(els.eyeLStar, fxS.eyeStar);
      fade(els.eyeRStar, fxS.eyeStar);
      fade(els.eyeLSpiral, fxS.eyeSpiral);
      fade(els.eyeRSpiral, fxS.eyeSpiral);

      const earLtarget = Math.max(
        -16,
        Math.min(16, pose.headRot * 0.8 + pose.earPose * 1.1),
      );
      const earRtarget = Math.max(
        -16,
        Math.min(16, pose.headRot * 0.8 - pose.earPose * 1.1),
      );
      earLstate += (earLtarget - earLstate) * Math.min(1, dt * 8);
      earRstate += (earRtarget - earRstate) * Math.min(1, dt * 8);

      const SP = 11;
      const ebLxS = smooth(ebLs, 'x', pose.ebLx, dt, SP);
      const ebLyS = smooth(ebLs, 'y', pose.ebLy, dt, SP);
      const ebLrotS = smooth(ebLs, 'rot', pose.ebLrot, dt, SP);
      const ebRxS = smooth(ebRs, 'x', pose.ebRx, dt, SP);
      const ebRyS = smooth(ebRs, 'y', pose.ebRy, dt, SP);
      const ebRrotS = smooth(ebRs, 'rot', pose.ebRrot, dt, SP);
      const toothLyS = smooth(toothS, 'ly', pose.toothLy, dt, SP);
      const toothRyS = smooth(toothS, 'ry', pose.toothRy, dt, SP);
      const toothScS = smooth(toothS, 'sc', pose.toothSc, dt, SP);

      set(
        els.head,
        pose.headX,
        pose.headY,
        pose.headRot,
        1,
        1,
        HEAD_PIVOT_X,
        HEAD_PIVOT_Y,
      );
      set(els.earL, 0, 0, earLstate, 1, 1, EARL_PX, EARL_PY);
      set(els.earR, 0, 0, earRstate, 1, 1, EARR_PX, EARR_PY);
      set(els.ebL, ebLxS, ebLyS, ebLrotS, 1, 1, EBL_CX, EBL_CY);
      set(els.ebR, ebRxS, ebRyS, ebRrotS, 1, 1, EBR_CX, EBR_CY);
      set(
        els.eyeL,
        pose.eyeLdx,
        pose.eyeLdy,
        0,
        pose.eyeSc,
        pose.eyeSc * pose.eyeLsy,
        EYEL_CX,
        EYEL_CY,
      );
      set(
        els.eyeR,
        pose.eyeRdx,
        pose.eyeRdy,
        0,
        pose.eyeSc,
        pose.eyeSc * pose.eyeRsy,
        EYER_CX,
        EYER_CY,
      );
      set(els.nose, 0, pose.noseY, 0, 1, 1, 1687, 1675);
      set(els.muzzle, 0, 0, 0, pose.muzzleSX, 1, 1680, 1783);
      set(
        els.toothL,
        pose.headX * 0.3,
        toothLyS,
        0,
        toothScS,
        toothScS,
        1590,
        1980,
      );
      set(
        els.toothR,
        pose.headX * 0.3,
        toothRyS,
        0,
        toothScS,
        toothScS,
        1767,
        1980,
      );

      // eyelids
      fade(els.lidL, fxS.lidL > 0.01 ? 1 : 0);
      fade(els.lidR, fxS.lidR > 0.01 ? 1 : 0);
      set(els.lidL, 0, 0, fxS.lidRotL, 1, fxS.lidL, EYEL_CX, LID_TOP);
      set(els.lidR, 0, 0, fxS.lidRotR, 1, fxS.lidR, EYER_CX, LID_TOP);
      if (fxS.eyeSpiral > 0.01) {
        set(els.spinL, EYEL_CX, EYEL_CY, tNow * 380, 1, 1, 0, 0);
        set(els.spinR, EYER_CX, EYER_CY, tNow * 380, 1, 1, 0, 0);
      }

      // tears + sweat
      dropFx(els.tearL, pose.tear, 1105, 1500, 150);
      dropFx(els.tearR, pose.tear, 2180, 1500, 150);
      dropFx(els.sweat, pose.sweat, 2650, 830, 130);

      // floating marks
      const bob = Math.sin(tNow * Math.PI * 3);
      const pulse = 0.5 + 0.5 * Math.sin(tNow * Math.PI * 6);
      showFx(
        els.markQ,
        fxS.fxQ,
        MARK_X,
        MARK_Y + bob * 8,
        Math.sin(tNow * 2.4) * 10,
        (0.6 + 0.4 * fxS.fxQ) * 1.3,
      );
      showFx(
        els.markEx,
        fxS.fxEx,
        MARK_X,
        MARK_Y,
        0,
        (0.6 + 0.4 * fxS.fxEx) * 1.3 * (1 + 0.05 * Math.sin(tNow * 18)),
      );
      showFx(
        els.markAnger,
        fxS.fxAnger,
        MARK_X,
        MARK_Y,
        0,
        (0.6 + 0.4 * fxS.fxAnger) * 1.2 * (1 + 0.18 * pulse),
      );
      els.hearts.forEach((el, i) => {
        const ph = (tNow * 0.35 + i / 3) % 1;
        showFx(
          el,
          fxS.fxHeart * Math.min(1, ph * 5, (1 - ph) * 2.5),
          3150 + i * 130 + Math.sin(ph * 6.28 + i * 2) * 60,
          500 - ph * 850,
          Math.sin(ph * 6.28 + i) * 12,
          0.55 + 0.6 * ph,
        );
      });
      els.zzz.forEach((el, i) => {
        const ph = (tNow * 0.4 + i / 3) % 1;
        showFx(
          el,
          fxS.fxZ * Math.min(1, ph * 4, (1 - ph) * 3),
          3100 + ph * 420,
          250 - ph * 520,
          8,
          0.7 + 0.7 * ph,
        );
      });
      els.sparks.forEach((el, i) => {
        const tw = Math.max(0, 0.55 + 0.45 * Math.sin(tNow * 3.2 + i * 1.7));
        showFx(
          el,
          fxS.fxSpark,
          SPARK_POS[i][0],
          SPARK_POS[i][1],
          Math.sin(tNow * 1.5 + i) * 15,
          tw * fxS.fxSpark * 1.5,
        );
      });
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
      const q = (sel) => stage.value.querySelector(sel);
      const qa = (sel) => Array.from(stage.value.querySelectorAll(sel));
      const qe = (root, sel) => root.value.querySelector(sel);
      Object.assign(els, {
        eyeLClosed: qe(eyeL, '.eye-closed'),
        eyeRClosed: qe(eyeR, '.eye-closed'),
        eyeLHeart: qe(eyeL, '.eye-heart'),
        eyeRHeart: qe(eyeR, '.eye-heart'),
        eyeLStar: qe(eyeL, '.eye-star'),
        eyeRStar: qe(eyeR, '.eye-star'),
        eyeLSpiral: qe(eyeL, '.eye-spiral'),
        eyeRSpiral: qe(eyeR, '.eye-spiral'),
        spinL: qe(eyeL, '.eye-spiral-spin'),
        spinR: qe(eyeR, '.eye-spiral-spin'),
        lidL: q('.lid-l'),
        lidR: q('.lid-r'),
        tearL: q('.tear-l'),
        tearR: q('.tear-r'),
        sweat: q('.sweat'),
        markQ: q('.mark-q'),
        markEx: q('.mark-ex'),
        markAnger: q('.mark-anger'),
        hearts: qa('.fx-heart'),
        zzz: qa('.fx-z'),
        sparks: qa('.fx-spark'),
      });
      t0 = performance.now();
      lastNow = t0;

      const reducedMotion =
        typeof document !== 'undefined' &&
        document.documentElement?.classList.contains('prefers-reduced-motion');
      if (reducedMotion) return;

      rafId = requestAnimationFrame(frame);
    });

    onUnmounted(() => {
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
