<template>
  <NodeViewWrapper
    ref="wrapperRef"
    class="paper-node"
    :class="{ 'is-active': selected, 'is-editing': isEditing }"
    :contenteditable="false"
    tabindex="0"
    role="group"
    aria-label="Drawing"
    @keydown.esc="exitEditing"
    @keydown.enter.self="enterEditing"
  >
    <div
      class="paper-card relative overflow-hidden rounded-[24px] border border-neutral-200/80 bg-white dark:border-neutral-700/60 dark:bg-neutral-900"
      @click="enterEditing"
    >
      <DrawMode
        ref="drawModeRef"
        :node="node"
        :interactive="isEditing"
        :zoom-enabled="false"
        @update-attributes="handleDrawModeUpdate"
        @toolbar-state="handleToolbarState"
      />

      <div
        v-if="!isEditing"
        class="preview-overlay absolute inset-0 flex items-center justify-center rounded-[24px]"
        :class="{ 'is-empty': !hasContent }"
      >
        <span
          class="preview-hint px-4 py-2 rounded-full text-sm font-medium bg-white/90 dark:bg-neutral-800/90 text-neutral-600 dark:text-neutral-300"
        >
          {{
            hasContent
              ? translations.paperBlock?.editDrawing || 'Edit drawing'
              : translations.paperBlock?.startDrawing || 'Start drawing'
          }}
        </span>
      </div>
    </div>

    <PaperToolbar
      v-if="isEditing && selected"
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
      @undo="undo"
      @redo="redo"
      @delete="deleteSelection"
    />
  </NodeViewWrapper>
</template>

<script>
import { computed, onUnmounted, ref, watch } from 'vue';
import { NodeViewWrapper, nodeViewProps } from '@tiptap/vue-3';
import { useStore } from '@/store';
import { useTranslations } from '@/composable/useTranslations';
import {
  setScribbleSuppressed,
  clearScribbleSuppressed,
} from '@/lib/native/scribble';
import { setPaperEditing } from './helpers/paperEditing.js';
import DrawMode from './DrawMode.vue';
import PaperToolbar from './PaperToolbar.vue';
import {
  TOOL_SETTINGS_KEY,
  cloneDrawingToolDefaults,
} from './helpers/drawHelper.js';

const PRESETS_KEY = 'beaver-paper-presets';
const PRESET_COUNT = 5;
const DEFAULT_PRESETS = {
  pen: ['#1a1a1a', '#e53e3e', '#3182ce', '#38a169', '#805ad5'],
  pencil: ['#4a4a4a', '#78716c', '#2563eb', '#b45309', '#15803d'],
  fountain: ['#1a2744', '#0f172a', '#7f1d1d', '#065f46', '#4c1d95'],
  highlighter: ['#fbbf24', '#34d399', '#60a5fa', '#f472b6', '#a78bfa'],
};
const PRESET_TOOLS = Object.keys(DEFAULT_PRESETS);

function loadPresets() {
  try {
    const stored = JSON.parse(localStorage.getItem(PRESETS_KEY) ?? 'null');
    if (stored && typeof stored === 'object') {
      const merged = { ...DEFAULT_PRESETS };
      for (const tool of PRESET_TOOLS) {
        // Ignore malformed or truncated palettes saved by older versions.
        if (Array.isArray(stored[tool]) && stored[tool].length === PRESET_COUNT)
          merged[tool] = stored[tool];
      }
      return merged;
    }
  } catch {}
  return { ...DEFAULT_PRESETS };
}
function savePresetsFn(p) {
  try {
    localStorage.setItem(PRESETS_KEY, JSON.stringify(p));
  } catch {}
}

export default {
  name: 'PaperBlock',
  components: { DrawMode, NodeViewWrapper, PaperToolbar },
  props: nodeViewProps,
  setup(props) {
    const store = useStore();
    const { translations } = useTranslations();
    const wrapperRef = ref(null);
    const drawModeRef = ref(null);
    const isEditing = ref(false);
    const scribbleScope = `paper-${Math.random().toString(36).slice(2, 8)}`;
    const defaultSettings = cloneDrawingToolDefaults();
    const presets = ref(loadPresets());

    const hasContent = computed(() => {
      const lines = props.node.attrs.linesV2 ?? props.node.attrs.lines ?? [];
      return Array.isArray(lines) && lines.length > 0;
    });

    const toolbarState = ref({
      tool: 'pen',
      penSettings: { ...defaultSettings.pen },
      pencilSettings: { ...defaultSettings.pencil },
      fountainSettings: { ...defaultSettings.fountain },
      highlighterSettings: { ...defaultSettings.highlighter },
      eraserSettings: { ...defaultSettings.eraser },
      undoDepth: 0,
      redoDepth: 0,
      background: props.node.attrs.paperType ?? 'dotted',
      hasSelection: false,
    });

    const tools = computed(() => {
      const ts = toolbarState.value;
      const paperLabels = translations.value.paperBlock ?? {};
      const swatch = (id, label) => ({
        id,
        label,
        hasSwatch: true,
        _color: ts[TOOL_SETTINGS_KEY[id]]?.color ?? defaultSettings[id].color,
      });
      return [
        swatch('pen', paperLabels.pen || 'Pen'),
        swatch('pencil', paperLabels.pencil || 'Pencil'),
        swatch('fountain', paperLabels.fountainPen || 'Fountain pen'),
        swatch('highlighter', paperLabels.highlighter || 'Highlighter'),
        {
          id: 'eraser',
          label: paperLabels.eraser || 'Eraser',
          hasSwatch: false,
          _color: null,
        },
        {
          id: 'lasso',
          label: paperLabels.lassoSelect || 'Lasso select',
          hasSwatch: false,
          _color: null,
        },
      ];
    });
    const paperTypes = ['plain', 'grid', 'ruled', 'dotted'];

    const activeSettings = computed(
      () =>
        toolbarState.value[TOOL_SETTINGS_KEY[toolbarState.value.tool]] ??
        toolbarState.value.penSettings
    );
    const activePresets = computed(
      () => presets.value[toolbarState.value.tool] ?? DEFAULT_PRESETS.pen
    );
    const currentToolColor = computed(
      () => activeSettings.value.color ?? defaultSettings.pen.color
    );
    const currentToolSize = computed(
      () => activeSettings.value.size ?? defaultSettings.pen.size
    );

    function enterEditing() {
      if (isEditing.value) return;
      // ponytail: touch taps don't node-select like desktop clicks; select explicitly so the toolbar gate holds
      try {
        props.editor?.commands?.setNodeSelection?.(props.getPos?.());
      } catch {}
      isEditing.value = true;
    }
    function exitEditing() {
      isEditing.value = false;
    }
    watch(
      () => props.selected,
      (sel) => {
        if (!sel) isEditing.value = false;
      }
    );
    watch(isEditing, (editing) => {
      setScribbleSuppressed(scribbleScope, editing);
      setPaperEditing(scribbleScope, editing);
    });
    onUnmounted(() => {
      clearScribbleSuppressed(scribbleScope);
      setPaperEditing(scribbleScope, false);
    });

    function handleToolbarState(s) {
      toolbarState.value = { ...toolbarState.value, ...s };
    }
    function handleDrawModeUpdate(attrs) {
      props.updateAttributes(attrs);
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
    function undo() {
      drawModeRef.value?.undo?.();
    }
    function redo() {
      drawModeRef.value?.redo?.();
    }
    function insertImage() {
      const id = store.activeNoteId;
      if (id) drawModeRef.value?.insertImage?.(id);
    }
    function savePreset(color) {
      const tool = toolbarState.value.tool;
      if (!PRESET_TOOLS.includes(tool)) return;
      const list = [...(presets.value[tool] ?? DEFAULT_PRESETS[tool])];
      if (list.includes(color)) return;
      // Newest colour goes last; the oldest one drops off the front.
      list.shift();
      list.push(color);
      presets.value = { ...presets.value, [tool]: list };
      savePresetsFn(presets.value);
    }

    return {
      wrapperRef,
      drawModeRef,
      isEditing,
      hasContent,
      translations,
      toolbarState,
      tools,
      paperTypes,
      activePresets,
      currentToolColor,
      currentToolSize,
      enterEditing,
      exitEditing,
      handleToolbarState,
      handleDrawModeUpdate,
      setTool,
      applyPreset,
      onColorInput,
      onSize,
      setBackground,
      deleteSelection,
      undo,
      redo,
      insertImage,
      savePreset,
    };
  },
};
</script>

<style scoped>
.paper-node {
  position: relative;
  outline: none;
}

.paper-card {
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.04), 0 8px 30px rgba(0, 0, 0, 0.08);
  transition: border-color 0.2s ease, box-shadow 0.2s ease;
}

.dark .paper-card {
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.3), 0 8px 30px rgba(0, 0, 0, 0.35);
}

.is-active .paper-card {
  border-color: rgba(0, 0, 0, 0.25);
}

.dark .is-active .paper-card {
  border-color: rgba(255, 255, 255, 0.3);
}

/* Editing: same indigo accent as the lasso/selection UI. */
.is-editing .paper-card,
.dark .is-editing .paper-card {
  border-color: rgba(99, 102, 241, 0.55);
  box-shadow: 0 0 0 3px rgba(99, 102, 241, 0.14),
    0 12px 40px rgba(0, 0, 0, 0.1);
}

.paper-node:focus-visible .paper-card {
  border-color: rgba(99, 102, 241, 0.7);
  box-shadow: 0 0 0 3px rgba(99, 102, 241, 0.25);
}

.preview-overlay {
  opacity: 0;
  pointer-events: none;
  transition: opacity 0.2s ease;
  background: rgba(0, 0, 0, 0.04);
}

.dark .preview-overlay {
  background: rgba(255, 255, 255, 0.04);
}

/* An empty drawing always shows its hint, so touch users (no hover) see it. */
.preview-overlay.is-empty {
  opacity: 1;
  background: transparent;
}

.paper-card:hover .preview-overlay,
.paper-node:focus-visible .preview-overlay {
  opacity: 1;
  pointer-events: auto;
}

.preview-hint {
  box-shadow: 0 4px 14px rgba(0, 0, 0, 0.1);
  backdrop-filter: blur(6px);
}

.preview-overlay.is-empty .preview-hint {
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.08);
}

@media (prefers-reduced-motion: reduce) {
  .paper-card,
  .preview-overlay {
    transition: none;
  }
}
</style>
