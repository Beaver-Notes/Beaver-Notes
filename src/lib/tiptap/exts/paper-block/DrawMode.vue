<template>
  <div class="draw">
    <div
      :class="[
        'drawing-container relative w-full',
        { 'touch-none': state.isDrawing, 'pointer-events-none': !interactive },
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

const props = defineProps({
  node: {
    type: Object,
    required: true,
  },
  interactive: {
    type: Boolean,
    default: true,
  },
});

const emit = defineEmits(['update-attributes', 'toolbar-state']);

const svgRef = ref(null);
const currentPointsRef = ref([]);
const animationFrameRef = ref(null);
const longPressTimeout = ref(null);
const isLongPress = ref(false);
const startPos = ref({ x: 0, y: 0 });

const initialLines = convertLegacyLines(props.node.attrs.lines || []).map(
  (line, index) => ({
    ...line,
    id: line.id || `line_${index}`,
  })
);

const state = reactive({
  lines: initialLines,
  isDrawing: false,
  tool: 'pen',
  penSettings: { color: '#1a1a1a', size: 2.5 },
  eraserSettings: { size: 18 },
  undoStack: [],
  redoStack: [],
  highlighterSettings: { color: '#fbbf24', size: 14 },
  height: props.node.attrs.height || 400,
  width: 500,
  background: props.node.attrs.paperType || 'plain',
  nextLineId: initialLines.length,
  selectedElement: null,
  transformState: null,
  selectionBox: null,
  currentStrokePoints: [],
});

const getSettings = () => {
  return state.tool === 'pen'
    ? state.penSettings
    : state.tool === 'eraser'
    ? state.eraserSettings
    : state.tool === 'highlighter'
    ? state.highlighterSettings
    : state.penSettings;
};

const setSelectedElement = (element) => {
  state.selectedElement = element;
};

const handleUndo = () => {
  if (state.undoStack.length > 0) {
    const previousState = state.undoStack.pop();
    state.redoStack.push([...state.lines]);
    state.lines = previousState;
    state.selectedElement = null;
  }
};

const handleRedo = () => {
  if (state.redoStack.length > 0) {
    const nextState = state.redoStack.pop();
    state.undoStack.push([...state.lines]);
    state.lines = nextState;
    state.selectedElement = null;
  }
};

const clearSelection = () => {
  state.selectedElement = null;
  state.selectionBox = null;
  state.transformState = null;
};

const getPathData = (line) => {
  if (!line.points || line.points.length < 2) return '';

  const stroke = getStroke(line.points, getStrokeOptions(line));
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

  const stroke = getStroke(
    currentPointsRef.value,
    getStrokeOptions(getSettings())
  );
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

const getResizeHandles = (bounds) => [
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

function setTool(tool) {
  state.tool = tool;
  clearSelection();
}

function setColor(color) {
  if (state.tool === 'eraser' || state.tool === 'select') return;
  state[`${state.tool}Settings`].color = color;
}

function setSize(size) {
  if (state.tool === 'select') return;
  state[`${state.tool}Settings`].size = Number(size);
}

function setBackground(type) {
  state.background = type;
  emit('update-attributes', { paperType: type });
}

defineExpose({
  setTool,
  setColor,
  setSize,
  setBackground,
  undo: handleUndo,
  redo: handleRedo,
  clearSelection,
});

onMounted(() => {
  const svgElement = svgRef.value;
  if (!svgElement) return;

  const preventAllScrolling = (e) => {
    if (e.touches && e.touches.length > 1) return;
    e.preventDefault();
  };

  svgElement.addEventListener('touchmove', preventTouchScroll, {
    passive: false,
  });
  svgElement.addEventListener('touchstart', preventAllScrolling, {
    passive: false,
  });

  return () => {
    svgElement.removeEventListener('touchmove', preventTouchScroll);
    svgElement.removeEventListener('touchstart', preventAllScrolling);
  };
});

watch(
  () => props.node.attrs,
  (newAttrs) => {
    state.lines = convertLegacyLines(newAttrs.lines || []).map(
      (line, index) => ({
        ...line,
        id: line.id || `line_${index}`,
      })
    );
    state.height = newAttrs.height || 400;
    state.background = newAttrs.paperType || 'plain';
    state.nextLineId = state.lines.length;
  },
  { deep: true }
);

watch(
  () => [state.lines, state.height],
  () => {
    emit('update-attributes', {
      lines: convertToLegacyFormat(state.lines),
      height: state.height,
      linesV2: state.lines,
    });
  },
  { deep: true }
);

watch(
  () => ({
    tool: state.tool,
    penSettings: { ...state.penSettings },
    highlighterSettings: { ...state.highlighterSettings },
    eraserSettings: { ...state.eraserSettings },
    undoDepth: state.undoStack.length,
    redoDepth: state.redoStack.length,
    background: state.background,
  }),
  (toolbarState) => {
    emit('toolbar-state', toolbarState);
  },
  { deep: true, immediate: true }
);

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
