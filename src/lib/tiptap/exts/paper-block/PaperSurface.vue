<template>
  <div
    ref="containerRef"
    class="paper-surface"
    :class="[{ focused: focused, media: media }, backgroundClass]"
    :style="{ height: `${height}px`, touchAction: 'none' }"
    data-paper-surface
    @pointerdown="onPointerDown"
    @pointermove="onPointerMove"
    @pointerup="onPointerUp"
    @pointercancel="onPointerUp"
  >
    <canvas ref="logicRef" class="ink-canvas"></canvas>
    <canvas ref="liveRef" class="ink-canvas live"></canvas>

    <div v-if="!focused && !strokes.length" class="surface-hint">{{ hint }}</div>

    <template v-if="focused && chrome">
      <div
        v-for="h in HANDLES"
        :key="h"
        class="surface-handle"
        :data-handle="h"
        @pointerdown.stop.prevent="onResizeStart($event)"
      ></div>
      <div class="surface-toolbar"><slot name="toolbar" /></div>
    </template>
  </div>
</template>

<script>
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { createInkPaper } from './inkPaper.js';
import { takePendingHandoff } from './double-tap-insert.js';
import { inkStrokeActive } from './ink/uiLock.js';

const HANDLES = ['top', 'bottom'];
const AUTO_GROW_MARGIN = 20;
const MIN_SURFACE_HEIGHT = 60;
const DOUBLE_TAP_MS = 300;

export default {
  name: 'PaperSurface',
  props: {
    strokes: { type: Array, default: () => [] },
    focused: { type: Boolean, default: false },
    tool: { type: String, default: 'pen' },
    toolSettings: { type: Object, default: () => ({}) },
    height: { type: Number, default: 210 },
    paperType: { type: String, default: 'transparent' },
    media: { type: Boolean, default: false },
    chrome: { type: Boolean, default: true },
    nodeKey: { type: String, default: '' },
    hint: { type: String, default: 'Start drawing' },
  },
  emits: ['commit', 'update-strokes', 'focus-request', 'height-change', 'resize-start', 'resize-end'],
  setup(props, { emit }) {
    const containerRef = ref(null);
    const logicRef = ref(null);
    const liveRef = ref(null);
    const width = ref(0);

    const backgroundClass = computed(() => {
      if (props.media) return '';
      return ['grid', 'ruled', 'dotted'].includes(props.paperType)
        ? props.paperType
        : '';
    });

    let ink = null; // created in onMounted once the canvas refs exist
    let dpr = 1;
    let resizeRaf = 0;
    let lastResize = { w: 0, h: 0 };

    function syncStrokes() {
      if (!ink) return;
      ink.setStrokes(props.strokes);
    }

    // Coalesce size syncs from the height watch and the ResizeObserver so a
    // resize paints once (no double clear/repaint, no blank frame).
    function syncSize() {
      if (!ink) return;
      const el = containerRef.value;
      if (!el) return;
      const w = el.clientWidth || 0;
      const h = props.height;
      if (w === lastResize.w && h === lastResize.h) return;
      lastResize = { w, h };
      width.value = w;
      dpr = (typeof window !== 'undefined' && window.devicePixelRatio) || 1;
      if (resizeRaf) cancelAnimationFrame(resizeRaf);
      resizeRaf = requestAnimationFrame(() => {
        resizeRaf = 0;
        ink.resize(w, props.height, dpr);
      });
    }

    onMounted(() => {
      ink = createInkPaper({
        container: containerRef.value,
        drawing: logicRef.value,
        live: liveRef.value,
        tool: props.tool,
        toolSettings: props.toolSettings,
        height: props.height,
        focused: props.focused,
        onCommit: (stroke) => emit('commit', stroke),
        onUpdateStrokes: (next) => emit('update-strokes', next),
        onHeightChange: (px, opts) => emit('height-change', px, opts),
        onFocusRequest: () => emit('focus-request'),
      });
      watch(ink.strokeActive, (active) => {
        inkStrokeActive.value = active; // A7: lock app chrome during a stroke
      });
      syncStrokes();
      syncSize();
      if (typeof ResizeObserver !== 'undefined' && containerRef.value) {
        const ro = new ResizeObserver(() => syncSize());
        ro.observe(containerRef.value);
        onBeforeUnmount(() => ro.disconnect());
      }
      // Handoff: the pen stroke that inserted this block keeps drawing into it.
      // Attempt on mount, and retry whenever the surface becomes ready/edited so
      // a mount-timing gap never silently drops the in-flight stroke.
      startHandoffStroke();
      watch(
        () => props.focused,
        (f) => { if (f) startHandoffStroke(); },
      );
    });

    onBeforeUnmount(() => {
      if (resizeRaf) cancelAnimationFrame(resizeRaf);
      if (ink) ink.cleanup();
      inkStrokeActive.value = false;
    });

    watch(() => props.strokes, syncStrokes);
    watch(() => props.tool, (t) => { if (ink) ink.setTool(t); });
    watch(() => props.toolSettings, (ts) => { if (ink) ink.setToolSettings(ts); }, { deep: true });
    watch(() => props.focused, (f) => { if (ink) ink.setFocused(f); });
    watch(
      () => props.height,
      (h) => { if (ink) ink.setHeight(h); syncSize(); }
    );

    // A stroke begun by the stylus insert plugin continues into this fresh
    // surface. shortcut: y-bounds only (width unknown at mount in some hosts)
    function startHandoffStroke() {
      if (!props.tool || !ink) return; // not ready yet — handoff stays pending
      const handoff = takePendingHandoff();
      if (!handoff) return;
      const rect = logicRef.value?.getBoundingClientRect() ?? null;
      // The plugin measured the text line before this node view existed; use
      // that origin when the fresh canvas still reports 0,0 during mount.
      const left = handoff.left ?? rect?.left ?? 0;
      const top = handoff.top ?? rect?.top ?? 0;
      const localX = handoff.x - left;
      const localY = handoff.y - top;
      if (localX < 0 || localY < 0 || localY > props.height) return;
      ink.onPointerDown({
        pointerType: 'pen',
        clientX: handoff.x,
        clientY: handoff.y,
        button: 0,
        preventDefault: () => {},
        currentTarget: { setPointerCapture: () => {} },
        timeStamp: performance.now(),
      });
      const move = (e) => ink.onPointerMove(e);
      const up = (e) => {
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
        ink.onPointerUp(e);
      };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
    }

    function capture(e) {
      try {
        e.currentTarget?.setPointerCapture?.(e.pointerId);
      } catch {
        /* happy-dom */
      }
    }
    function release() {}

    function onPointerDown(e) {
      // swallow text selection: the canvas is an inert surface, never a
      // text-selection start point (tap still focuses via focus-request)
      e.preventDefault?.();
      ink.onPointerDown(e);
    }

    function onPointerMove(e) {
      ink.onPointerMove(e);
    }

    function onPointerUp(e) {
      ink.onPointerUp(e);
    }

    function onResizeStart(e) {
      const edge = e.currentTarget?.dataset?.handle === 'top' ? 'top' : 'bottom';
      const resizeStart = {
        y: e.clientY,
        height: props.height,
        edge,
      };
      // let the host snapshot its scaling base (settled attrs) for the gesture
      emit('resize-start');
      capture(e);
      const move = (ev) => {
        if (!resizeStart) return;
        const delta = ev.clientY - resizeStart.y;
        const next = Math.max(
          MIN_SURFACE_HEIGHT,
          resizeStart.edge === 'top'
            ? resizeStart.height - delta
            : resizeStart.height + delta
        );
        emit('height-change', Math.round(next));
      };
      const up = () => {
        emit('resize-end');
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
      };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
    }

    return {
      containerRef,
      logicRef,
      liveRef,
      width,
      backgroundClass,
      HANDLES,
      onPointerDown,
      onPointerMove,
      onPointerUp,
      onResizeStart,
    };
  },
};
</script>

<style scoped>
.paper-surface {
  position: relative;
  width: 100%;
  background: transparent;
  overflow: visible;
  user-select: none;
  -webkit-user-select: none;
}
/* Edge resize strips: an invisible, generous drag zone carrying a short
   centered grab line — no surrounding border, Apple-notes style. */
.surface-handle {
  position: absolute;
  left: 50%;
  transform: translateX(-50%);
  width: 180px;
  max-width: 80%;
  height: 22px;
  touch-action: none;
  cursor: ns-resize;
}
.surface-handle::after {
  content: '';
  position: absolute;
  top: 50%;
  left: 50%;
  width: 56px;
  height: 4px;
  transform: translate(-50%, -50%);
  border-radius: 9999px;
  background: rgba(0, 0, 0, 0.22);
}
:global(.dark) .surface-handle::after {
  background: rgba(255, 255, 255, 0.28);
}
.surface-handle[data-handle='top'] { top: -11px; }
.surface-handle[data-handle='bottom'] { bottom: -11px; }
.surface-toolbar {
  position: absolute;
  bottom: -56px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 5;
}
.ink-canvas {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  pointer-events: none;
}
.surface-hint {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--text-tertiary, #9ca3af);
  font-size: 13px;
  pointer-events: none;
}
/* paper backgrounds (ported from DrawMode.vue) */
.paper-surface.grid {
  background-image: url('data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="0 0 40 40"%3E%3Cpath fill="none" stroke="%23D1D5DB" stroke-width="0.5" d="M40 0v40H0"/%3E%3C/svg%3E');
  background-size: 40px 40px;
}
.paper-surface.ruled {
  background-image: linear-gradient(transparent 95%, #d1d5db 5%);
  background-size: 100% 40px;
}
.paper-surface.dotted {
  background-image: radial-gradient(#d1d5db 2px, transparent 2px);
  background-size: 40px 40px;
}
:global(.dark) .paper-surface.grid {
  background-image: url('data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="0 0 40 40"%3E%3Cpath fill="none" stroke="%236B7280" stroke-width="0.5" d="M40 0v40H0"/%3E%3C/svg%3E');
}
:global(.dark) .paper-surface.ruled {
  background-image: linear-gradient(transparent 95%, #6b7280 5%);
}
:global(.dark) .paper-surface.dotted {
  background-image: radial-gradient(#6b7280 2px, transparent 2px);
}
</style>
