<template>
  <div
    class="draw w-full min-h-screen flex flex-col border-neutral-400 shadow-2xl"
  >
    <div
      :class="[
        'drawing-container relative w-full',
        { 'touch-none': state.isDrawing },
      ]"
      :style="{ height: `${state.height}px` }"
    >
      <svg
        ref="svgRef"
        :viewBox="`0 0 ${state.width} ${state.height}`"
        preserveAspectRatio="xMidYMid meet"
        :class="[state.background, 'bg-neutral-100 dark:bg-neutral-800']"
        @pointerdown="handlePointerDown"
        @pointermove="handlePointerMove"
        @pointerup="handlePointerUp"
        @pointerleave="handlePointerLeave"
        @pointercancel="handlePointerCancel"
      >
        <!-- Rendered paths -->
        <g v-for="line in state.lines" :key="line.id">
          <path
            v-if="line.points && line.points.length > 1"
            :d="getPathData(line)"
            :fill="line.tool === 'highlighter' ? 'none' : line.color"
            :stroke="line.tool === 'highlighter' ? line.color : 'none'"
            :stroke-width="line.tool === 'highlighter' ? line.size : 0"
            :opacity="line.tool === 'highlighter' ? 0.4 : 1"
            stroke-linecap="round"
            stroke-linejoin="round"
          />
        </g>

        <!-- Selection box -->
        <rect
          v-if="state.selectionBox"
          :x="Math.min(state.selectionBox.startX, state.selectionBox.currentX)"
          :y="Math.min(state.selectionBox.startY, state.selectionBox.currentY)"
          :width="
            Math.abs(state.selectionBox.currentX - state.selectionBox.startX)
          "
          :height="
            Math.abs(state.selectionBox.currentY - state.selectionBox.startY)
          "
          class="fill-secondary opacity-10 stroke-primary"
          stroke-width="1"
          stroke-dasharray="4 4"
        />

        <!-- Selection overlay -->
        <g
          v-if="state.selectedElement && state.selectedElement.type === 'group'"
        >
          <rect
            :x="state.selectedElement.bounds.x"
            :y="state.selectedElement.bounds.y"
            :width="state.selectedElement.bounds.width"
            :height="state.selectedElement.bounds.height"
            class="fill-none stroke-secondary stroke-2"
            stroke-dasharray="5,5"
          />

          <!-- Corner resize handles -->
          <circle
            v-for="handle in getResizeHandles(state.selectedElement.bounds)"
            :key="handle.corner"
            :cx="handle.x"
            :cy="handle.y"
            :r="4"
            class="fill-secondary stroke-white stroke-[1px]"
            :style="{ cursor: handle.cursor }"
            @pointerdown="(e) => handleTransformStart(e, handle.corner)"
          />
        </g>

        <!-- Current stroke preview -->
        <path
          v-if="state.isDrawing && state.currentStrokePoints.length > 1"
          :d="getCurrentStrokePathData()"
          :fill="getCurrentStrokeFill()"
          :stroke="getCurrentStrokeStroke()"
          :stroke-width="getCurrentStrokeWidth()"
          :opacity="getCurrentStrokeOpacity()"
          stroke-linecap="round"
        />
      </svg>
    </div>

    <DrawingToolBar
      :state="state"
      :tool="state.tool"
      :undo-stack="state.undoStack"
      :redo-stack="state.redoStack"
      @update-state="updateState"
      @set-selected-element="setSelectedElement"
      @close="$emit('close')"
      @update-attributes="$emit('update-attributes')"
      @undo="handleUndo"
      @redo="handleRedo"
    />
  </div>
</template>

<script setup>
import { ref, reactive, onMounted, onUnmounted, watch } from 'vue';
import { getStroke } from 'perfect-freehand';
import {
  getSvgPathFromStroke,
  getPointerCoordinates,
  getStrokeOptions,
  convertLegacyLines,
  convertToLegacyFormat,
  isPalmTouch,
  preventTouchScroll,
} from './helpers/drawHelper';
import { usePointerHelper } from './helpers/pointerHelper';
import useSelectionHelper from './helpers/selectionHelper';
import useTransforHelper from './helpers/transformHelper';
import { recognizeShape, createShape } from './helpers/shapesHelper';
import DrawingToolBar from './DrawingToolbar.vue';

// Props
const props = defineProps({
  node: {
    type: Object,
    required: true,
  },
});

// Emits
const emit = defineEmits(['update-attributes', 'close']);

// Refs
const svgRef = ref(null);
const currentPointsRef = ref([]);
const animationFrameRef = ref(null);
const longPressTimeout = ref(null);
const isLongPress = ref(false);
const startPos = ref({ x: 0, y: 0 });

// Initial state setup
const initialLines = convertLegacyLines(props.node.attrs.lines || []).map(
  (line, index) => ({
    ...line,
    id: `line_${index}`,
  })
);

const state = reactive({
  lines: initialLines,
  isDrawing: false,
  tool: 'pen',
  penSettings: { color: '#000000', size: 2 },
  eraserSettings: { size: 10 },
  undoStack: [],
  redoStack: [],
  highlighterSettings: { color: '#ffff00', size: 8 },
  height: props.node.attrs.height || 400,
  width: 500,
  background: props.node.attrs.paperType || 'plain',
  nextLineId: initialLines.length,
  selectedElement: null,
  transformState: null,
  selectionBox: null,
  currentStrokePoints: [],
});

// Methods
const getSettings = () => {
  return state.tool === 'pen'
    ? state.penSettings
    : state.tool === 'eraser'
    ? state.eraserSettings
    : state.highlighterSettings;
};

const updateState = (updates) => {
  console.log('Updating state:', updates);
  Object.assign(state, updates);
};

const setSelectedElement = (element) => {
  state.selectedElement = element;
};

const handleUndo = () => {
  if (state.undoStack.length > 0) {
    const previousState = state.undoStack.pop();
    state.redoStack.push([...state.lines]);
    state.lines = previousState;
  }
};

const handleRedo = () => {
  if (state.redoStack.length > 0) {
    const nextState = state.redoStack.pop();
    state.undoStack.push([...state.lines]);
    state.lines = nextState;
  }
};

const getPathData = (line) => {
  if (!line.points || line.points.length < 2) return '';

  const settings = {
    color: line.color,
    size: line.size,
    tool: line.tool,
  };

  const stroke = getStroke(line.points, getStrokeOptions(settings));
  return getSvgPathFromStroke(stroke);
};

const getCurrentStrokePathData = () => {
  if (state.tool === 'eraser') {
    const shortStroke = currentPointsRef.value.slice(-5);
    return shortStroke
      .map((point, index) =>
        index === 0 ? `M ${point[0]},${point[1]}` : `L ${point[0]},${point[1]}`
      )
      .join(' ');
  }

  const settings = getSettings();
  const stroke = getStroke(currentPointsRef.value, getStrokeOptions(settings));
  return getSvgPathFromStroke(stroke);
};

const getCurrentStrokeFill = () => {
  if (state.tool === 'eraser') return 'none';
  return getSettings().color;
};

const getCurrentStrokeStroke = () => {
  if (state.tool === 'eraser') return 'rgba(150, 150, 150, 0.8)';
  if (state.tool === 'highlighter') return getSettings().color;
  return 'none';
};

const getCurrentStrokeWidth = () => {
  if (state.tool === 'eraser') return state.eraserSettings.size;
  if (state.tool === 'highlighter') return getSettings().size;
  return 0;
};

const getCurrentStrokeOpacity = () => {
  if (state.tool === 'highlighter') return 0.4;
  return 1;
};

const getResizeHandles = (bounds) => {
  return [
    { x: bounds.x, y: bounds.y, cursor: 'nw-resize', corner: 'nw' },
    {
      x: bounds.x + bounds.width,
      y: bounds.y,
      cursor: 'ne-resize',
      corner: 'ne',
    },
    {
      x: bounds.x,
      y: bounds.y + bounds.height,
      cursor: 'sw-resize',
      corner: 'sw',
    },
    {
      x: bounds.x + bounds.width,
      y: bounds.y + bounds.height,
      cursor: 'se-resize',
      corner: 'se',
    },
  ];
};

const isPointInsideSelection = (x, y) => {
  if (!state.selectedElement) return false;
  const { bounds } = state.selectedElement;
  return (
    x >= bounds.x &&
    x <= bounds.x + bounds.width &&
    y >= bounds.y &&
    y <= bounds.y + bounds.height
  );
};

const { handleTransformStart, handleTransformMove, handleTransformEnd } =
  useTransforHelper(state, svgRef);

const { handleSelectionStart, handleSelectionMove, handleSelectionEnd } =
  useSelectionHelper(
    state,
    svgRef,
    isPointInsideSelection,
    handleTransformStart
  );

const context = {
  state,
  svgRef,
  startPos,
  isLongPress,
  longPressTimeout,
  emit,
  currentPointsRef,
  isPalmTouch,
  getPointerCoordinates,
  handleSelectionStart,
  handleTransformMove,
  handleSelectionMove,
  animationFrameRef,
  handleTransformEnd,
  handleSelectionEnd,
  recognizeShape,
  createShape,
  getSettings,
  getStroke,
  getStrokeOptions,
};

const {
  handlePointerDown,
  handlePointerMove,
  handlePointerUp,
  handlePointerLeave,
  handlePointerCancel,
} = usePointerHelper(context);

// Event listeners setup
onMounted(() => {
  const svgElement = svgRef.value;
  if (!svgElement) return;

  const preventAllScrolling = (e) => {
    if (e.touches && e.touches.length > 1) return;
    e.preventDefault();
  };

  svgElement.addEventListener('wheel', preventAllScrolling, { passive: false });
  svgElement.addEventListener('touchmove', preventTouchScroll, {
    passive: false,
  });
  svgElement.addEventListener('touchstart', preventAllScrolling, {
    passive: false,
  });

  return () => {
    svgElement.removeEventListener('wheel', preventAllScrolling);
    svgElement.removeEventListener('touchmove', preventTouchScroll);
    svgElement.removeEventListener('touchstart', preventAllScrolling);
  };
});

// Watch for state changes to update attributes
watch(
  () => [state.lines, state.height],
  () => {
    const legacyLines = convertToLegacyFormat(state.lines);
    emit('update-attributes', {
      lines: legacyLines,
      height: state.height,
      linesV2: state.lines,
    });
  },
  { deep: true }
);

// Cleanup
onUnmounted(() => {
  if (animationFrameRef.value) {
    cancelAnimationFrame(animationFrameRef.value);
  }
  if (longPressTimeout.value) {
    clearTimeout(longPressTimeout.value);
  }
});
</script>

<style scoped>
.draw {
  touch-action: none;
}

.touch-none {
  touch-action: none;
}
</style>
