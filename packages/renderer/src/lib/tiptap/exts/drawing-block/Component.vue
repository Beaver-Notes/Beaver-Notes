<template>
  <node-view-wrapper class="draw">
    <div class="relative drawing-container">
      <svg
        ref="canvas"
        :height="svgHeight"
        :viewBox="`0 0 ${svgWidth} ${svgHeight}`"
        class="border border-gray-300"
      >
        <template v-for="item in node.attrs.lines" :key="item.id">
          <path
            v-if="item.id !== id"
            :id="`id-${item.id}`"
            :d="item.path"
            :stroke="item.color"
            :stroke-width="item.size"
            :opacity="item.tool === 'highlighter' ? 0.3 : 1"
            fill="none"
          />
        </template>
      </svg>
      <div
        class="absolute bottom-2 w-4 h-4 right-2 cursor-row-resize"
        @mousedown="startResize"
      >
        <svg
          viewBox="0 0 24 24"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          class="stroke-current"
          :class="{ 'text-black': !isDarkMode, 'text-white': isDarkMode }"
        >
          <path
            d="M21 15L15 21M21 8L8 21"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
          />
        </svg>
      </div>
    </div>
    <div
      class="p-4 flex justify-between items-center bg-gray-100 border border-gray-300 rounded-b-xl"
      :class="{ 'bg-neutral-100 dark:bg-neutral-800': true }"
    >
      <div class="tool-buttons flex gap-2">
        <button
          class="flex items-center justify-center p-2 border border-gray-300 rounded hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-amber-400"
          :class="{ 'bg-neutral-100 dark:bg-neutral-800': true }"
          @click="setTool('pencil')"
        >
          <v-remixicon name="riBallPenLine" />
        </button>
        <button
          class="flex items-center justify-center p-2 border border-gray-300 rounded hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-amber-400"
          :class="{ 'bg-neutral-100 dark:bg-neutral-800': true }"
          @click="setTool('eraser')"
        >
          <v-remixicon name="riEraserLine" />
        </button>
        <button
          class="flex items-center justify-center p-2 border border-gray-300 rounded hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-amber-400"
          :class="{ 'bg-neutral-100 dark:bg-neutral-800': true }"
          @click="setTool('highlighter')"
        >
          <v-remixicon name="riMarkPenLine" />
        </button>
      </div>
      <div class="right-controls flex gap-2">
        <button
          class="flex items-center justify-center p-2 border border-gray-300 rounded hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-amber-400 disabled:opacity-50"
          :class="{ 'bg-neutral-100 dark:bg-neutral-800': true }"
          :disabled="!canUndo"
          @click="undo"
        >
          <v-remixicon name="riArrowGoBackLine" />
        </button>
        <button
          class="flex items-center justify-center p-2 border border-gray-300 rounded hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-amber-400 disabled:opacity-50"
          :class="{ 'bg-neutral-100 dark:bg-neutral-800': true }"
          :disabled="!canRedo"
          @click="redo"
        >
          <v-remixicon name="riArrowGoForwardLine" />
        </button>
        <button
          class="flex items-center justify-center p-2 border border-gray-300 rounded hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-amber-400"
          :class="{ 'bg-neutral-100 dark:bg-neutral-800': true }"
          @click="setSize('thin')"
        >
          <svg
            width="24"
            height="24"
            viewBox="0 0 24 24"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
            class="stroke-current fill-current"
            :class="{
              'text-black fill-black': !isDarkMode,
              'text-white fill-white': isDarkMode,
            }"
          >
            <rect x="2" y="11" width="20" height="2" rx="1" />
          </svg>
        </button>
        <button
          class="flex items-center justify-center p-2 border border-gray-300 rounded hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-amber-400"
          :class="{ 'bg-neutral-100 dark:bg-neutral-800': true }"
          @click="setSize('small')"
        >
          <svg
            width="24"
            height="24"
            viewBox="0 0 24 24"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
            class="stroke-current fill-current"
            :class="{
              'text-black fill-black': !isDarkMode,
              'text-white fill-white': isDarkMode,
            }"
          >
            <rect x="2" y="10" width="20" height="5" rx="2.5" />
          </svg>
        </button>
        <button
          class="flex items-center justify-center p-2 border border-gray-300 rounded hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-amber-400"
          :class="{ 'bg-neutral-100 dark:bg-neutral-800': true }"
          @click="setSize('thick')"
        >
          <svg
            width="24"
            height="24"
            viewBox="0 0 24 24"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
            class="stroke-current fill-current"
            :class="{
              'text-black fill-black': !isDarkMode,
              'text-white fill-white': isDarkMode,
            }"
          >
            <rect x="2" y="8" width="20" height="8" rx="4" />
          </svg>
        </button>
        <label
          class="flex items-center justify-center rounded-full"
          :class="{ 'bg-neutral-100 dark:bg-neutral-800': true }"
        >
          <input
            v-model="color"
            type="color"
            class="absolute opacity-0 cursor-pointer w-0 h-0"
          />
          <div
            :style="{ backgroundColor: color }"
            class="w-8 h-8 rounded-full border border-gray-300 cursor-pointer focus:outline-none focus:ring-2 focus:ring-amber-400"
          ></div>
        </label>
      </div>
    </div>
  </node-view-wrapper>
</template>

<script>
import { nodeViewProps, NodeViewWrapper } from '@tiptap/vue-3';
import * as d3 from 'd3';
import { useTheme } from '@/composable/theme';
import { v4 as uuid } from 'uuid';

const { currentTheme } = useTheme();

export default {
  // eslint-disable-next-line vue/multi-word-component-names
  name: 'Paper',
  components: { NodeViewWrapper },
  props: nodeViewProps,
  data() {
    return {
      color: '#000000',
      size: 5,
      svg: null,
      path: null,
      points: [],
      drawing: false,
      id: uuid(),
      svgHeight: this.node.attrs.height || 400,
      svgWidth: 500,
      isResizing: false,
      startY: 0,
      tool: 'pencil', // Default tool
      lastSize: 5, // Track the last used size
      history: [],
      redoStack: [],
      selectedPaths: new Set(), // To keep track of selected paths for erasing
    };
  },
  computed: {
    canUndo() {
      return this.history.length > 0;
    },
    canRedo() {
      return this.redoStack.length > 0;
    },
    isDarkMode() {
      return currentTheme.value === 'dark';
    },
  },
  mounted() {
    this.svg = d3.select(this.$refs.canvas);
    this.svg
      .on('mousedown touchstart', this.onStartDrawing)
      .on('mouseup touchend mouseleave touchleave', this.onEndDrawing);
    this.loadSavedAttributes();
  },
  methods: {
    setTool(tool) {
      this.tool = tool;
      if (tool === 'highlighter') {
        this.color = '#FFFF00'; // Highlighter color
        this.size = 10;
      } else if (tool === 'pencil') {
        this.color = this.isDarkMode ? '#FFFFFF' : '#000000'; // Pen color
        this.size = this.lastSize;
      } else if (tool === 'eraser') {
        this.color = '#f1f3f5'; // Eraser color
        this.size = 10;
      }
    },
    setSize(size) {
      const sizes = {
        thin: 2,
        small: 5,
        thick: 8,
      };
      this.lastSize = this.size;
      this.size = sizes[size] || 5;
    },
    onStartDrawing(event) {
      this.drawing = true;
      this.points = [];
      this.path = this.svg
        .append('path')
        .data([this.points])
        .attr('id', `id-${this.id}`)
        .attr('stroke', this.color)
        .attr('stroke-width', this.size)
        .attr('fill', this.tool === 'highlighter' ? this.color : 'none')
        .attr('opacity', this.tool === 'highlighter' ? 0.3 : 1); // Highlighter opacity

      if (this.tool === 'eraser') {
        this.svg.selectAll('path').each((d, i, nodes) => {
          const pathElement = d3.select(nodes[i]);
          const pathBounds = pathElement.node().getBBox();
          const [x, y] = d3.pointers(event)[0];
          if (
            x >= pathBounds.x &&
            x <= pathBounds.x + pathBounds.width &&
            y >= pathBounds.y &&
            y <= pathBounds.y + pathBounds.height
          ) {
            this.selectedPaths.add(pathElement.attr('id'));
          }
        });
      }

      const moveEvent = event.type === 'mousedown' ? 'mousemove' : 'touchmove';
      this.svg.on(moveEvent, this.onMove);
    },
    onMove(event) {
      event.preventDefault();
      if (this.tool === 'eraser') {
        const [x, y] = d3.pointers(event)[0];
        this.svg.selectAll('path').each((d, i, nodes) => {
          const pathElement = d3.select(nodes[i]);
          const pathBounds = pathElement.node().getBBox();
          if (
            x >= pathBounds.x &&
            x <= pathBounds.x + pathBounds.width &&
            y >= pathBounds.y &&
            y <= pathBounds.y + pathBounds.height
          ) {
            this.selectedPaths.add(pathElement.attr('id'));
          }
        });
      } else {
        this.points.push(d3.pointers(event)[0]);
        this.tick();
      }
    },
    onEndDrawing() {
      if (!this.drawing) return;
      this.drawing = false;

      if (this.tool === 'eraser') {
        this.eraseSelectedPaths();
      } else {
        // Update the line list with the new drawing
        this.history.push({ lines: this.node.attrs.lines });
        this.redoStack = [];
        const updatedLines = this.node.attrs.lines.filter(
          (item) => item.id !== this.id
        );
        this.updateAttributes({
          lines: [
            ...updatedLines,
            {
              id: this.id,
              color: this.color,
              size: this.size,
              path: this.path.attr('d'),
              tool: this.tool,
            },
          ],
          height: this.svgHeight, // Save height attribute
        });

        this.svg.select(`#id-${this.id}`).remove();
        this.id = uuid();
      }
      this.svg.on('mousemove touchmove', null);
      this.selectedPaths.clear(); // Clear selected paths after drawing
    },
    eraseSelectedPaths() {
      this.selectedPaths.forEach((pathId) => {
        this.svg.select(`#${pathId}`).remove();
      });

      // Update the node with remaining lines
      const remainingLines = this.node.attrs.lines.filter(
        (line) => !this.selectedPaths.has(`id-${line.id}`)
      );
      this.updateAttributes({ lines: remainingLines, height: this.svgHeight });
    },
    tick() {
      requestAnimationFrame(() => {
        const path = d3.line().curve(d3.curveBasis)(this.points);
        this.path.attr('d', path);
      });
    },
    clear() {
      this.history.push({ lines: this.node.attrs.lines });
      this.redoStack = [];
      this.updateAttributes({ lines: [], height: this.svgHeight }); // Save height
    },
    startResize(event) {
      this.isResizing = true;
      this.startY = event.clientY;
      document.addEventListener('mousemove', this.onResize);
      document.addEventListener('mouseup', this.stopResize);
    },
    onResize(event) {
      if (this.isResizing) {
        const deltaY = event.clientY - this.startY;
        this.svgHeight = Math.max(100, this.svgHeight + deltaY);
        this.startY = event.clientY;

        // Save height during resize
        this.saveHeight();
      }
    },
    stopResize() {
      this.isResizing = false;
      document.removeEventListener('mousemove', this.onResize);
      document.removeEventListener('mouseup', this.stopResize);
    },
    saveHeight() {
      this.updateAttributes({ height: this.svgHeight });
    },
    loadSavedAttributes() {
      if (this.node.attrs.height) {
        this.svgHeight = this.node.attrs.height;
      }
      if (this.node.attrs.lines && this.node.attrs.lines.length > 0) {
        const lastLine =
          this.node.attrs.lines[this.node.attrs.lines.length - 1];
        if (lastLine) {
          this.size = lastLine.size; // Load saved size
          this.color = lastLine.color; // Load saved color
        }
      }
    },
    undo() {
      if (this.canUndo) {
        const lastState = this.history.pop();
        this.redoStack.push({ lines: this.node.attrs.lines });
        this.updateAttributes(lastState);
      }
    },
    redo() {
      if (this.canRedo) {
        const redoState = this.redoStack.pop();
        this.history.push({ lines: this.node.attrs.lines });
        this.updateAttributes(redoState);
      }
    },
  },
};
</script>

<style lang="scss">
.draw {
  .drawing-container {
    @apply rounded-xl;
    position: relative;
    display: flex;
    flex-direction: column;

    svg {
      @apply bg-neutral-100 dark:bg-neutral-800 rounded-t-xl;
      cursor: crosshair;
      overflow: hidden;
    }

    path {
      fill: none;
      stroke-linecap: round;
      stroke-linejoin: round;
    }
  }
}
</style>
