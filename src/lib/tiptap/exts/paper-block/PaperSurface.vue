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

    <template v-if="focused">
      <div class="surface-border" aria-hidden="true"></div>
      <div
        v-for="h in HANDLES"
        :key="h"
        class="surface-handle"
        :data-handle="h"
        @pointerdown.stop="onResizeStart($event)"
      ></div>
      <div
        class="surface-resize-bar"
        @pointerdown.stop="onResizeStart($event)"
      ></div>
      <div class="surface-toolbar"><slot name="toolbar" /></div>
    </template>
  </div>
</template>

<script>
import {
  computed,
  onBeforeUnmount,
  onMounted,
  ref,
  watch,
} from 'vue';
import {
  TOOL_DEFAULTS,
  strokeBounds,
} from './ink/stroke-model.js';
import { collectPoints, isPalm, isStylusEraser } from './ink/pointer.js';
import { strokeOutline } from './ink/smoother.js';
import { recognizeShape, shouldSnapshot } from './ink/recognizer.js';
import { InkRenderer } from './ink/renderer.js';
import {
  setScribbleSuppressed,
  clearScribbleSuppressed,
} from '@/lib/native/scribble';

const HANDLES = ['nw', 'ne', 'sw', 'se'];
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
    nodeKey: { type: String, default: '' },
    hint: { type: String, default: 'Start drawing' },
  },
  emits: ['commit', 'update-strokes', 'focus-request', 'height-change'],
  setup(props, { emit }) {
    const containerRef = ref(null);
    const logicRef = ref(null);
    const liveRef = ref(null);

    const renderer = new InkRenderer();
    let rafId = 0;
    let dpr = 1;

    // live gesture state
    let gesture = null; // { kind: 'draw'|'erase'|'lasso'|'resize', ... }
    let lastSample = null; // { x, y, t } client coords for pressure emulation
    let moveEvents = []; // for shape hold detection
    let penDownAt = -Infinity;
    let focusRequestedAt = -Infinity;
    let selectionIds = [];
    let resizeStart = null;

    const width = ref(0);

    const backgroundClass = computed(() => {
      if (props.media) return '';
      return ['grid', 'ruled', 'dotted'].includes(props.paperType)
        ? props.paperType
        : '';
    });

    function syncStrokes() {
      renderer.setStrokes(props.strokes);
    }

    function syncSize() {
      const el = containerRef.value;
      if (!el) return;
      const w = el.clientWidth || 0;
      width.value = w;
      dpr = (typeof window !== 'undefined' && window.devicePixelRatio) || 1;
      renderer.resize(w, props.height, dpr);
    }

    function loop() {
      renderer.flush();
      rafId = requestAnimationFrame(loop);
    }

    onMounted(() => {
      renderer.attach(logicRef.value, liveRef.value, {
        dpr: (typeof window !== 'undefined' && window.devicePixelRatio) || 1,
        width: containerRef.value?.clientWidth || 0,
        height: props.height,
      });
      syncStrokes();
      syncSize();
      if (typeof ResizeObserver !== 'undefined' && containerRef.value) {
        const ro = new ResizeObserver(() => syncSize());
        ro.observe(containerRef.value);
        onBeforeUnmount(() => ro.disconnect());
      }
      rafId = requestAnimationFrame(loop);
    });

    onBeforeUnmount(() => {
      cancelAnimationFrame(rafId);
      if (props.focused) clearScribbleSuppressed(`paper:${props.nodeKey}`);
    });

    watch(() => props.strokes, syncStrokes);
    watch(
      () => props.height,
      (h) => renderer.resize(width.value, h, dpr)
    );
    watch(
      () => props.focused,
      (focused) => {
        const source = `paper:${props.nodeKey}`;
        if (focused) setScribbleSuppressed(source, true);
        else clearScribbleSuppressed(source);
      }
    );

    function localPoint(e) {
      const rect = logicRef.value?.getBoundingClientRect();
      const left = rect?.left ?? 0;
      const top = rect?.top ?? 0;
      return [e.clientX - left, e.clientY - top];
    }

    function nextStrokeId() {
      return `stroke-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
    }

    function onPointerDown(e) {
      if (isPalm(e)) return;
      capture(e);

      if (!props.focused) {
        const now = performance.now();
        if (e.pointerType === 'pen') {
          if (now - penDownAt <= DOUBLE_TAP_MS && now - focusRequestedAt > DOUBLE_TAP_MS) {
            focusRequestedAt = now;
            emit('focus-request');
          }
          penDownAt = now;
        }
        // a plain tap also focuses (single or double, only one request)
        if (e.pointerType !== 'pen' && now - focusRequestedAt > DOUBLE_TAP_MS) {
          focusRequestedAt = now;
          emit('focus-request');
        }
        return;
      }

      const [x, y] = localPoint(e);
      lastSample = { x: e.clientX, y: e.clientY, t: e.timeStamp };
      moveEvents = [];

      if (props.tool === 'eraser' || isStylusEraser(e)) {
        gesture = { kind: 'erase', radius: (props.toolSettings.eraser?.size ?? 20) / 2, touched: false };
        return;
      }
      if (props.tool === 'lasso') {
        gesture = { kind: 'lasso', polygon: [[x, y]], start: [x, y] };
        return;
      }
      if (selectionIds.length) {
        gesture = { kind: 'move-selection', start: [x, y], last: [x, y] };
        return;
      }
      gesture = { kind: 'draw', tool: props.tool, points: [] };
      appendDrawPoints(e, gesture);
      paintLive();
    }

    function appendDrawPoints(e, g) {
      const pts = collectPoints(e, localPoint, lastSample);
      if (!pts.length) return;
      lastSample = { x: e.clientX, y: e.clientY, t: e.timeStamp };
      g.points.push(...pts);
    }

    function onPointerMove(e) {
      if (!gesture || isPalm(e)) return;
      const [x, y] = localPoint(e);
      if (gesture.kind === 'erase') {
        const { splitStrokes } = renderer.eraseAt(x, y, gesture.radius);
        gesture.touched = true;
        gesture.result = splitStrokes;
        renderer.setDirty({ minX: x - gesture.radius, minY: y - gesture.radius, maxX: x + gesture.radius, maxY: y + gesture.radius });
        return;
      }
      if (gesture.kind === 'lasso') {
        gesture.polygon.push([x, y]);
        return;
      }
      if (gesture.kind === 'move-selection') {
        const dx = x - gesture.last[0];
        const dy = y - gesture.last[1];
        gesture.last = [x, y];
        gesture.moved = (gesture.moved || 0) + Math.abs(dx) + Math.abs(dy);
        renderer.setStrokes(
          renderer.committed.map((s) =>
            selectionIds.includes(s.id)
              ? { ...s, points: s.points.map(([px, py, pp]) => [px + dx, py + dy, pp]) }
              : s
          )
        );
        return;
      }
      // draw
      moveEvents.push({ timeStamp: e.timeStamp, clientX: e.clientX, clientY: e.clientY });
      appendDrawPoints(e, gesture);
      paintLive();
    }

    function onPointerUp(e) {
      if (!gesture) return;
      const g = gesture;
      gesture = null;
      release(e);

      if (g.kind === 'erase') {
        if (g.touched) emit('update-strokes', [...renderer.committed]);
        return;
      }
      if (g.kind === 'lasso') {
        selectionIds = pickInsidePolygon(g.polygon);
        return;
      }
      if (g.kind === 'move-selection') {
        if (g.moved) {
          emit('update-strokes', [...renderer.committed]);
          selectionIds = [];
        }
        return;
      }
      // draw commit
      let points = g.points;
      if (shouldSnapshot(points, moveEvents)) {
        const rec = recognizeShape(points);
        if (rec) {
          return commitStroke({
            ...buildStroke(g.tool, points),
            shape: rec.shape,
            points: rec.snapped,
          });
        }
      }
      commitStroke(buildStroke(g.tool, points));
    }

    function buildStroke(tool, points) {
      const settings = props.toolSettings[tool] ?? {};
      const def = TOOL_DEFAULTS[tool] ?? {};
      return {
        id: nextStrokeId(),
        tool,
        color: settings.color ?? def.color ?? '#1a1a1a',
        size: settings.size ?? def.size ?? 4,
        opacity: settings.opacity ?? def.opacity ?? 1,
        points,
      };
    }

    function commitStroke(stroke) {
      renderer.commitStroke(stroke);
      emit('commit', stroke);
      const b = strokeBounds(stroke);
      if (b.maxY > props.height - AUTO_GROW_MARGIN) {
        emit('height-change', Math.ceil(b.maxY + AUTO_GROW_MARGIN));
      }
    }

    function paintLive() {
      if (!gesture || gesture.kind !== 'draw' || !gesture.points.length) return;
      const live = buildStroke(gesture.tool, gesture.points);
      // live preview uses the resolved outline; renderer redraws it per frame
      renderer.paintStrokeLive(live.id, live);
    }

    function pickInsidePolygon(polygon) {
      const inside = ([px, py]) => pointInPolygon(px, py, polygon);
      return renderer.committed
        .filter((s) => s.points.some(inside))
        .map((s) => s.id);
    }

    function onResizeStart(e) {
      resizeStart = {
        y: e.clientY,
        height: props.height,
        target: e.currentTarget,
      };
      capture(e);
      const move = (ev) => {
        if (!resizeStart) return;
        const next = Math.max(
          MIN_SURFACE_HEIGHT,
          resizeStart.height + (ev.clientY - resizeStart.y)
        );
        emit('height-change', Math.round(next));
      };
      const up = () => {
        resizeStart = null;
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
      };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
    }

    function capture(e) {
      try {
        e.currentTarget.setPointerCapture?.(e.pointerId);
      } catch {
        /* happy-dom */
      }
    }
    function release() {}

    return {
      containerRef,
      logicRef,
      liveRef,
      HANDLES,
      backgroundClass,
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
}
.paper-surface.focused .surface-border {
  position: absolute;
  inset: -2px;
  border: 2px dashed var(--paper-focus-color, #fbbf24);
  border-radius: 8px;
  pointer-events: none;
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
.surface-handle {
  position: absolute;
  width: 14px;
  height: 14px;
  border-radius: 50%;
  background: var(--paper-handle-bg, #fff);
  border: 1.5px solid var(--paper-handle-border, #f59e0b);
  touch-action: none;
}
.surface-handle[data-handle='nw'] { top: -7px; left: -7px; cursor: nwse-resize; }
.surface-handle[data-handle='ne'] { top: -7px; right: -7px; cursor: nesw-resize; }
.surface-handle[data-handle='sw'] { bottom: -7px; left: -7px; cursor: nesw-resize; }
.surface-handle[data-handle='se'] { bottom: -7px; right: -7px; cursor: nwse-resize; }
.surface-resize-bar {
  position: absolute;
  bottom: -10px;
  left: 50%;
  transform: translateX(-50%);
  width: 48px;
  height: 14px;
  border-radius: 7px;
  background: var(--paper-handle-bg, #fff);
  border: 1.5px solid var(--paper-handle-border, #f59e0b);
  touch-action: none;
}
.surface-toolbar {
  position: absolute;
  bottom: -56px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 5;
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
