<template>
  <div
    class="draw"
    :class="{ 'pointer-events-none': !interactive }"
    @keydown="handleKeyDown"
    tabindex="-1"
  >
    <!-- SVG canvas -->
    <div
      class="drawing-container relative w-full select-none"
      :style="{ height: `${state.height}px` }"
    >
      <svg
        ref="svgRef"
        class="w-full h-full block"
        :class="[backgroundClass]"
        :viewBox="`0 0 ${SVG_WIDTH} ${state.height}`"
        preserveAspectRatio="none"
        style="touch-action: none;"
        @pointerdown="handlePointerDown"
        @pointermove="handlePointerMove"
        @pointerup="handlePointerUp"
        @pointerleave="handlePointerLeave"
        @pointercancel="handlePointerCancel"
      >
        <!-- Committed strokes -->
        <path
          v-for="stroke in state.lines"
          :key="stroke.id"
          :d="pathFor(stroke)"
          :fill="propsFor(stroke).fill"
          stroke="none"
          :opacity="propsFor(stroke).opacity"
        />

        <!-- Live stroke preview -->
        <path
          v-if="livePathD"
          :d="livePathD"
          :fill="liveProps.fill"
          stroke="none"
          :opacity="liveProps.opacity"
        />

        <!-- Eraser cursor ring -->
        <circle
          v-if="state.tool === 'eraser' && eraserPos"
          :cx="eraserPos[0]"
          :cy="eraserPos[1]"
          :r="state.eraserSettings.size / 2"
          fill="none"
          stroke="rgba(100,100,100,0.6)"
          stroke-width="1"
          stroke-dasharray="3 2"
        />

        <!-- Rect-selection rubber band -->
        <rect
          v-if="state.selectionBox"
          :x="Math.min(state.selectionBox.startX, state.selectionBox.currentX)"
          :y="Math.min(state.selectionBox.startY, state.selectionBox.currentY)"
          :width="Math.abs(state.selectionBox.currentX - state.selectionBox.startX)"
          :height="Math.abs(state.selectionBox.currentY - state.selectionBox.startY)"
          fill="rgba(99,102,241,0.08)"
          stroke="rgba(99,102,241,0.7)"
          stroke-width="1"
          stroke-dasharray="4 3"
        />

        <!-- Lasso outline -->
        <polyline
          v-if="state.lassoPoints && state.lassoPoints.length > 1"
          :points="state.lassoPoints.map((p) => p.join(',')).join(' ')"
          fill="rgba(99,102,241,0.08)"
          stroke="rgba(99,102,241,0.7)"
          stroke-width="1"
          stroke-dasharray="4 3"
          stroke-linejoin="round"
        />

        <!-- Selection bounding box + handles -->
        <g v-if="state.selectedElement">
          <!-- Rotation transform wrapper -->
          <g
            :transform="selectionTransform"
          >
            <rect
              :x="state.selectedElement.bounds.x - 4"
              :y="state.selectedElement.bounds.y - 4"
              :width="state.selectedElement.bounds.width + 8"
              :height="state.selectedElement.bounds.height + 8"
              fill="none"
              stroke="rgba(99,102,241,0.8)"
              stroke-width="1.5"
              stroke-dasharray="5 4"
              rx="2"
            />

            <!-- Corner resize handles -->
            <circle
              v-for="h in cornerHandles"
              :key="h.corner"
              :cx="h.x"
              :cy="h.y"
              r="5"
              fill="white"
              stroke="rgba(99,102,241,0.9)"
              stroke-width="1.5"
              :style="{ cursor: h.cursor }"
              @pointerdown.stop="(e) => handleTransformStart(e, h.corner)"
            />

            <!-- Rotation handle (above top-centre) -->
            <line
              :x1="state.selectedElement.bounds.x + state.selectedElement.bounds.width / 2"
              :y1="state.selectedElement.bounds.y - 4"
              :x2="state.selectedElement.bounds.x + state.selectedElement.bounds.width / 2"
              :y2="state.selectedElement.bounds.y - 22"
              stroke="rgba(99,102,241,0.7)"
              stroke-width="1.5"
            />
            <circle
              :cx="state.selectedElement.bounds.x + state.selectedElement.bounds.width / 2"
              :cy="state.selectedElement.bounds.y - 26"
              r="6"
              fill="white"
              stroke="rgba(99,102,241,0.9)"
              stroke-width="1.5"
              style="cursor: grab;"
              @pointerdown.stop="(e) => handleTransformStart(e, 'rotate')"
            />
          </g>
        </g>
      </svg>

      <!-- Resize handle (bottom edge drag) -->
      <div
        v-if="interactive"
        class="resize-handle absolute bottom-0 left-0 right-0 h-3 flex items-center justify-center cursor-row-resize select-none z-10"
        @pointerdown.prevent="startResize"
      >
        <div class="w-8 h-1 rounded-full bg-neutral-300 dark:bg-neutral-600" />
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, reactive, computed, onMounted, onUnmounted, watch } from 'vue';
import {
  cloneDrawingToolDefaults,
  getRenderablePath,
  getRenderableStrokeProps,
  migrateStrokes,
} from './helpers/drawHelper.js';
import { usePointerHelper } from './helpers/pointerHelper.js';
import useSelectionHelper from './helpers/selectionHelper.js';
import useTransformHelper from './helpers/transformHelper.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SVG_WIDTH = 500;
const MIN_HEIGHT = 200;
const MAX_HEIGHT = 4000;

// ---------------------------------------------------------------------------
// Props / emits
// ---------------------------------------------------------------------------

const props = defineProps({
  node: { type: Object, required: true },
  interactive: { type: Boolean, default: true },
});

const emit = defineEmits(['update-attributes', 'toolbar-state']);

// ---------------------------------------------------------------------------
// Refs
// ---------------------------------------------------------------------------

const svgRef = ref(null);
const currentPointsRef = ref([]);
const animationFrameRef = ref(null);

// ---------------------------------------------------------------------------
// Initial state
// ---------------------------------------------------------------------------

function loadStrokes(attrs) {
  // If linesV2 exists and has content, use it (already new format).
  // Otherwise migrate from legacy lines / linesV2.
  if (Array.isArray(attrs.linesV2) && attrs.linesV2.length > 0) {
    return attrs.linesV2.map((l, i) => ({
      ...l,
      id: l.id ?? `s${i}`,
      points: (l.points ?? []).map((p) => (p.length >= 3 ? p : [p[0], p[1], 0.5])),
    }));
  }
  return migrateStrokes(attrs.lines, attrs.linesV2);
}

const defaultSettings = cloneDrawingToolDefaults();

const state = reactive({
  lines:               loadStrokes(props.node.attrs),
  isDrawing:           false,
  tool:                'pen',
  penSettings:         { ...defaultSettings.pen },
  highlighterSettings: { ...defaultSettings.highlighter },
  eraserSettings:      { ...defaultSettings.eraser },
  undoStack:           [],
  redoStack:           [],
  height:              props.node.attrs.height ?? 400,
  background:          props.node.attrs.paperType ?? 'plain',
  nextLineId:          0,
  selectedElement:     null,
  transformState:      null,
  selectionBox:        null,
  lassoPoints:         null,
  currentStrokePoints: [],
});

// ---------------------------------------------------------------------------
// Background CSS
// ---------------------------------------------------------------------------

// The SCSS in paper.scss applies grid/ruled/dotted patterns via these class names.
// We apply them directly on the SVG element (same as the original DrawMode did).
const backgroundClass = computed(() => {
  const base = 'bg-neutral-100 dark:bg-neutral-800';
  const bg = state.background;
  if (bg === 'grid' || bg === 'ruled' || bg === 'dotted') return `${base} ${bg}`;
  return base; // plain
});

// ---------------------------------------------------------------------------
// Rendering helpers
// ---------------------------------------------------------------------------

const pathCache = new WeakMap();

function pathFor(stroke) {
  if (pathCache.has(stroke)) return pathCache.get(stroke);
  const d = getRenderablePath(stroke);
  pathCache.set(stroke, d);
  return d;
}

function propsFor(stroke) {
  return getRenderableStrokeProps(stroke);
}

// Live preview
const livePathD = computed(() => {
  const pts = state.currentStrokePoints;
  if (!pts || pts.length < 2) return null;
  if (state.tool === 'eraser') return null;
  const settings = activeSettings();
  return getRenderablePath({ tool: state.tool, size: settings.size, opacity: settings.opacity, color: settings.color, points: pts });
});

const liveProps = computed(() => {
  const settings = activeSettings();
  return getRenderableStrokeProps({ tool: state.tool, color: settings.color, opacity: settings.opacity });
});

const eraserPos = ref(null);

// ---------------------------------------------------------------------------
// Selection transform (rotation)
// ---------------------------------------------------------------------------

const selectionTransform = computed(() => {
  const el = state.selectedElement;
  if (!el || !el.rotation) return '';
  const cx = el.bounds.x + el.bounds.width  / 2;
  const cy = el.bounds.y + el.bounds.height / 2;
  return `rotate(${el.rotation}, ${cx}, ${cy})`;
});

// ---------------------------------------------------------------------------
// Corner handles
// ---------------------------------------------------------------------------

const cornerHandles = computed(() => {
  const b = state.selectedElement?.bounds;
  if (!b) return [];
  return [
    { corner: 'nw', x: b.x,           y: b.y,            cursor: 'nw-resize' },
    { corner: 'ne', x: b.x + b.width, y: b.y,            cursor: 'ne-resize' },
    { corner: 'sw', x: b.x,           y: b.y + b.height, cursor: 'sw-resize' },
    { corner: 'se', x: b.x + b.width, y: b.y + b.height, cursor: 'se-resize' },
  ];
});

// ---------------------------------------------------------------------------
// Settings accessor
// ---------------------------------------------------------------------------

function activeSettings() {
  if (state.tool === 'highlighter') return state.highlighterSettings;
  if (state.tool === 'eraser')      return state.eraserSettings;
  return state.penSettings;
}

const isPointInsideSelection = (x, y) => {
  const el = state.selectedElement;
  if (!el) return false;
  const { bounds } = el;
  return x >= bounds.x && x <= bounds.x + bounds.width
      && y >= bounds.y && y <= bounds.y + bounds.height;
};

// ---------------------------------------------------------------------------
// Transform / selection helpers
// ---------------------------------------------------------------------------

const { handleTransformStart, handleTransformMove, handleTransformEnd } =
  useTransformHelper(state, svgRef);

const { handleSelectionStart, handleSelectionMove, handleSelectionEnd } =
  useSelectionHelper(state, svgRef, isPointInsideSelection, handleTransformStart);

// ---------------------------------------------------------------------------
// Pointer helper
// ---------------------------------------------------------------------------

const {
  handlePointerDown: _pointerDown,
  handlePointerMove: _pointerMove,
  handlePointerUp:   _pointerUp,
  handlePointerLeave,
  handlePointerCancel,
  captureUndoBeforeErase,
} = usePointerHelper({
  state,
  svgRef,
  currentPointsRef,
  animationFrameRef,
  getSettings: activeSettings,
  handleSelectionStart,
  handleSelectionMove,
  handleSelectionEnd,
  handleTransformMove,
  handleTransformEnd,
});

// Wrap events to add eraser-specific behaviour
function handlePointerDown(e) {
  if (state.tool === 'eraser') {
    captureUndoBeforeErase();
  } else {
    eraserPos.value = null;
  }
  _pointerDown(e);
}

function handlePointerMove(e) {
  if (state.tool === 'eraser') {
    // Inline coord conversion — svgRef is already a plain element ref here
    const svg = svgRef.value;
    if (svg) {
      const pt = svg.createSVGPoint();
      pt.x = e.clientX; pt.y = e.clientY;
      const ctm = svg.getScreenCTM();
      if (ctm) {
        const loc = pt.matrixTransform(ctm.inverse());
        eraserPos.value = [loc.x, loc.y];
      }
    }
  }
  _pointerMove(e);
}

function handlePointerUp(e) {
  _pointerUp(e);
}

// ---------------------------------------------------------------------------
// Keyboard: Delete selected / Undo / Redo
// ---------------------------------------------------------------------------

function handleKeyDown(e) {
  const mod = e.metaKey || e.ctrlKey;

  if ((e.key === 'Delete' || e.key === 'Backspace') && state.selectedElement) {
    e.preventDefault();
    const ids = new Set(state.selectedElement.lineIds);
    state.undoStack = [...state.undoStack, state.lines];
    state.redoStack = [];
    state.lines = state.lines.filter((l) => !ids.has(l.id));
    state.selectedElement = null;
    return;
  }

  if (mod && e.key.toLowerCase() === 'z') {
    e.preventDefault();
    if (e.shiftKey) handleRedo();
    else            handleUndo();
  }
};

// ---------------------------------------------------------------------------
// Undo / redo
// ---------------------------------------------------------------------------

function handleUndo() {
  if (!state.undoStack.length) return;
  state.redoStack = [...state.redoStack, state.lines];
  state.lines     = state.undoStack[state.undoStack.length - 1];
  state.undoStack = state.undoStack.slice(0, -1);
  state.selectedElement = null;
}

function handleRedo() {
  if (!state.redoStack.length) return;
  state.undoStack = [...state.undoStack, state.lines];
  state.lines     = state.redoStack[state.redoStack.length - 1];
  state.redoStack = state.redoStack.slice(0, -1);
  state.selectedElement = null;
}

// ---------------------------------------------------------------------------
// Tool / color / size setters (called from Paper.vue)
// ---------------------------------------------------------------------------

function setTool(tool) {
  state.tool = tool;
  state.selectedElement = null;
  state.selectionBox = null;
  state.lassoPoints = null;
  state.transformState = null;
}

function setColor(color) {
  if (state.tool === 'pen')         { state.penSettings.color = color; return; }
  if (state.tool === 'highlighter') { state.highlighterSettings.color = color; }
}

function setSize(size) {
  const n = Number(size);
  if (state.tool === 'pen')         { state.penSettings.size = n; return; }
  if (state.tool === 'highlighter') { state.highlighterSettings.size = n; return; }
  if (state.tool === 'eraser')      { state.eraserSettings.size = n; }
}

function setBackground(type) {
  state.background = type;
  emit('update-attributes', { paperType: type });
}

function clearAll() {
  if (!state.lines.length) return;
  state.undoStack = [...state.undoStack, state.lines];
  state.redoStack = [];
  state.lines = [];
  state.selectedElement = null;
}

// ---------------------------------------------------------------------------
// Resize handle (bottom-drag)
// ---------------------------------------------------------------------------

function startResize(e) {
  e.preventDefault();
  const startY  = e.clientY;
  const startH  = state.height;

  function onMove(mv) {
    const newH = Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT, startH + mv.clientY - startY));
    state.height = newH;
  }

  function onUp() {
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup',   onUp);
    emit('update-attributes', { height: state.height });
  }

  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup',   onUp);
}

// ---------------------------------------------------------------------------
// SVG export (called from Paper.vue)
// ---------------------------------------------------------------------------

function exportSVG() {
  const { width, height, lines, background } = state;
  const xmlns = 'http://www.w3.org/2000/svg';

  let bgFill = '#f5f5f5';
  if (background === 'dark' || background?.includes('dark')) bgFill = '#1e1e1e';

  const paths = lines.map((stroke) => {
    const d = getRenderablePath(stroke);
    const p = getRenderableStrokeProps(stroke);
    if (!d) return '';
    return `<path d="${d}" fill="${p.fill}" stroke="none" opacity="${p.opacity}" />`;
  }).join('\n  ');

  return `<svg xmlns="${xmlns}" viewBox="0 0 ${SVG_WIDTH} ${height}" width="${width}" height="${height}">
  <rect width="${SVG_WIDTH}" height="${height}" fill="${bgFill}" />
  ${paths}
</svg>`;
}

function exportPNG(scale = 2) {
  return new Promise((resolve) => {
    const svgStr = exportSVG();
    const blob   = new Blob([svgStr], { type: 'image/svg+xml' });
    const url    = URL.createObjectURL(blob);
    const img    = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width  = SVG_WIDTH * scale;
      canvas.height = state.height * scale;
      const ctx = canvas.getContext('2d');
      ctx.scale(scale, scale);
      ctx.drawImage(img, 0, 0);
      URL.revokeObjectURL(url);
      canvas.toBlob((b) => resolve(b), 'image/png');
    };
    img.src = url;
  });
}

// ---------------------------------------------------------------------------
// Exposed methods
// ---------------------------------------------------------------------------

function deleteSelection() {
  if (!state.selectedElement) return;
  const ids = new Set(state.selectedElement.lineIds);
  state.undoStack = [...state.undoStack, state.lines];
  state.redoStack = [];
  state.lines = state.lines.filter((l) => !ids.has(l.id));
  state.selectedElement = null;
}

defineExpose({
  setTool,
  setColor,
  setSize,
  setBackground,
  clearAll,
  deleteSelection,
  undo:   handleUndo,
  redo:   handleRedo,
  exportSVG,
  exportPNG,
  state,   // read-only access for toolbar-state watch in Paper.vue
});

// ---------------------------------------------------------------------------
// Sync node attrs → state (remote/undo changes from ProseMirror)
// ---------------------------------------------------------------------------

let _ignoreNextAttrWatch = false;

watch(
  () => props.node.attrs,
  (attrs) => {
    if (_ignoreNextAttrWatch) { _ignoreNextAttrWatch = false; return; }
    state.lines      = loadStrokes(attrs);
    state.height     = attrs.height  ?? 400;
    state.background = attrs.paperType ?? 'plain';
  },
  { deep: true }
);

// Emit state changes upward
watch(
  () => [state.lines, state.height],
  () => {
    _ignoreNextAttrWatch = true;
    emit('update-attributes', {
      linesV2: state.lines,
      height:  state.height,
      // Keep lines for read-only HTML export until html-helper is updated
      lines:   state.lines,
    });
  },
  { deep: true }
);

// Toolbar state for Paper.vue
watch(
  () => ({
    tool:                state.tool,
    penSettings:         { ...state.penSettings },
    highlighterSettings: { ...state.highlighterSettings },
    eraserSettings:      { ...state.eraserSettings },
    undoDepth:           state.undoStack.length,
    redoDepth:           state.redoStack.length,
    background:          state.background,
    hasSelection:        !!state.selectedElement,
  }),
  (ts) => emit('toolbar-state', ts),
  { deep: true, immediate: true }
);

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

onMounted(() => {
  const svg = svgRef.value;
  if (!svg) return;

  const preventScroll = (e) => {
    if (e.touches?.length > 1) return;
    e.preventDefault();
  };

  svg.addEventListener('touchstart', preventScroll, { passive: false });
  svg.addEventListener('touchmove',  preventScroll, { passive: false });
});

onUnmounted(() => {
  if (animationFrameRef.value) cancelAnimationFrame(animationFrameRef.value);
});
</script>

<style scoped>
.draw {
  position: relative;
  touch-action: none;
  outline: none;
}

.resize-handle {
  opacity: 0;
  transition: opacity 0.15s;
}

.draw:hover .resize-handle {
  opacity: 1;
}
</style>
