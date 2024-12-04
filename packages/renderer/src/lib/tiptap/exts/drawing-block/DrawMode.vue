<template>
  <div class="flex flex-col w-full h-screen">
    <!-- Toolbar -->
    <div
      class="flex justify-start items-center p-4 bg-gray-100 border-b border-gray-300"
    >
      <button
        class="px-4 py-2 bg-blue-500 text-white rounded-md hover:bg-blue-600"
        @click="setTool('pencil')"
        :class="{ 'ring-2 ring-blue-300': tool === 'pencil' }"
      >
        Pencil
      </button>
      <button
        class="px-4 py-2 bg-red-500 text-white rounded-md hover:bg-red-600 ml-2"
        @click="setTool('eraser')"
        :class="{ 'ring-2 ring-red-300': tool === 'eraser' }"
      >
        Eraser
      </button>
      <button
        class="px-4 py-2 bg-yellow-500 text-white rounded-md hover:bg-yellow-600 ml-2"
        @click="setTool('highlighter')"
        :class="{ 'ring-2 ring-yellow-300': tool === 'highlighter' }"
      >
        Highlighter
      </button>

      <!-- Color Picker -->
      <input
        type="color"
        v-model="color"
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
        :disabled="history.length === 0"
      >
        Undo
      </button>
      <button
        class="ml-2 px-4 py-2 bg-gray-500 text-white rounded-md hover:bg-gray-600 disabled:opacity-50"
        @click="redo"
        :disabled="redoStack.length === 0"
      >
        Redo
      </button>

      <!-- Clear Canvas Button -->
      <button
        class="ml-2 px-4 py-2 bg-red-500 text-white rounded-md hover:bg-red-600"
        @click="clearCanvas"
      >
        Clear
      </button>
    </div>

    <!-- Drawing Area -->
    <div class="flex-grow relative bg-white overflow-hidden">
      <svg
        ref="svgRef"
        :viewBox="`0 0 ${svgWidth} ${svgHeight}`"
        class="w-full h-full touch-none"
        @pointerdown="startDrawing"
        @pointermove="draw"
        @pointerup="stopDrawing"
        @pointerleave="stopDrawing"
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
import { ref, reactive, onMounted, onUnmounted } from 'vue';
import * as d3 from 'd3';

export default {
  setup() {
    // SVG Dimensions
    const svgWidth = window.innerWidth;
    const svgHeight = window.innerHeight;

    // Drawing State
    const svgRef = ref(null);
    const tool = ref('pencil');
    const color = ref('#000000');
    const size = ref(2);
    const isDrawing = ref(false);
    const points = ref([]);
    const lines = reactive([]);
    const currentPath = ref('');

    // History Management
    const history = ref([]);
    const redoStack = ref([]);

    // Eraser Configuration
    const eraseRadius = 20;

    // D3 Line Generator
    const lineGenerator = d3
      .line()
      .x((d) => d.x)
      .y((d) => d.y)
      .curve(d3.curveBasis);

    // Get Pointer Coordinates
    const getPointerCoordinates = (event) => {
      const svg = svgRef.value;
      const rect = svg.getBoundingClientRect();

      const clientX =
        event.clientX || (event.touches && event.touches[0].clientX);
      const clientY =
        event.clientY || (event.touches && event.touches[0].clientY);

      const scaleX = svg.viewBox.baseVal.width / rect.width;
      const scaleY = svg.viewBox.baseVal.height / rect.height;

      return [(clientX - rect.left) * scaleX, (clientY - rect.top) * scaleY];
    };

    // Start Drawing
    const startDrawing = (event) => {
      const [x, y] = getPointerCoordinates(event);
      isDrawing.value = true;
      points.value = [{ x, y }];

      // Handle eraser immediately
      if (tool.value === 'eraser') {
        eraseOverlappingPaths(x, y);
      }
    };

    // Drawing Process
    const draw = (event) => {
      if (!isDrawing.value) return;

      const [x, y] = getPointerCoordinates(event);
      points.value.push({ x, y });

      if (tool.value === 'eraser') {
        eraseOverlappingPaths(x, y);
      }

      currentPath.value = lineGenerator(points.value);
    };

    // Stop Drawing
    const stopDrawing = () => {
      if (!isDrawing.value) return;

      isDrawing.value = false;

      // Only add path if it's not an empty line
      if (points.value.length > 1) {
        const newLine = {
          path: currentPath.value,
          color: color.value,
          size: size.value,
          tool: tool.value,
        };

        lines.push(newLine);
        history.value.push({ action: 'add', line: newLine });
        redoStack.value = []; // Clear redo stack
      }

      currentPath.value = '';
      points.value = [];
    };

    // Eraser Logic
    const eraseOverlappingPaths = (x, y) => {
      const eraserArea = {
        x: x - eraseRadius,
        y: y - eraseRadius,
        width: eraseRadius * 2,
        height: eraseRadius * 2,
      };

      // Iterate over paths in reverse to handle deletion safely
      for (let i = lines.length - 1; i >= 0; i--) {
        const pathNode = svgRef.value.querySelectorAll('path')[i];

        if (!pathNode) continue;

        const pathBBox = pathNode.getBBox();

        if (
          pathBBox.x < eraserArea.x + eraserArea.width &&
          pathBBox.x + pathBBox.width > eraserArea.x &&
          pathBBox.y < eraserArea.y + eraserArea.height &&
          pathBBox.y + pathBBox.height > eraserArea.y
        ) {
          deletePath(i);
        }
      }
    };

    // Delete Path
    const deletePath = (index) => {
      const removedLine = lines[index];
      lines.splice(index, 1);
      history.value.push({ action: 'delete', line: removedLine });
    };

    // Handle Path Click (optional interaction)
    const handlePathClick = (line) => {
      if (tool.value === 'eraser') {
        const index = lines.findIndex((l) => l.path === line.path);
        if (index !== -1) {
          deletePath(index);
        }
      }
    };

    // Undo
    const undo = () => {
      if (history.value.length === 0) return;

      const lastAction = history.value.pop();
      redoStack.value.push(lastAction);

      if (lastAction.action === 'add') {
        lines.pop();
      } else if (lastAction.action === 'delete') {
        const deletedLine = lastAction.line;
        const index = lines.findIndex((l) => l.path === deletedLine.path);
        if (index === -1) {
          lines.push(deletedLine);
        }
      }
    };

    // Redo
    const redo = () => {
      if (redoStack.value.length === 0) return;

      const lastRedo = redoStack.value.pop();
      history.value.push(lastRedo);

      if (lastRedo.action === 'add') {
        lines.push(lastRedo.line);
      } else if (lastRedo.action === 'delete') {
        const index = lines.findIndex((l) => l.path === lastRedo.line.path);
        if (index !== -1) {
          lines.splice(index, 1);
        }
      }
    };

    // Set Tool
    const setTool = (selectedTool) => {
      tool.value = selectedTool;
    };

    // Clear Canvas
    const clearCanvas = () => {
      if (lines.length > 0) {
        history.value.push({ action: 'clear', lines: [...lines] });
        lines.splice(0, lines.length);
        redoStack.value = [];
      }
    };

    // Prevent Default Touch Behaviors
    const preventDefault = (e) => {
      e.preventDefault();
    };

    // Mounted Hook for Event Listeners
    onMounted(() => {
      const svg = svgRef.value;
      svg.addEventListener('touchstart', preventDefault, { passive: false });
      svg.addEventListener('touchmove', preventDefault, { passive: false });
    });

    // Unmounted Hook for Cleanup
    onUnmounted(() => {
      const svg = svgRef.value;
      svg.removeEventListener('touchstart', preventDefault);
      svg.removeEventListener('touchmove', preventDefault);
    });

    return {
      svgRef,
      svgWidth,
      svgHeight,
      tool,
      color,
      size,
      lines,
      currentPath,
      history,
      redoStack,
      startDrawing,
      draw,
      stopDrawing,
      undo,
      redo,
      setTool,
      clearCanvas,
      handlePathClick,
    };
  },
};
</script>

<style scoped>
svg {
  width: 100%;
  height: 100%;
  position: absolute;
  touch-action: none;
  user-select: none;
}
</style>
