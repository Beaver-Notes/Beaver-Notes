<template>
  <div class="w-full h-screen">
    <!-- Toolbar -->
    <div
      class="flex justify-start items-center p-4 bg-gray-100 border-b border-gray-300"
    >
      <button
        class="px-4 py-2 bg-blue-500 text-white rounded-md hover:bg-blue-600"
        :class="{ 'ring-2 ring-blue-300': tool === 'pencil' }"
        @click="setTool('pencil')"
      >
        Pencil
      </button>
      <button
        class="px-4 py-2 bg-red-500 text-white rounded-md hover:bg-red-600 ml-2"
        :class="{ 'ring-2 ring-red-300': tool === 'eraser' }"
        @click="setTool('eraser')"
      >
        Eraser
      </button>
      <button
        class="px-4 py-2 bg-yellow-500 text-white rounded-md hover:bg-yellow-600 ml-2"
        :class="{ 'ring-2 ring-yellow-300': tool === 'highlighter' }"
        @click="setTool('highlighter')"
      >
        Highlighter
      </button>

      <!-- Color Picker -->
      <input
        v-model="color"
        type="color"
        class="ml-4 w-10 h-10 p-0 border border-gray-300 rounded-md"
        :disabled="tool === 'eraser'"
      />

      <!-- Line Size Selector -->
      <select
        v-model="size"
        class="ml-4 px-4 py-2 border border-gray-300 rounded-md"
      >
        <option :value="2">Thin</option>
        <option :value="3">Medium</option>
        <option :value="4">Thick</option>
        <option :value="5">Thicker</option>
      </select>

      <!-- Undo/Redo Buttons -->
      <button
        class="ml-4 px-4 py-2 bg-gray-500 text-white rounded-md hover:bg-gray-600 disabled:opacity-50"
        @click="undo"
      >
        Undo
      </button>
      <button
        class="ml-2 px-4 py-2 bg-gray-500 text-white rounded-md hover:bg-gray-600 disabled:opacity-50"
        @click="redo"
      >
        Redo
      </button>

      <!-- Clear Canvas Button -->
      <button
        class="ml-2 px-4 py-2 bg-red-500 text-white rounded-md hover:bg-red-600"
        @click="onClose"
      >
        Close
      </button>
    </div>

    <!-- Drawing Area -->
    <div class="flex-grow relative bg-white overflow-hidden">
      <svg
        ref="svgRef"
        :viewBox="`0 0 ${svgWidth} ${svgHeight}`"
        class="w-full h-full touch-none"
        @pointerdown="handlePointerEvent"
        @pointermove="handlePointerEvent"
        @pointerup="handlePointerEvent"
        @pointerleave="handlePointerEvent"
      >
        <g>
          <!-- Render saved lines -->
          <path
            v-for="(line, index) in lines"
            :key="index"
            :d="line.path"
            :stroke="line.tool === 'eraser' ? 'white' : line.color"
            :stroke-width="line.size"
            :opacity="line.tool === 'highlighter' ? 0.5 : 1"
            fill="none"
            stroke-linecap="round"
            @click="handlePathClick(line)"
          />
        </g>

        <!-- Current path -->
        <path
          v-if="currentPath"
          :d="currentPath"
          :stroke="tool === 'eraser' ? 'white' : color"
          :stroke-width="size"
          :opacity="tool === 'highlighter' ? 0.5 : 1"
          fill="none"
          stroke-linecap="round"
        />
      </svg>
    </div>
  </div>
</template>

<script>
import { ref, watch } from 'vue';
import {
  useSmoothPoints,
  useChunkedLines,
  useEraseOverlappingPaths,
  useGetPointerCoordinates,
  useSaveDrawing,
  useLineGenerator,
  useRedo,
  useUndo,
  thicknessOptions,
} from './DrawingUtil';

export default {
  name: 'DrawMode',
  props: {
    onClose: {
      type: Function,
      default: () => {},
    },
    updateAttributes: {
      type: Function,
      default: () => {},
    },
    node: {
      type: Object,
      default: () => ({}),
    },
  },
  setup(props) {
    const svgRef = ref(null);
    const svgWidth = 500;
    const svgHeight = ref(props.node.attrs.height || 400);
    const color = ref('#000000');
    const size = ref(thicknessOptions.medium);
    const tool = ref('pencil');
    const lines = ref(props.node.attrs.lines || []);
    const currentPath = ref(''); // Current drawing path
    const history = ref([]); // Action history
    const redoStack = ref([]); // Redo stack
    const drawing = ref(false); // Drawing state
    const points = ref([]); // Current drawing points
    const penActive = ref(false);
    const isErasing = ref(false);
    const PEN_TIMEOUT_DURATION = 500;
    let penTimeout;

    // Import utility functions
    const { smoothPoints } = useSmoothPoints();
    const { chunkedLines } = useChunkedLines(ref(lines));
    const { getPointerCoordinates } = useGetPointerCoordinates(svgRef);
    const { saveDrawing } = useSaveDrawing(
      ref(lines),
      (newHistory) => {
        history.value = Array.isArray(newHistory) ? [...newHistory] : [];
      },
      props.updateAttributes,
      currentPath,
      color,
      size,
      tool,
      (newRedoStack) => {
        redoStack.value = Array.isArray(newRedoStack) ? [...newRedoStack] : [];
      }
    );
    const { eraseOverlappingPaths } = useEraseOverlappingPaths(
      svgRef,
      ref(lines),
      (newHistory) => {
        history.value = Array.isArray(newHistory) ? [...newHistory] : [];
      },
      props.updateAttributes
    );
    const { lineGenerator } = useLineGenerator();

    // Set tool (pencil, eraser, etc.)
    const setTool = (newTool) => {
      tool.value = newTool;
    };

    // Handle pointer events
    const handlePointerEvent = (event) => {
      if ((event.pointerType === 'pen', event.pointerType === 'mouse')) {
        penActive.value = true;
        clearTimeout(penTimeout);
        event.preventDefault(); // Prevent touch interaction when pen is active
        event.stopPropagation();

        const [x, y] = getPointerCoordinates(event);

        if (event.type === 'pointerdown') {
          if (tool.value === 'eraser') {
            isErasing.value = true;
            eraseOverlappingPaths(x, y);
          } else {
            startDrawing(x, y);
          }
        } else if (event.type === 'pointermove') {
          if (tool.value === 'eraser' && isErasing.value) {
            eraseOverlappingPaths(x, y);
          } else if (tool.value !== 'eraser') {
            draw(x, y);
          }
        } else if (event.type === 'pointerup') {
          if (tool.value === 'eraser') {
            isErasing.value = false;
          } else {
            stopDrawing();
          }

          penTimeout = setTimeout(() => {
            penActive.value = false;
          }, PEN_TIMEOUT_DURATION);
        }
      }
    };

    // Start drawing (pointer down)
    const startDrawing = (x, y) => {
      drawing.value = true;
      points.value = [{ x, y }];
    };

    // Continue drawing (pointer move)
    const draw = (x, y) => {
      if (!drawing.value) return;
      points.value.push({ x, y });
      const smoothedPoints = smoothPoints(points.value);
      currentPath.value = lineGenerator.value(smoothedPoints);
    };

    // Stop drawing (pointer up)
    const stopDrawing = () => {
      if (!drawing.value) return;
      drawing.value = false;

      if (currentPath.value) {
        // Save the current path to the lines array
        lines.value.push({
          path: currentPath.value,
          color: color.value,
          size: size.value,
          tool: tool.value,
        });
        saveDrawing();
      }

      // Clear currentPath and points
      currentPath.value = '';
      points.value = [];
    };

    // Undo action
    const { undo } = useUndo(
      history,
      redoStack,
      props.updateAttributes,
      ref(lines)
    );

    // Redo action
    const { redo } = useRedo(
      redoStack,
      history,
      props.updateAttributes,
      ref(lines)
    );

    // Watch for changes in SVG height and update attributes
    watch(
      () => svgHeight.value,
      (newHeight) => {
        props.updateAttributes({ height: newHeight });
      }
    );

    // Expose variables and functions to the template
    return {
      svgRef,
      svgWidth,
      svgHeight,
      color,
      size,
      tool,
      lines,
      chunkedLines,
      currentPath,
      history,
      redoStack,
      setTool,
      handlePointerEvent,
      startDrawing,
      draw,
      stopDrawing,
      undo,
      redo,
    };
  },
};
</script>
