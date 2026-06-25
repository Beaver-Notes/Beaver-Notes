<template>
  <div
    class="draw"
    :class="{ 'pointer-events-none': !interactive }"
    tabindex="-1"
    @keydown="handleKeyDown"
    @keyup="handleKeyUp"
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
        :viewBox="`0 0 ${svgWidth} ${state.height}`"
        style="touch-action: none; -webkit-user-modify: read-only"
        @pointerdown="handlePointerDown"
        @pointermove="handlePointerMove"
        @pointerup="handlePointerUp"
        @pointerleave="handlePointerLeave"
        @pointercancel="handlePointerCancel"
        @touchstart.prevent="onTouchStart"
        @beforeinput.prevent
        @gesturestart.prevent
      >
        <defs>
          <filter id="pencilTexture" x="-5%" y="-5%" width="110%" height="110%">
            <feTurbulence
              type="fractalNoise"
              baseFrequency="0.5"
              numOctaves="5"
              stitchTiles="stitch"
              result="f1"
            />
            <feColorMatrix
              type="matrix"
              values="0 0 0 0 0, 0 0 0 0 0, 0 0 0 0 0, 0 0 0 -1.5 1.5"
              result="f2"
            />
            <feComposite
              operator="in"
              in2="f2"
              in="SourceGraphic"
              result="f3"
            />
            <feTurbulence
              type="fractalNoise"
              baseFrequency="1.2"
              numOctaves="3"
              result="noise"
            />
            <feDisplacementMap
              xChannelSelector="R"
              yChannelSelector="G"
              scale="2.5"
              in="f3"
              in2="noise"
              result="f4"
            />
          </filter>
        </defs>

        <!-- Committed strokes -->
        <path
          v-for="stroke in state.lines"
          :key="stroke.id"
          :d="pathFor(stroke)"
          :fill="propsFor(stroke).fill"
          :filter="strokeToolFilter(stroke.tool)"
          stroke="none"
          shape-rendering="geometricPrecision"
          :opacity="propsFor(stroke).opacity"
        />

        <!-- Live stroke preview (drawn while still in progress) -->
        <path
          v-if="livePathD"
          :d="livePathD"
          :filter="liveToolFilter"
          :fill="liveProps.fill"
          stroke="none"
          shape-rendering="geometricPrecision"
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

        <!-- Embedded images -->
        <image
          v-for="img in state.images"
          :key="img.id"
          :href="img.src"
          :x="img.x"
          :y="img.y"
          :width="img.width"
          :height="img.height"
          style="pointer-events: none"
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
          <g :transform="selectionTransform">
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
              :x1="
                state.selectedElement.bounds.x +
                state.selectedElement.bounds.width / 2
              "
              :y1="state.selectedElement.bounds.y - 4"
              :x2="
                state.selectedElement.bounds.x +
                state.selectedElement.bounds.width / 2
              "
              :y2="state.selectedElement.bounds.y - 22"
              stroke="rgba(99,102,241,0.7)"
              stroke-width="1.5"
            />
            <circle
              :cx="
                state.selectedElement.bounds.x +
                state.selectedElement.bounds.width / 2
              "
              :cy="state.selectedElement.bounds.y - 26"
              r="6"
              fill="white"
              stroke="rgba(99,102,241,0.9)"
              stroke-width="1.5"
              style="cursor: grab"
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
import {
  ref,
  reactive,
  computed,
  onMounted,
  onUnmounted,
  watch,
  nextTick,
} from 'vue';
import {
  cloneDrawingToolDefaults,
  getRenderablePath,
  getRenderableStrokeProps,
  getCoalescedEvents,
  migrateStrokes,
  isPen,
} from './helpers/drawHelper.js';
import { usePointerHelper } from './helpers/pointerHelper.js';
import useSelectionHelper from './helpers/selectionHelper.js';
import useTransformHelper from './helpers/transformHelper.js';
import { openDialog } from '@/lib/native/dialog';
import mime from 'mime';
import copyImage from '@/utils/assets/storage.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_SVG_WIDTH = 500;
const MIN_HEIGHT = 200;
const MAX_HEIGHT = 8000;

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
const svgWidth = ref(DEFAULT_SVG_WIDTH);

// ---------------------------------------------------------------------------
// Initial state
// ---------------------------------------------------------------------------

function loadStrokes(attrs) {
  if (Array.isArray(attrs.linesV2) && attrs.linesV2.length > 0) {
    return attrs.linesV2.map((l, i) => ({
      ...l,
      id: l.id ?? `s${i}`,
      points: (l.points ?? []).map((p) =>
        p.length >= 3 ? p : [p[0], p[1], 0.5]
      ),
    }));
  }
  return migrateStrokes(attrs.lines, attrs.linesV2);
}

const defaultSettings = cloneDrawingToolDefaults();

const state = reactive({
  // Strokes
  lines: loadStrokes(props.node.attrs),
  isDrawing: false,
  currentStrokePoints: [],

  // Tools
  tool: 'pen',
  penSettings: { ...defaultSettings.pen },
  pencilSettings: { color: '#4a4a4a', size: 3 },
  fountainSettings: { color: '#1a2744', size: 5 },
  highlighterSettings: { ...defaultSettings.highlighter },
  eraserSettings: { ...defaultSettings.eraser },

  // Undo/redo
  undoStack: [],
  redoStack: [],
  nextLineId: 0,

  // Canvas
  height: props.node.attrs.height ?? 400,
  background: props.node.attrs.paperType ?? 'plain',

  // Selection
  selectedElement: null,
  transformState: null,
  selectionBox: null,
  lassoPoints: null,

  // ── NEW: tldraw-style pen mode ──
  isPenMode: false,
  _preEraserTool: null, // restore tool after stylus eraser
  _shiftHeld: false, // for straight-line segments

  // Embedded images
  images: [],
});

// ---------------------------------------------------------------------------
// Background CSS
// ---------------------------------------------------------------------------

const backgroundClass = computed(() => {
  const base = 'bg-transparent border rounded-lg';
  const bg = state.background;
  if (bg === 'grid' || bg === 'ruled' || bg === 'dotted')
    return `${base} ${bg}`;
  return base;
});

// ---------------------------------------------------------------------------
// Rendering helpers
// ---------------------------------------------------------------------------

const pathCache = new WeakMap();

function pathFor(stroke) {
  if (pathCache.has(stroke)) return pathCache.get(stroke);
  const d = getRenderablePath(stroke, true);
  pathCache.set(stroke, d);
  return d;
}

function propsFor(stroke) {
  return getRenderableStrokeProps(stroke);
}

const TOOL_FILTER = {
  pencil: 'url(#pencilTexture)',
};
function strokeToolFilter(tool) {
  return TOOL_FILTER[tool] || 'none';
}

const liveToolFilter = computed(() => strokeToolFilter(state.tool));

// Live preview (rendered identically to committed strokes — no taper jump)
const livePathD = computed(() => {
  const pts = state.currentStrokePoints;
  if (!pts || pts.length < 2) return null;
  if (state.tool === 'eraser') return null;
  const settings = activeSettings();
  return getRenderablePath({
    tool: state.tool,
    size: settings.size,
    opacity: settings.opacity,
    color: settings.color,
    points: pts,
  });
});

const liveProps = computed(() => {
  const settings = activeSettings();
  return getRenderableStrokeProps({
    tool: state.tool,
    color: settings.color,
    opacity: settings.opacity,
  });
});

const eraserPos = ref(null);

// ---------------------------------------------------------------------------
// Selection transform (rotation)
// ---------------------------------------------------------------------------

const selectionTransform = computed(() => {
  const el = state.selectedElement;
  if (!el || !el.rotation) return '';
  const cx = el.bounds.x + el.bounds.width / 2;
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
    { corner: 'nw', x: b.x, y: b.y, cursor: 'nw-resize' },
    { corner: 'ne', x: b.x + b.width, y: b.y, cursor: 'ne-resize' },
    { corner: 'sw', x: b.x, y: b.y + b.height, cursor: 'sw-resize' },
    { corner: 'se', x: b.x + b.width, y: b.y + b.height, cursor: 'se-resize' },
  ];
});

// ---------------------------------------------------------------------------
// Settings accessor
// ---------------------------------------------------------------------------

function activeSettings() {
  if (state.tool === 'highlighter') return state.highlighterSettings;
  if (state.tool === 'pencil') return state.pencilSettings;
  if (state.tool === 'fountain') return state.fountainSettings;
  if (state.tool === 'eraser') return state.eraserSettings;
  return state.penSettings;
}

// ---------------------------------------------------------------------------
// Auto-grow callback (called by pointerHelper when drawing near bottom edge)
// ---------------------------------------------------------------------------

function autoGrow(amount) {
  const newH = Math.min(MAX_HEIGHT, state.height + amount);
  if (newH !== state.height) {
    state.height = newH;
  }
}

// ---------------------------------------------------------------------------
// Transform / selection helpers
// ---------------------------------------------------------------------------

const { handleTransformStart, handleTransformMove, handleTransformEnd } =
  useTransformHelper(state, svgRef);

const isPointInsideSelection = (x, y) => {
  const el = state.selectedElement;
  if (!el) return false;
  const { bounds } = el;
  return (
    x >= bounds.x &&
    x <= bounds.x + bounds.width &&
    y >= bounds.y &&
    y <= bounds.y + bounds.height
  );
};

const { handleSelectionStart, handleSelectionMove, handleSelectionEnd } =
  useSelectionHelper(
    state,
    svgRef,
    isPointInsideSelection,
    handleTransformStart
  );

// ---------------------------------------------------------------------------
// Pointer helper (state-machine based)
// ---------------------------------------------------------------------------

const {
  handlePointerDown: _pointerDown,
  handlePointerMove: _pointerMove,
  handlePointerUp: _pointerUp,
  handlePointerLeave,
  handlePointerCancel,
  captureUndoBeforeErase,
  setShiftHeld,
} = usePointerHelper({
  state,
  svgRef,
  currentPointsRef,
  animationFrameRef,
  getSettings: activeSettings,
  handleSelectionStart,
  handleSelectionMove,
  handleSelectionEnd,
  handleTransformStart,
  handleTransformMove,
  handleTransformEnd,
  autoGrow,
});

// Wrap events to add eraser-specific behaviour
function handlePointerDown(e) {
  if (state.tool === 'eraser') {
    captureUndoBeforeErase(state);
  } else {
    eraserPos.value = null;
  }
  _pointerDown(e);
}

function handlePointerMove(e) {
  // Update eraser cursor position
  if (state.tool === 'eraser') {
    const svg = svgRef.value;
    if (svg) {
      const pt = svg.createSVGPoint();
      pt.x = e.clientX;
      pt.y = e.clientY;
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

function onTouchStart(e) {
  // Prevent scroll on touch devices while drawing
  // Also handle Pencil double-tap zoom prevention
  if (e.touches?.length > 1) return;
  e.preventDefault();
}

// ---------------------------------------------------------------------------
// Pen mode exit (from tldraw)
// ---------------------------------------------------------------------------

function exitPenMode() {
  state.isPenMode = false;
}

// ---------------------------------------------------------------------------
// Keyboard: Shift for straight lines, Delete, Undo, Redo
// ---------------------------------------------------------------------------

function handleKeyDown(e) {
  const mod = e.metaKey || e.ctrlKey;

  // Shift key for straight-line segments
  if (e.key === 'Shift' && !e.repeat) {
    setShiftHeld(true);
    return;
  }

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
    else handleUndo();
  }
}

function handleKeyUp(e) {
  if (e.key === 'Shift') {
    setShiftHeld(false);
  }
}

// ---------------------------------------------------------------------------
// Undo / redo
// ---------------------------------------------------------------------------

function undo() {
  if (!state.undoStack.length) return;
  state.redoStack = [...state.redoStack, state.lines];
  state.lines = state.undoStack[state.undoStack.length - 1];
  state.undoStack = state.undoStack.slice(0, -1);
  state.selectedElement = null;
}

function redo() {
  if (!state.redoStack.length) return;
  state.undoStack = [...state.undoStack, state.lines];
  state.lines = state.redoStack[state.redoStack.length - 1];
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
  if (state.tool === 'pen') {
    state.penSettings.color = color;
    return;
  }
  if (state.tool === 'pencil') {
    state.pencilSettings.color = color;
    return;
  }
  if (state.tool === 'fountain') {
    state.fountainSettings.color = color;
    return;
  }
  if (state.tool === 'highlighter') {
    state.highlighterSettings.color = color;
  }
}

function setSize(size) {
  const n = Number(size);
  if (state.tool === 'pen') {
    state.penSettings.size = n;
    return;
  }
  if (state.tool === 'pencil') {
    state.pencilSettings.size = n;
    return;
  }
  if (state.tool === 'fountain') {
    state.fountainSettings.size = n;
    return;
  }
  if (state.tool === 'highlighter') {
    state.highlighterSettings.size = n;
    return;
  }
  if (state.tool === 'eraser') {
    state.eraserSettings.size = n;
  }
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
  const startY = e.clientY;
  const startH = state.height;

  function onMove(mv) {
    const newH = Math.min(
      MAX_HEIGHT,
      Math.max(MIN_HEIGHT, startH + mv.clientY - startY)
    );
    state.height = newH;
  }

  function onUp() {
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    emit('update-attributes', { height: state.height });
  }

  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);
}

// ---------------------------------------------------------------------------
// SVG export
// ---------------------------------------------------------------------------

function exportSVG() {
  const { lines, background } = state;
  const xmlns = 'http://www.w3.org/2000/svg';
  const height = state.height;

  let bgFill = '#f5f5f5';
  if (background === 'dark' || background?.includes('dark')) bgFill = '#1e1e1e';

  const paths = lines
    .map((stroke) => {
      const d = getRenderablePath(stroke, true);
      const p = getRenderableStrokeProps(stroke);
      if (!d) return '';
      return `<path d="${d}" fill="${p.fill}" stroke="none" opacity="${p.opacity}" />`;
    })
    .join('\n  ');

  return `<svg xmlns="${xmlns}" viewBox="0 0 ${svgWidth.value} ${height}" width="${svgWidth.value}" height="${height}">
  <rect width="${svgWidth.value}" height="${height}" fill="${bgFill}" />
  ${paths}
</svg>`;
}

function exportPNG(scale = 2) {
  return new Promise((resolve) => {
    const svgStr = exportSVG();
    const blob = new Blob([svgStr], {
      type: mime.getType('svg') || 'image/svg+xml',
    });
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = svgWidth.value * scale;
      canvas.height = state.height * scale;
      const ctx = canvas.getContext('2d');
      ctx.scale(scale, scale);
      ctx.drawImage(img, 0, 0);
      URL.revokeObjectURL(url);
      canvas.toBlob((b) => resolve(b), mime.getType('png') || 'image/png');
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

async function insertImage(noteId) {
  try {
    const { canceled, filePaths = [] } = await openDialog({
      properties: ['openFile', 'multiSelections'],
      filters: [
        {
          name: 'Images',
          extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'],
        },
      ],
    });
    if (canceled || !filePaths.length) return;

    for (const filePath of filePaths) {
      const { fileName } = await copyImage(filePath, noteId, Date.now());
      const src = `assets://${noteId}/${fileName}`;
      const cx = svgWidth.value / 2 - 75;
      const cy = state.height / 2 - 75;
      state.images.push({
        id: `img_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        src,
        x: Math.max(0, cx),
        y: Math.max(0, cy),
        width: 150,
        height: 150,
      });
    }
  } catch (e) {
    console.error('Failed to insert image:', e);
  }
}

defineExpose({
  setTool,
  setColor,
  setSize,
  setBackground,
  clearAll,
  deleteSelection,
  undo,
  redo,
  exportSVG,
  exportPNG,
  exitPenMode,
  insertImage,
  state,
});

// ---------------------------------------------------------------------------
// Sync node attrs → state (remote/undo changes from ProseMirror)
// ---------------------------------------------------------------------------

let _ignoreNextAttrWatch = false;

watch(
  () => props.node.attrs,
  (attrs) => {
    if (_ignoreNextAttrWatch) {
      _ignoreNextAttrWatch = false;
      return;
    }
    state.lines = loadStrokes(attrs);
    state.height = attrs.height ?? 400;
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
      height: state.height,
      lines: state.lines, // keep for HTML export compat
    });
  },
  { deep: true }
);

// Toolbar state for Paper.vue
watch(
  () => ({
    tool: state.tool,
    penSettings: { ...state.penSettings },
    pencilSettings: { ...state.pencilSettings },
    fountainSettings: { ...state.fountainSettings },
    highlighterSettings: { ...state.highlighterSettings },
    eraserSettings: { ...state.eraserSettings },
    undoDepth: state.undoStack.length,
    redoDepth: state.redoStack.length,
    background: state.background,
    hasSelection: !!state.selectedElement,
    isPenMode: state.isPenMode,
  }),
  (ts) => emit('toolbar-state', ts),
  { deep: true, immediate: true }
);

// ---------------------------------------------------------------------------
// Lifecycle — register keyboard listener on document for Shift key
// ---------------------------------------------------------------------------

onMounted(() => {
  const svg = svgRef.value;
  if (!svg) return;

  // Track container width so the viewBox matches — no stretching
  const container = svg.parentElement;
  if (container) {
    svgWidth.value = container.clientWidth || DEFAULT_SVG_WIDTH;
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        svgWidth.value = entry.contentRect.width || DEFAULT_SVG_WIDTH;
      }
    });
    ro.observe(container);
    // Store for cleanup
    svg._resizeObserver = ro;
  }

  const preventScroll = (e) => {
    if (e.touches?.length > 1) return;
    e.preventDefault();
  };

  svg.addEventListener('touchstart', preventScroll, { passive: false });
  svg.addEventListener('touchmove', preventScroll, { passive: false });

  // Also prevent Pencil double-tap zoom on the SVG
  const preventPencilZoom = (e) => {
    if (isPen(e)) e.preventDefault();
  };
  svg.addEventListener('touchstart', preventPencilZoom);
  svg.addEventListener('touchend', preventPencilZoom);

  svg.addEventListener('beforeinput', (e) => e.preventDefault());
  svg.addEventListener('gesturestart', (e) => e.preventDefault());
});

onUnmounted(() => {
  if (animationFrameRef.value) cancelAnimationFrame(animationFrameRef.value);
  const svg = svgRef.value;
  if (svg?._resizeObserver) {
    svg._resizeObserver.disconnect();
    delete svg._resizeObserver;
  }
});
</script>

<style scoped>
.draw {
  -webkit-touch-callout: none;
  -webkit-user-select: none;
  user-select: none;
}

.drawing-container svg {
  cursor: crosshair;
  overflow: hidden;
}

/* Grid styles */
.drawing-container :deep(.grid) {
  background-image: url('data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="0 0 40 40"%3E%3Cpath fill="none" stroke="%23D1D5DB" stroke-width="0.5" d="M40 0v40H0"/%3E%3C/svg%3E');
  background-size: 40px 40px;
}

.drawing-container :deep(.ruled) {
  background-image: linear-gradient(transparent 95%, #d1d5db 5%);
  background-size: 100% 40px;
}

.drawing-container :deep(.dotted) {
  background-image: radial-gradient(#d1d5db 2px, transparent 2px);
  background-size: 40px 40px;
}

.dark .drawing-container :deep(.grid) {
  background-image: url('data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="0 0 40 40"%3E%3Cpath fill="none" stroke="%236B7280" stroke-width="0.5" d="M40 0v40H0"/%3E%3C/svg%3E');
  background-size: 40px 40px;
}

.dark .drawing-container :deep(.ruled) {
  background-image: linear-gradient(transparent 95%, #6b7280 5%);
  background-size: 100% 40px;
}

.dark .drawing-container :deep(.dotted) {
  background-image: radial-gradient(#6b7280 2px, transparent 2px);
  background-size: 40px 40px;
}

.resize-handle {
  background: transparent;
}

.resize-handle:hover {
  background: rgba(99, 102, 241, 0.05);
}

.draw:hover .resize-handle {
  opacity: 1;
}
</style>
