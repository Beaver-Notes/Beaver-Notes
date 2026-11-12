<template>
  <NodeViewWrapper
    class="paper-node"
    :class="{ 'is-active': selected, 'is-editing': isEditing }"
    :contenteditable="false"
    tabindex="0"
    role="group"
    aria-label="Drawing"
    @keydown.esc="exitEditing"
    @click="enterEditing"
  >
    <PaperSurface
      :strokes="strokes"
      :focused="isEditing"
      :tool="tool"
      :tool-settings="toolSettings"
      :height="node.attrs.height ?? 210"
      :paper-type="node.attrs.paperType ?? 'transparent'"
      :node-key="surfaceKey"
      :hint="hint"
      @commit="onCommit"
      @update-strokes="onUpdateStrokes"
      @focus-request="enterEditing"
      @height-change="onHeightChange"
    />

    <PaperToolbar
      v-if="isEditing && selected"
      :tools="tools"
      :tool="tool"
      :paper-types="paperTypes"
      :background="node.attrs.paperType ?? 'transparent'"
      :current-tool-color="currentToolColor"
      :current-tool-size="currentToolSize"
      :active-presets="activePresets"
      :can-undo="canUndo"
      :can-redo="canRedo"
      @tool="setTool"
      @color="setColor"
      @color-input="setColor"
      @save-preset="savePreset"
      @size="setSize"
      @bg="setBackground"
      @undo="editor.commands.undo()"
      @redo="editor.commands.redo()"
    />
  </NodeViewWrapper>
</template>

<script>
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import { NodeViewWrapper, nodeViewProps } from '@tiptap/vue-3';
import { useTranslations } from '@/composable/useTranslations';
import {
  setScribbleSuppressed,
  clearScribbleSuppressed,
} from '@/lib/native/scribble';
import { setPaperEditing } from './helpers/paperEditing.js';
import PaperSurface from './PaperSurface.vue';
import PaperToolbar from './PaperToolbar.vue';
import {
  TOOL_DEFAULTS,
  parseStrokes,
  serializeStrokes,
  scaleStrokes,
} from './ink/stroke-model.js';

const PRESETS_KEY = 'beaver-paper-presets';
const PRESET_COUNT = 5;
const DEFAULT_PRESETS = {
  pen: ['#1a1a1a', '#e53e3e', '#3182ce', '#38a169', '#805ad5'],
  pencil: ['#4a4a4a', '#78716c', '#2563eb', '#b45309', '#15803d'],
  fountain: ['#1a2744', '#0f172a', '#7f1d1d', '#065f46', '#4c1d95'],
  marker: ['#fbbf24', '#34d399', '#60a5fa', '#f472b6', '#a78bfa'],
};
const PRESET_TOOLS = Object.keys(DEFAULT_PRESETS);

function loadPresets() {
  try {
    const stored = JSON.parse(localStorage.getItem(PRESETS_KEY) ?? 'null');
    if (stored && typeof stored === 'object') {
      const merged = { ...DEFAULT_PRESETS };
      for (const tool of PRESET_TOOLS) {
        // "highlighter" is the legacy key of "marker"; keep user palettes.
        const list = stored[tool] ?? (tool === 'marker' ? stored.highlighter : null);
        if (Array.isArray(list) && list.length === PRESET_COUNT)
          merged[tool] = list;
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
  components: { NodeViewWrapper, PaperSurface, PaperToolbar },
  props: nodeViewProps,
  setup(props) {
    const { translations } = useTranslations();
    const surfaceKey = `paper-${Math.random().toString(36).slice(2, 8)}`;
    const isEditing = ref(false);
    const tool = ref('pen');
    const toolSettings = ref(
      Object.fromEntries(
        Object.entries(TOOL_DEFAULTS).map(([id, s]) => [id, { ...s }]),
      ),
    );
    const presets = ref(loadPresets());

    const strokes = computed(() => parseStrokes(props.node.attrs.strokes));
    const hint = computed(
      () => translations.value.paperBlock?.startDrawing || 'Start drawing',
    );

    // Shared editor history: one stroke commit = one transaction, so
    // canUndo/canRedo come from the editor, not a private stack.
    const history = ref({ undo: false, redo: false });
    const syncHistory = () => {
      const ed = props.editor;
      if (!ed || ed.isDestroyed) return;
      history.value = { undo: ed.can().undo(), redo: ed.can().redo() };
    };
    onMounted(() => {
      syncHistory();
      props.editor?.on?.('transaction', syncHistory);
    });
    onUnmounted(() => props.editor?.off?.('transaction', syncHistory));
    const canUndo = computed(() => history.value.undo);
    const canRedo = computed(() => history.value.redo);

    const currentSettings = computed(
      () => toolSettings.value[tool.value] ?? TOOL_DEFAULTS.pen,
    );
    const currentToolColor = computed(() => currentSettings.value.color);
    const currentToolSize = computed(() => currentSettings.value.size);
    const activePresets = computed(() => presets.value[tool.value] ?? DEFAULT_PRESETS.pen);

    const tools = computed(() => {
      const labels = translations.value.paperBlock ?? {};
      const swatch = (id, label) => ({
        id,
        label,
        hasSwatch: true,
        _color: toolSettings.value[id]?.color ?? TOOL_DEFAULTS[id].color,
      });
      return [
        swatch('pen', labels.pen || 'Pen'),
        swatch('pencil', labels.pencil || 'Pencil'),
        swatch('fountain', labels.fountainPen || 'Fountain pen'),
        swatch('marker', labels.highlighter || 'Highlighter'),
        { id: 'eraser', label: labels.eraser || 'Eraser', hasSwatch: false, _color: null },
        { id: 'lasso', label: labels.lassoSelect || 'Lasso select', hasSwatch: false, _color: null },
      ];
    });
    const paperTypes = ['transparent', 'plain', 'grid', 'ruled', 'dotted'];

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
      },
    );
    watch(isEditing, (editing) => {
      setScribbleSuppressed(surfaceKey, editing);
      setPaperEditing(surfaceKey, editing);
    });
    onUnmounted(() => {
      clearScribbleSuppressed(surfaceKey);
      setPaperEditing(surfaceKey, false);
    });

    function onCommit(stroke) {
      props.updateAttributes({ strokes: [...strokes.value, stroke] });
    }
    function onUpdateStrokes(next) {
      props.updateAttributes({ strokes: next });
    }
    function onHeightChange(px) {
      const h = Math.max(60, Math.round(px));
      const old = props.node.attrs.height || 210;
      if (h === old) return;
      // Resize scales the drawing (Apple-style), anchored at the top edge.
      props.updateAttributes({
        height: h,
        strokes: scaleStrokes(parseStrokes(props.node.attrs.strokes), h / old),
      });
    }
    function setTool(t) {
      tool.value = t;
    }
    function setColor(color) {
      toolSettings.value = {
        ...toolSettings.value,
        [tool.value]: { ...currentSettings.value, color },
      };
    }
    function setSize(size) {
      toolSettings.value = {
        ...toolSettings.value,
        [tool.value]: { ...currentSettings.value, size },
      };
    }
    function setBackground(bg) {
      props.updateAttributes({ paperType: bg });
    }
    function savePreset(color) {
      if (!PRESET_TOOLS.includes(tool.value)) return;
      const list = [...(presets.value[tool.value] ?? DEFAULT_PRESETS[tool.value])];
      if (list.includes(color)) return;
      // Newest colour goes last; the oldest one drops off the front.
      list.shift();
      list.push(color);
      presets.value = { ...presets.value, [tool.value]: list };
      savePresetsFn(presets.value);
    }

    return {
      isEditing,
      surfaceKey,
      strokes,
      hint,
      tool,
      toolSettings,
      tools,
      paperTypes,
      activePresets,
      currentToolColor,
      currentToolSize,
      canUndo,
      canRedo,
      enterEditing,
      exitEditing,
      onCommit,
      onUpdateStrokes,
      onHeightChange,
      setTool,
      setColor,
      setSize,
      setBackground,
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
</style>
