<template>
  <node-view-wrapper class="draw">
    <div class="relative drawing-container">
      <svg
        ref="canvas"
        :viewBox="`0 0 ${svgWidth} ${svgHeight}`"
        preserveAspectRatio="xMidYMid meet"
        class="w-full h-auto border border-gray-300"
        :class="paperType"
      >
        <template v-for="item in node.attrs.lines" :key="item.id">
          <path
            v-if="item.id !== id"
            :id="`id-${item.id}`"
            :d="item.path"
            :stroke="
              isDarkMode
                ? item.color === '#000000'
                  ? '#FFFFFF'
                  : item.color
                : item.color
            "
            :stroke-width="item.size"
            :opacity="item.tool === 'highlighter' ? 0.3 : 1"
            fill="none"
          />
        </template>
      </svg>
      <div
        class="absolute bottom-0 w-full h-3 cursor-row-resize bg-neutral-200 dark:bg-neutral-700 border-r border-l border-gray-300 hover:bg-neutral-300 hover:dark:bg-neutral-600 hover:bg-opacity-60 flex items-center justify-center"
        @mousedown="startResize"
      >
        <div class="bg-neutral-400 rounded w-10 h-1"></div>
      </div>
    </div>
    <div
      class="p-4 flex flex-wrap justify-between items-center bg-gray-100 border border-gray-300 rounded-b-xl"
      :class="{ 'bg-neutral-100 dark:bg-neutral-800': true }"
    >
      <div class="tool-buttons flex flex-wrap gap-2">
        <button
          class="flex items-center justify-center p-2 border rounded hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-amber-400"
          :class="{
            'border-amber-400': tool === 'pencil',
            'bg-neutral-100 dark:bg-neutral-800 border-gray-300':
              tool !== 'pencil',
          }"
          @click="setTool('pencil')"
        >
          <v-remixicon name="riBallPenLine" />
        </button>

        <button
          class="flex items-center justify-center p-2 border rounded hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-amber-400"
          :class="{
            'border-amber-400': tool === 'highlighter',
            'bg-neutral-100 dark:bg-neutral-800 border-gray-300':
              tool !== 'highlighter',
          }"
          @click="setTool('highlighter')"
        >
          <v-remixicon name="riMarkPenLine" />
        </button>

        <button
          class="flex items-center justify-center p-2 border rounded hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-amber-400"
          :class="{
            'bg-amber-100 dark:bg-amber-700 border-amber-400':
              tool === 'eraser',
            'bg-neutral-100 dark:bg-neutral-800 border-gray-300':
              tool !== 'eraser',
          }"
          @click="setTool('eraser')"
        >
          <v-remixicon name="riEraserLine" />
        </button>
        <!-- Dropdown for Paper Type -->
        <select
          v-model="paperType"
          class="border border-gray-300 rounded p-2 bg-neutral-100 dark:bg-neutral-800"
          @change="changePaperType"
        >
          <option value="plain">{{ translations.paper.plain || '-' }}</option>
          <option value="grid">{{ translations.paper.grid || '-' }}</option>
          <option value="ruled">{{ translations.paper.ruled || '-' }}</option>
          <option value="dotted">{{ translations.paper.dotted || '-' }}</option>
        </select>
      </div>

      <div class="right-controls flex flex-wrap gap-2 mt-4 lg:mt-0">
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
          class="flex items-center justify-center bg-neutral-100 dark:bg-neutral-800 p-2 border rounded hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-amber-400"
          :class="{
            'border-amber-400': size === 2,
            'border-gray-300': size !== 2,
          }"
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
          class="flex items-center justify-center bg-neutral-100 dark:bg-neutral-800 p-2 border rounded hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-amber-400"
          :class="{
            'border-amber-400': size === 5,
            'border-gray-300': size !== 5,
          }"
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
          class="flex items-center bg-neutral-100 dark:bg-neutral-800 justify-center p-2 border rounded hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-amber-400"
          :class="{
            'border-amber-400': size === 8,
            'border-gray-300': size !== 8,
          }"
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
import { shallowReactive, onMounted } from 'vue';
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
  setup() {
    const translations = shallowReactive({
      paper: {
        plain: 'paper.plain',
        grid: 'paper.grid',
        ruled: 'paper.ruled',
        dotted: 'paper.dotted',
      },
    });

    onMounted(async () => {
      // Load translations
      const loadedTranslations = await loadTranslations();
      if (loadedTranslations) {
        Object.assign(translations, loadedTranslations);
      }
    });

    const loadTranslations = async () => {
      const selectedLanguage = localStorage.getItem('selectedLanguage') || 'en';
      try {
        const translationModule = await import(
          `../../../../pages/settings/locales/${selectedLanguage}.json`
        );
        return translationModule.default;
      } catch (error) {
        console.error('Error loading translations:', error);
        return null;
      }
    };

    return {
      translations,
    };
  },
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
      tool: 'pencil',
      lastSize: 5,
      history: [],
      redoStack: [],
      selectedPaths: new Set(),
      selectionRect: { x: 0, y: 0, width: 0, height: 0 },
      showSelectionRect: false,
      paperType: this.node.attrs.paperType || 'plain', // Load saved paper type
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
      const prefersDarkScheme = window.matchMedia(
        '(prefers-color-scheme: dark)'
      ).matches;
      return prefersDarkScheme || currentTheme.value === 'dark';
    },
  },
  mounted() {
    this.svg = d3.select(this.$refs.canvas);
    this.svg
      .on('mousedown touchstart', this.onStartDrawing)
      .on('mouseup touchend mouseleave touchleave', this.onEndDrawing);
    this.loadSavedAttributes();
    this.applyPaperType();
  },
  methods: {
    changePaperType() {
      this.node.attrs.paperType = this.paperType; // Save the paper type to node.attrs
      this.applyPaperType();
      this.updateAttributes({ paperType: this.paperType });
    },
    applyPaperType() {
      const canvas = this.$refs.canvas;
      canvas.classList.remove('grid', 'ruled', 'dotted');
      if (this.paperType !== 'plain') {
        canvas.classList.add(this.paperType);
      }
    },
    setTool(tool) {
      this.tool = tool;
      if (tool === 'highlighter') {
        this.color = '#FFFF00';
        this.size = 10;
      } else if (tool === 'pencil') {
        this.color = this.isDarkMode ? '#FFFFFF' : '#000000';
        this.size = this.lastSize;
      } else if (tool === 'eraser') {
        this.color = '#f1f3f5';
        this.size = 10;
      }
    },
    setSize(size) {
      const sizes = { thin: 2, small: 5, thick: 8 };
      this.lastSize = this.size;
      this.size = sizes[size] || 5;
    },
    onStartDrawing(event) {
      this.drawing = true;
      this.points = [];
      this.path = null;

      if (this.tool === 'eraser') {
        const [x, y] = d3.pointers(event)[0];
        const pathElement = d3
          .select(document.elementFromPoint(x, y))
          .closest('path');

        if (pathElement) {
          const pathId = pathElement.getAttribute('id');
          if (pathId) {
            this.eraseSinglePath(pathId);
          }
        }

        this.svg.on('mousemove touchmove', null); // Disable move event for direct click erasing
      } else {
        this.path = this.svg
          .append('path')
          .data([this.points])
          .attr('id', `id-${this.id}`)
          .attr('stroke', this.color)
          .attr('stroke-width', this.size)
          .attr('fill', this.tool === 'highlighter' ? this.color : 'none')
          .attr('opacity', this.tool === 'highlighter' ? 0.3 : 1);

        this.svg.on(
          event.type === 'mousedown' ? 'mousemove' : 'touchmove',
          this.onMove
        );
      }
    },
    eraseSinglePath(pathId) {
      this.node.attrs.lines = this.node.attrs.lines.filter(
        (line) => line.id !== pathId.replace('id-', '')
      );
      this.updateAttributes({
        lines: this.node.attrs.lines,
        height: this.svgHeight,
      });
    },
    isPointOnPath(x, y, pathElement) {
      const canvas = document.createElement('canvas');
      const context = canvas.getContext('2d');
      context.fillStyle = 'rgba(0,0,0,0)';
      context.fill(new Path2D(pathElement.getAttribute('d')));

      return context.isPointInPath(x, y);
    },
    onMove(event) {
      event.preventDefault();
      if (this.tool === 'eraser') {
        if (this.showSelectionRect) {
          const [x, y] = d3.pointers(event)[0];
          this.selectionRect.width = x - this.selectionRect.x;
          this.selectionRect.height = y - this.selectionRect.y;
        }
      } else {
        this.points.push(d3.pointers(event)[0]);
        this.tick();
      }
    },
    onEndDrawing() {
      if (!this.drawing) return;
      this.drawing = false;

      if (this.tool === 'eraser') {
        // No need to handle undo/redo for single path erase directly
      } else {
        // Save the current state for undo
        this.history.push({ lines: [...this.node.attrs.lines] });

        // Clear redo stack since a new action is being recorded
        this.redoStack = [];

        const updatedLines = this.node.attrs.lines.filter(
          (item) => item.id !== this.id
        );

        // Add the new path to the lines
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
          height: this.svgHeight,
        });

        // Clear the temporary path and reset ID for the next action
        this.svg.select(`#id-${this.id}`).remove();
        this.id = uuid();
      }

      this.svg.on('mousemove touchmove', null);
      this.selectedPaths.clear();
    },
    erasePathsWithinSelection() {
      const remainingLines = [];
      this.node.attrs.lines.forEach((line) => {
        const pathElement = this.svg.select(`#id-${line.id}`).node();
        const pathBounds = pathElement.getBBox();
        const rectBounds = this.selectionRect;

        if (
          !(
            pathBounds.x < rectBounds.x + rectBounds.width &&
            pathBounds.x + pathBounds.width > rectBounds.x &&
            pathBounds.y < rectBounds.y + rectBounds.height &&
            pathBounds.y + pathBounds.height > rectBounds.y
          )
        ) {
          remainingLines.push(line);
        } else {
          this.selectedPaths.add(`id-${line.id}`);
        }
      });
      this.updateAttributes({ lines: remainingLines, height: this.svgHeight });
    },
    tick() {
      requestAnimationFrame(() => {
        const path = d3.line().curve(d3.curveBasis)(this.points);
        this.path.attr('d', path);
      });
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
          this.size = lastLine.size;
          this.color = lastLine.color;
        }
      }
    },
    undo() {
      if (this.canUndo) {
        // Save the current state to redoStack before undoing
        this.redoStack.push({ lines: [...this.node.attrs.lines] });

        // Get the last state from the history
        const lastState = this.history.pop();

        // Update the current state with the last state from history
        this.updateAttributes({
          lines: lastState.lines,
          height: this.svgHeight,
        });
      }
    },
    redo() {
      if (this.canRedo) {
        // Save the current state to history before redoing
        this.history.push({ lines: [...this.node.attrs.lines] });

        // Get the last state from the redo stack
        const redoState = this.redoStack.pop();

        // Update the current state with the redo state
        this.updateAttributes({
          lines: redoState.lines,
          height: this.svgHeight,
        });
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

      &.grid {
        /* Light mode grid */
        background-image: url('data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 20 20"%3E%3Cpath fill="none" stroke="%23ccc" stroke-width="0.5" d="M20 0v20H0"%3E%3C/path%3E%3C/svg%3E');
      }

      &.ruled {
        background-image: linear-gradient(transparent 95%, #ccc 5%);
        background-size: 100% 20px;
      }

      &.dotted {
        background-image: radial-gradient(#ccc 1px, transparent 1px);
        background-size: 20px 20px;
      }

      /* Dark mode grid using Tailwind's `dark:` variant */
      .dark &.grid {
        background-image: url('data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 20 20"%3E%3Cpath fill="none" stroke="%23666" stroke-width="0.5" d="M20 0v20H0"%3E%3C/path%3E%3C/svg%3E');
      }

      .dark &.ruled {
        background-image: linear-gradient(transparent 95%, #666 5%);
        background-size: 100% 20px;
      }

      .dark &.dotted {
        background-image: radial-gradient(#666 1px, transparent 1px);
        background-size: 20px 20px;
      }
    }

    path {
      fill: none;
      stroke-linecap: round;
      stroke-linejoin: round;
    }
  }
}
</style>
