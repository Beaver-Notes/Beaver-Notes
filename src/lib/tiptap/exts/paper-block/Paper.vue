<template>
  <NodeViewWrapper
    ref="wrapperRef"
    class="paper-node"
    :class="{ 'is-active': selected }"
    :contenteditable="false"
    tabindex="0"
  >
    <div class="drawing-shell">
      <!-- Canvas -->
      <DrawMode
        ref="drawModeRef"
        :node="node"
        :interactive="true"
        @update-attributes="handleUpdateAttributes"
        @toolbar-state="handleToolbarState"
      />

      <!-- Toolbar (separate component → no scribble on buttons) -->
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
  </NodeViewWrapper>
</template>

<script>
import { computed, ref, watch, onMounted, onUnmounted } from 'vue';
import { useTranslations } from '@/composable/useTranslations';
import { NodeViewWrapper, nodeViewProps } from '@tiptap/vue-3';
import {
  setScribbleSuppressed,
  clearScribbleSuppressed,
} from '@/lib/native/scribble';
import { useStore } from '@/store';
import DrawMode from './DrawMode.vue';
import PaperToolbar from './PaperToolbar.vue';

const PRESETS_KEY = 'beaver-paper-presets';
const DEFAULT_PRESETS = {
  pen: ['#1a1a1a', '#e53e3e', '#3182ce', '#38a169', '#805ad5'],
  highlighter: ['#fbbf24', '#34d399', '#60a5fa', '#f472b6', '#a78bfa'],
};

function loadPresets() {
  try {
    const r = localStorage.getItem(PRESETS_KEY);
    if (r) return { ...DEFAULT_PRESETS, ...JSON.parse(r) };
  } catch {
    /* */
  }
  return { ...DEFAULT_PRESETS };
}
function savePresetsFn(p) {
  try {
    localStorage.setItem(PRESETS_KEY, JSON.stringify(p));
  } catch {
    /* */
  }
}

export default {
  name: 'PaperBlock',
  components: { DrawMode, NodeViewWrapper, PaperToolbar },
  props: nodeViewProps,
  setup(props) {
    const { translations } = useTranslations();
    const store = useStore();
    const drawModeRef = ref(null);
    const scribbleScope = `paper-${Math.random().toString(36).slice(2, 8)}`;

    const toolbarState = ref({
      tool: 'pen',
      penSettings: { color: '#1a1a1a', size: 4 },
      pencilSettings: { color: '#4a4a4a', size: 3 },
      fountainSettings: { color: '#1a2744', size: 5 },
      highlighterSettings: { color: '#fbbf24', size: 16 },
      eraserSettings: { size: 20 },
      undoDepth: 0,
      redoDepth: 0,
      background: props.node.attrs.paperType ?? 'plain',
      hasSelection: false,
    });

    const presets = ref(loadPresets());

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

    function handleUpdateAttributes(u) {
      const out = {};
      if (Array.isArray(u.linesV2)) out.linesV2 = u.linesV2;
      if (Array.isArray(u.lines)) out.lines = u.lines;
      if (u.height !== undefined)
        out.height = Math.max(100, Number(u.height) || 400);
      if (u.paperType !== undefined) out.paperType = u.paperType;
      props.updateAttributes(out);
    }
    function handleToolbarState(s) {
      toolbarState.value = { ...toolbarState.value, ...s };
    }

    function setTool(t) {
      drawModeRef.value?.setTool(t);
    }
    function setBackground(b) {
      drawModeRef.value?.setBackground(b);
    }
    function deleteSelection() {
      drawModeRef.value?.deleteSelection?.();
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

    onMounted(() => {
      setScribbleSuppressed(scribbleScope, true);
    });
    onUnmounted(() => {
      clearScribbleSuppressed(scribbleScope);
    });

    watch(
      () => props.node.attrs.paperType,
      (v) => {
        toolbarState.value = {
          ...toolbarState.value,
          background: v ?? 'plain',
        };
      },
      { immediate: true }
    );

    return {
      translations,
      drawModeRef,
      tools,
      paperTypes,
      toolbarState,
      currentToolColor,
      currentToolSize,
      activePresets,
      handleUpdateAttributes,
      handleToolbarState,
      setTool,
      setBackground,
      deleteSelection,
      applyPreset,
      onColorInput,
      onSize,
      savePreset,
      insertImage,
    };
  },
};
</script>

<style scoped>
.paper-node {
  position: relative;
}
.drawing-shell {
  position: relative;
}
</style>
