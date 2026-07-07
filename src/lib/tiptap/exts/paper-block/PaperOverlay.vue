<template>
  <OverlayPortal @close="handleCancel">
    <div
      ref="overlayRef"
      class="fullscreen-draw flex flex-col h-full bg-white dark:bg-neutral-900"
      tabindex="-1"
      @keydown="handleKeyDown"
      @keyup="handleKeyUp"
    >
      <!-- Top bar -->
      <div
        class="flex items-center justify-between px-4 py-2 border-b border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 shrink-0 z-10"
      >
        <span
          class="text-sm font-medium text-neutral-700 dark:text-neutral-300"
        >
          Drawing
        </span>
        <div class="flex items-center gap-1.5">
          <button
            type="button"
            class="p-1.5 rounded hover:bg-neutral-100 dark:hover:bg-neutral-700 text-neutral-600 dark:text-neutral-400 transition-colors"
            title="Zoom out"
            @pointerdown.stop.prevent="zoomOut"
          >
            <svg
              viewBox="0 0 16 16"
              class="w-4 h-4"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
            >
              <line x1="4" y1="8" x2="12" y2="8" />
            </svg>
          </button>
          <span
            class="text-xs w-12 text-center font-mono text-neutral-600 dark:text-neutral-400 select-none"
          >
            {{ zoomPercent }}
          </span>
          <button
            type="button"
            class="p-1.5 rounded hover:bg-neutral-100 dark:hover:bg-neutral-700 text-neutral-600 dark:text-neutral-400 transition-colors"
            title="Zoom in"
            @pointerdown.stop.prevent="zoomIn"
          >
            <svg
              viewBox="0 0 16 16"
              class="w-4 h-4"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
            >
              <line x1="8" y1="4" x2="8" y2="12" />
              <line x1="4" y1="8" x2="12" y2="8" />
            </svg>
          </button>
          <button
            type="button"
            class="text-xs px-2 py-1 rounded hover:bg-neutral-100 dark:hover:bg-neutral-700 text-neutral-500 dark:text-neutral-400 transition-colors"
            :class="{ '!text-primary': zoomPercent !== '100%' }"
            @pointerdown.stop.prevent="resetZoom"
          >
            Reset
          </button>
          <span
            class="w-px h-5 bg-neutral-300 dark:bg-neutral-600 mx-1.5 shrink-0"
          />
          <button
            type="button"
            class="text-sm px-3 py-1.5 bg-primary text-white rounded-lg transition-colors font-medium"
            @pointerdown.stop.prevent="handleDone"
          >
            Done
          </button>
        </div>
      </div>

      <!-- Canvas -->
      <div
        class="flex-1 overflow-hidden relative bg-neutral-50 dark:bg-neutral-950"
      >
        <DrawMode
          ref="drawModeRef"
          :node="localNode"
          :interactive="true"
          :zoom-enabled="true"
          @update-attributes="handleDrawModeUpdate"
          @toolbar-state="handleToolbarState"
        />
      </div>

      <!-- Toolbar -->
      <PaperToolbar
        :toolbar-state="toolbarState"
        :tools="tools"
        :paper-types="paperTypes"
        :current-tool-color="currentToolColor"
        :current-tool-size="currentToolSize"
        :active-presets="activePresets"
        @tool="setTool"
        @color="applyPreset"
        @color-input="onColorInput"
        @save-preset="savePreset"
        @size="onSize"
        @bg="setBackground"
        @image="insertImage"
        @delete="deleteSelection"
      />
    </div>
  </OverlayPortal>
</template>

<script>
import { computed, ref, onMounted, onUnmounted } from 'vue';
import { useStore } from '@/store';
import OverlayPortal from '@/components/ui/OverlayPortal.vue';
import DrawMode from './DrawMode.vue';
import PaperToolbar from './PaperToolbar.vue';
import { cloneDrawingToolDefaults } from './helpers/drawHelper.js';
import {
  setScribbleSuppressed,
  clearScribbleSuppressed,
} from '@/lib/native/scribble';

const PRESETS_KEY = 'beaver-paper-presets';
const DEFAULT_PRESETS = {
  pen: ['#1a1a1a', '#e53e3e', '#3182ce', '#38a169', '#805ad5'],
  highlighter: ['#fbbf24', '#34d399', '#60a5fa', '#f472b6', '#a78bfa'],
};

function loadPresets() {
  try {
    const r = localStorage.getItem(PRESETS_KEY);
    if (r) return { ...DEFAULT_PRESETS, ...JSON.parse(r) };
  } catch {}
  return { ...DEFAULT_PRESETS };
}
function savePresetsFn(p) {
  try {
    localStorage.setItem(PRESETS_KEY, JSON.stringify(p));
  } catch {}
}

export default {
  name: 'PaperOverlay',
  components: { OverlayPortal, DrawMode, PaperToolbar },
  props: {
    initialAttrs: { type: Object, required: true },
  },
  emits: ['close', 'update-attributes'],
  setup(props, { emit }) {
    const store = useStore();

    const drawModeRef = ref(null);
    const overlayRef = ref(null);
    const scribbleScope = `paper-overlay-${Math.random()
      .toString(36)
      .slice(2, 8)}`;
    const defaultSettings = cloneDrawingToolDefaults();

    const localNode = computed(() => ({
      attrs: {
        linesV2: props.initialAttrs.linesV2 ?? [],
        lines: props.initialAttrs.lines ?? [],
        height: props.initialAttrs.height ?? 400,
        paperType: props.initialAttrs.paperType ?? 'plain',
      },
    }));

    const presets = ref(loadPresets());
    const spaceHeld = ref(false);

    const toolbarState = ref({
      tool: 'pen',
      penSettings: { ...defaultSettings.pen },
      pencilSettings: { color: '#4a4a4a', size: 3 },
      fountainSettings: { color: '#1a2744', size: 5 },
      highlighterSettings: { ...defaultSettings.highlighter },
      eraserSettings: { ...defaultSettings.eraser },
      undoDepth: 0,
      redoDepth: 0,
      background: props.initialAttrs.paperType ?? 'plain',
      hasSelection: false,
    });

    const tools = computed(() => [
      {
        id: 'pen',
        label: 'Pen',
        hasSwatch: true,
        _color: toolbarState.value.penSettings?.color ?? '#1a1a1a',
      },
      {
        id: 'pencil',
        label: 'Pencil',
        hasSwatch: true,
        _color: toolbarState.value.pencilSettings?.color ?? '#4a4a4a',
      },
      {
        id: 'fountain',
        label: 'Fountain',
        hasSwatch: true,
        _color: toolbarState.value.fountainSettings?.color ?? '#1a2744',
      },
      {
        id: 'highlighter',
        label: 'Highlighter',
        hasSwatch: true,
        _color: toolbarState.value.highlighterSettings?.color ?? '#fbbf24',
      },
      { id: 'eraser', label: 'Eraser', hasSwatch: false, _color: null },
      { id: 'lasso', label: 'Lasso', hasSwatch: false, _color: null },
    ]);
    const paperTypes = ['plain', 'grid', 'ruled', 'dotted'];

    const activePresets = computed(() => {
      const t = toolbarState.value.tool;
      return presets.value[t] ?? presets.value.pen ?? DEFAULT_PRESETS.pen;
    });

    const currentToolColor = computed(() => {
      const ts = toolbarState.value;
      if (ts.tool === 'highlighter')
        return ts.highlighterSettings?.color ?? '#fbbf24';
      if (ts.tool === 'pencil') return ts.pencilSettings?.color ?? '#4a4a4a';
      if (ts.tool === 'fountain')
        return ts.fountainSettings?.color ?? '#1a2744';
      return ts.penSettings?.color ?? '#1a1a1a';
    });

    const currentToolSize = computed(() => {
      const ts = toolbarState.value;
      if (ts.tool === 'highlighter') return ts.highlighterSettings?.size ?? 16;
      if (ts.tool === 'eraser') return ts.eraserSettings?.size ?? 20;
      if (ts.tool === 'pencil') return ts.pencilSettings?.size ?? 3;
      if (ts.tool === 'fountain') return ts.fountainSettings?.size ?? 5;
      return ts.penSettings?.size ?? 4;
    });

    const zoomPercent = computed(() => {
      const z = drawModeRef.value?.state?.zoom ?? 1;
      return `${Math.round(z * 100)}%`;
    });

    function handleToolbarState(s) {
      toolbarState.value = { ...toolbarState.value, ...s };
    }

    function setTool(t) {
      drawModeRef.value?.setTool(t);
    }

    function applyPreset(c) {
      drawModeRef.value?.setColor(c);
    }

    function onColorInput(c) {
      drawModeRef.value?.setColor(c);
    }

    function onSize(s) {
      drawModeRef.value?.setSize(s);
    }

    function setBackground(b) {
      drawModeRef.value?.setBackground(b);
    }

    function deleteSelection() {
      drawModeRef.value?.deleteSelection?.();
    }

    function insertImage() {
      const id = store.activeNoteId;
      if (id) drawModeRef.value?.insertImage?.(id);
    }

    function savePreset(color) {
      const tool = toolbarState.value.tool;
      if (
        tool !== 'pen' &&
        tool !== 'pencil' &&
        tool !== 'fountain' &&
        tool !== 'highlighter'
      )
        return;
      const list = [...(presets.value[tool] ?? DEFAULT_PRESETS[tool] ?? [])];
      if (!list.includes(color)) {
        list.splice(0, 1);
        list.push(color);
      }
      presets.value = { ...presets.value, [tool]: list };
      savePresetsFn(presets.value);
    }

    function zoomIn() {
      drawModeRef.value?.zoomIn();
    }

    function zoomOut() {
      drawModeRef.value?.zoomOut();
    }

    function resetZoom() {
      drawModeRef.value?.resetZoom();
    }

    function handleDone() {
      const dm = drawModeRef.value;
      if (dm) {
        const s = dm.state;
        emit('update-attributes', {
          linesV2: s.lines,
          height: s.height,
          paperType: s.background,
        });
      }
      emit('close');
    }

    function handleCancel() {
      emit('close');
    }

    function handleDrawModeUpdate() {}

    function handleKeyDown(e) {
      if (e.key === ' ' && !e.repeat) {
        e.preventDefault();
        spaceHeld.value = true;
      }
    }

    function handleKeyUp(e) {
      if (e.key === ' ') {
        spaceHeld.value = false;
      }
    }

    onMounted(() => {
      setScribbleSuppressed(scribbleScope, true);
      overlayRef.value?.focus();
    });

    onUnmounted(() => {
      clearScribbleSuppressed(scribbleScope);
    });

    return {
      drawModeRef,
      overlayRef,
      localNode,
      tools,
      paperTypes,
      toolbarState,
      currentToolColor,
      currentToolSize,
      activePresets,
      zoomPercent,
      handleToolbarState,
      setTool,
      applyPreset,
      onColorInput,
      onSize,
      setBackground,
      deleteSelection,
      insertImage,
      savePreset,
      zoomIn,
      zoomOut,
      resetZoom,
      handleDone,
      handleCancel,
      handleDrawModeUpdate,
      handleKeyDown,
      handleKeyUp,
    };
  },
};
</script>

<style scoped>
.fullscreen-draw {
  outline: none;
}
</style>
