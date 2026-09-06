<template>
  <NodeViewWrapper
    ref="wrapperRef"
    class="paper-node"
    :class="{ 'is-active': selected, 'is-editing': isEditing }"
    :contenteditable="false"
    tabindex="0"
    @keydown.esc="exitEditing"
  >
    <div
      class="paper-card relative overflow-hidden rounded-[24px] border border-neutral-200/80 bg-white shadow-[0_8px_30px_rgba(0,0,0,0.08)] dark:border-neutral-700/60 dark:bg-neutral-900"
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
      >
        <span
          class="px-4 py-2 rounded-full text-sm font-medium shadow-lg transition-opacity bg-white/90 dark:bg-neutral-800/90 text-neutral-600 dark:text-neutral-300"
        >
          {{ hasContent ? 'Click to edit drawing' : 'Tap to draw' }}
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
      @delete="deleteSelection"
    />
  </NodeViewWrapper>
</template>

<script>
import { computed, ref, watch } from 'vue';
import { NodeViewWrapper, nodeViewProps } from '@tiptap/vue-3';
import { useStore } from '@/store';
import DrawMode from './DrawMode.vue';
import PaperToolbar from './PaperToolbar.vue';
import { cloneDrawingToolDefaults } from './helpers/drawHelper.js';

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
  name: 'PaperBlock',
  components: { DrawMode, NodeViewWrapper, PaperToolbar },
  props: nodeViewProps,
  setup(props) {
    const store = useStore();
    const wrapperRef = ref(null);
    const drawModeRef = ref(null);
    const isEditing = ref(false);
    const defaultSettings = cloneDrawingToolDefaults();
    const presets = ref(loadPresets());

    const hasContent = computed(() => {
      const lines = props.node.attrs.linesV2 ?? props.node.attrs.lines ?? [];
      return Array.isArray(lines) && lines.length > 0;
    });

    const toolbarState = ref({
      tool: 'pen',
      penSettings: { ...defaultSettings.pen },
      pencilSettings: { color: '#4a4a4a', size: 3 },
      fountainSettings: { color: '#1a2744', size: 5 },
      highlighterSettings: { ...defaultSettings.highlighter },
      eraserSettings: { ...defaultSettings.eraser },
      undoDepth: 0,
      redoDepth: 0,
      background: props.node.attrs.paperType ?? 'dotted',
      hasSelection: false,
    });

    const tools = computed(() => [
      { id: 'pen', label: 'Pen', hasSwatch: true, _color: toolbarState.value.penSettings?.color ?? '#1a1a1a' },
      { id: 'pencil', label: 'Pencil', hasSwatch: true, _color: toolbarState.value.pencilSettings?.color ?? '#4a4a4a' },
      { id: 'fountain', label: 'Fountain', hasSwatch: true, _color: toolbarState.value.fountainSettings?.color ?? '#1a2744' },
      { id: 'highlighter', label: 'Highlighter', hasSwatch: true, _color: toolbarState.value.highlighterSettings?.color ?? '#fbbf24' },
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
      if (ts.tool === 'highlighter') return ts.highlighterSettings?.color ?? '#fbbf24';
      if (ts.tool === 'pencil') return ts.pencilSettings?.color ?? '#4a4a4a';
      if (ts.tool === 'fountain') return ts.fountainSettings?.color ?? '#1a2744';
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

    function enterEditing() {
      if (!isEditing.value) isEditing.value = true;
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
    function insertImage() {
      const id = store.activeNoteId;
      if (id) drawModeRef.value?.insertImage?.(id);
    }
    function savePreset(color) {
      const tool = toolbarState.value.tool;
      if (tool !== 'pen' && tool !== 'pencil' && tool !== 'fountain' && tool !== 'highlighter') return;
      const list = [...(presets.value[tool] ?? DEFAULT_PRESETS[tool] ?? [])];
      if (!list.includes(color)) {
        list.splice(0, 1);
        list.push(color);
      }
      presets.value = { ...presets.value, [tool]: list };
      savePresetsFn(presets.value);
    }

    return {
      wrapperRef,
      drawModeRef,
      isEditing,
      hasContent,
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
      insertImage,
      savePreset,
    };
  },
};
</script>

<style scoped>
.paper-node {
  position: relative;
}

.preview-overlay {
  opacity: 0;
  pointer-events: none;
  transition: opacity 0.2s ease;
  background: rgba(0, 0, 0, 0.04);
}

.paper-card:hover .preview-overlay {
  opacity: 1;
  pointer-events: auto;
}

.is-active .paper-card {
  border-color: rgba(0, 0, 0, 0.25);
}
</style>
