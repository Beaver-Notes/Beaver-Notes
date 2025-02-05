<template>
  <div class="draw w-full min-h-screen flex flex-col">
    <!-- Toolbar -->
    <div
      class="mt-2 sticky top-0 z-10 p-4 flex justify-between items-center bg-gray-100 dark:bg-neutral-800 rounded-none shadow-md"
    >
      <!-- Left side controls -->
      <div class="flex items-center space-x-2">
        <button
          v-tooltip.group="translations.paperBlock.pencil"
          :class="[
            'flex items-center justify-center p-2 border rounded hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-primary bg-neutral-100 dark:bg-neutral-800',
            tool === 'pencil'
              ? 'border-primary bg-primary'
              : 'border-gray-300 dark:border-neutral-600',
          ]"
          @click="
            setTool('pencil');
            setColor(isDarkMode ? '#FFFFFF' : '#000000');
            size = 2;
          "
          @mousedown.prevent
        >
          <v-remixicon name="riBallPenLine" class="w-6 h-6" />
        </button>
        <button
          v-tooltip.group="translations.paperBlock.highighter"
          :class="[
            'flex items-center justify-center p-2 border rounded hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-primary bg-neutral-100 dark:bg-neutral-800',
            tool === 'highlighter'
              ? 'border-primary bg-primary'
              : 'border-gray-300 dark:border-neutral-600',
          ]"
          @click="
            setTool('highlighter');
            setColor('#FFFF00');
            size = 8;
          "
          @mousedown.prevent
        >
          <v-remixicon name="riMarkPenLine" class="w-6 h-6" />
        </button>
        <button
          v-tooltip.group="translations.paperBlock.eraser"
          :class="[
            'flex items-center justify-center p-2 border rounded hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-primary bg-neutral-100 dark:bg-neutral-800',
            tool === 'eraser'
              ? 'border-primary bg-primary'
              : 'border-gray-300 dark:border-neutral-600',
          ]"
          @click="setTool('eraser')"
          @mousedown.prevent
        >
          <v-remixicon name="riEraserLine" class="w-6 h-6" />
        </button>
        <div class="relative">
          <select
            v-model="background"
            class="border border-neutral-300 dark:border-neutral-600 rounded w-full p-2 text-neutral-800 bg-[#F8F8F7] dark:bg-[#2D2C2C] dark:text-[color:var(--selected-dark-text)] outline-none appearance-none mr-6"
            @change="handleBackgroundChange"
          >
            <option value="none">{{ translations.paperBlock.none }}</option>
            <option value="grid">{{ translations.paperBlock.grid }}</option>
            <option value="ruled">{{ translations.paperBlock.ruled }}</option>
            <option value="dotted">{{ translations.paperBlock.dotted }}</option>
          </select>
          <v-remixicon
            name="riArrowDownSLine"
            class="dark:text-[color:var(--selected-dark-text)] ri-arrow-down-s-line absolute right-3 top-1/2 transform -translate-y-1/2 text-neutral-600 pointer-events-none"
          />
        </div>
      </div>
      <!-- Right side controls -->
      <div class="flex items-center space-x-2">
        <div class="relative inline-block">
          <!-- Color Button -->
          <button
            class="ml-4 w-10 h-10 p-0 border border-gray-300 rounded-full cursor-pointer"
            :style="{ backgroundColor: color }"
            :disabled="tool === 'eraser'"
            @click="openColorPicker"
          ></button>

          <!-- Color Input -->
          <input
            ref="colorInput"
            v-model="color"
            type="color"
            class="absolute top-full left-0 mt-2 w-10 h-10 opacity-0 cursor-pointer"
            @input="updateColor"
          />
        </div>

        <!-- Line Size Selector -->
        <div v-if="tool !== 'eraser'" class="relative">
          <select
            v-model="size"
            class="border border-neutral-300 dark:border-neutral-600 rounded w-full p-2 text-neutral-800 bg-[#F8F8F7] dark:bg-[#2D2C2C] dark:text-[color:var(--selected-dark-text)] outline-none appearance-none mr-6"
          >
            <option v-if="tool === 'pencil'" :value="2">
              {{ translations.paperBlock.thin }}
            </option>
            <option v-if="tool === 'pencil'" :value="3">
              {{ translations.paperBlock.medium }}
            </option>
            <option v-if="tool === 'pencil'" :value="4">
              {{ translations.paperBlock.thick }}
            </option>
            <option v-if="tool === 'pencil'" :value="5">
              {{ translations.paperBlock.thicker }}
            </option>
            <option v-if="tool === 'highlighter'" :value="8">
              {{ translations.paperBlock.thin }}
            </option>
            <option v-if="tool === 'highlighter'" :value="9">
              {{ translations.paperBlock.medium }}
            </option>
            <option v-if="tool === 'highlighter'" :value="10">
              {{ translations.paperBlock.thick }}
            </option>
            <option v-if="tool === 'highlighter'" :value="11">
              {{ translations.paperBlock.thicker }}
            </option>
          </select>
          <v-remixicon
            name="riArrowDownSLine"
            class="dark:text-[color:var(--selected-dark-text)] ri-arrow-down-s-line absolute right-3 top-1/2 transform -translate-y-1/2 text-neutral-600 pointer-events-none"
          />
        </div>
        <button
          class="flex items-center justify-center p-2 border border-gray-300 dark:border-neutral-600 rounded hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-primary bg-neutral-100 dark:bg-neutral-800"
          @click="undo"
          @mousedown.prevent
        >
          <v-remixicon name="riArrowGoBackLine" class="w-6 h-6" />
        </button>
        <button
          class="flex items-center justify-center p-2 border border-gray-300 dark:border-neutral-600 rounded hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-primary bg-neutral-100 dark:bg-neutral-800"
          @click="redo"
          @mousedown.prevent
        >
          <v-remixicon name="riArrowGoForwardLine" class="w-6 h-6" />
        </button>
        <!-- Add other buttons and controls as needed -->
        <button
          class="p-2 rounded-full bg-gray-100 dark:bg-neutral-800 hover:bg-gray-200 dark:hover:bg-neutral-700 transition-colors"
          @click="onClose"
        >
          <v-remixicon name="riCloseLine" class="w-6 h-6" />
        </button>
      </div>
    </div>

    <!-- Drawing Area -->
    <div ref="containerRef" class="relative flex-grow drawing-container">
      <svg
        ref="svgRef"
        :viewBox="`0 0 ${svgWidth} ${svgHeight}`"
        preserveAspectRatio="xMidYMid meet"
        :class="`w-full h-auto ${background} bg-neutral-100 dark:bg-neutral-800`"
        @pointerdown="handlePointerEvent"
        @pointermove="handlePointerEvent"
        @pointerup="handlePointerEvent"
        @pointerleave="handlePointerEvent"
        @touchmove.passive.prevent="handleTouchMove"
      >
        <g>
          <!-- Render saved lines -->
          <path
            v-for="(line, index) in linesRef"
            :key="index"
            :d="line.path"
            :stroke="
              line.tool === 'eraser' ? 'white' : adjustColorForMode(line.color)
            "
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
          :stroke="tool === 'eraser' ? 'white' : adjustColorForMode(color)"
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
import { useTranslation } from '@/composable/translations';
import '@/assets/css/paper.scss';
import { ref, watch, onMounted } from 'vue';
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
  backgroundStyles,
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
    const linesRef = ref(props.node.attrs.lines || []);
    const BUFFER_ZONE = 150;
    const INCREMENT_HEIGHT = 200;
    const svgRef = ref(null);
    const colorInput = ref(null);
    const containerRef = ref(null);
    const svgWidth = 500;
    const svgHeight = ref(props.node.attrs.height || 400);
    const color = ref('#000000');
    const size = ref(thicknessOptions.medium);
    const background = ref(props.node.attrs.paperType || backgroundStyles.none);
    const tool = ref('pencil');
    const currentPath = ref(''); // Current drawing path
    const history = ref([]); // Action history
    const redoStack = ref([]); // Redo stack
    const drawing = ref(false); // Drawing state
    const points = ref([]); // Current drawing points
    const penActive = ref(false);
    const isErasing = ref(false);
    const PEN_TIMEOUT_DURATION = 500;
    const translations = ref({ paperBlock: {} });
    let penTimeout;

    // Import utility functions
    const { smoothPoints } = useSmoothPoints();
    const { chunkedLines } = useChunkedLines(linesRef);
    const { getPointerCoordinates } = useGetPointerCoordinates(svgRef);
    const { saveDrawing } = useSaveDrawing(
      linesRef,
      history,
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
      linesRef,
      history,
      props.updateAttributes
    );
    const { lineGenerator } = useLineGenerator();

    // Set tool (pencil, eraser, etc.)
    const setTool = (newTool) => {
      tool.value = newTool;
    };

    // Handle pointer events
    const handlePointerEvent = (event) => {
      if (event.pointerType === 'pen' || event.pointerType === 'mouse') {
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

      // Add the new point
      points.value.push({ x, y });
      const smoothedPoints = smoothPoints(points.value);
      currentPath.value = lineGenerator.value(smoothedPoints);

      if (y > svgHeight.value - BUFFER_ZONE) {
        const newHeight = svgHeight.value + INCREMENT_HEIGHT;
        svgHeight.value = newHeight;
        props.updateAttributes({ height: newHeight }); // Update SVG attributes

        // Scroll to keep the drawing point in view
        const container = containerRef.value; // Assuming containerRef is a ref
        if (container) {
          const scrollContainer = container.closest('.drawing-component');
          if (scrollContainer) {
            scrollContainer.scrollTo({
              top: scrollContainer.scrollHeight,
              behavior: 'smooth',
            });
          }
        }
      }
    };

    // Stop drawing (pointer up)
    const stopDrawing = () => {
      if (drawing.value) {
        drawing.value = false;
        saveDrawing();
        history.value.push({
          path: currentPath.value,
          color: color.value,
          size: size.value,
          tool: tool.value,
        });
        currentPath.value = '';
        points.value = [];
      }
    };

    const adjustColorForMode = (color) => {
      const isDarkMode = document.documentElement.classList.contains('dark');
      if (isDarkMode) {
        // Dark mode: Black turns to white; other colors unchanged
        return color === '#000000' ? '#FFFFFF' : color;
      } else {
        // Light mode: White turns to black; other colors unchanged
        return color === '#FFFFFF' ? '#000000' : color;
      }
    };

    const { undo } = useUndo(
      history,
      redoStack,
      props.updateAttributes,
      linesRef
    );
    const { redo } = useRedo(
      redoStack,
      history,
      props.updateAttributes,
      linesRef
    );

    // Watch for changes in SVG height and update attributes
    watch(
      () => svgHeight.value,
      (newHeight) => {
        props.updateAttributes({ height: newHeight });
      }
    );

    const setColor = (newColor) => {
      color.value = newColor;
    };

    const handleBackgroundChange = (event) => {
      background.value = event.target.value;
      props.updateAttributes({ paperType: event.target.value });
    };

    const openColorPicker = () => {
      colorInput.value.click();
    };

    onMounted(async () => {
      await useTranslation().then((trans) => {
        if (trans) {
          translations.value = trans;
        }
      });
    });

    const handleTouchMove = (event) => {
      if (drawing.value) {
        event.preventDefault();
      }
    };

    return {
      colorInput,
      handleTouchMove,
      openColorPicker,
      svgRef,
      handleBackgroundChange,
      svgWidth,
      svgHeight,
      color,
      size,
      setColor,
      tool,
      linesRef,
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
      background,
      backgroundStyles,
      translations,
      adjustColorForMode,
    };
  },
};
</script>
