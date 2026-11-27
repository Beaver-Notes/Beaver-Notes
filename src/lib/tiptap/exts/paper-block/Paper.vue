<template>
  <NodeViewWrapper
    ref="wrapperRef"
    class="paper-node select-none"
    :class="{ 'is-active': selected, 'is-editing': isEditing }"
    :contenteditable="false"
    tabindex="0"
    role="group"
    aria-label="Drawing"
    @keydown.esc="exitEditing"
    @click="enterEditing"
  >
    <!-- Apple A12: a static preview covers the canvas while not editing, so
         keystrokes elsewhere never repaint this drawing. Tapping edits inline:
         drawings belong to the editor body, not a separate stage.
         shortcut: a stored `preview` snapshot (none is written today) paints
         its own colors, so it would not follow the theme swap. -->
    <div v-if="!isEditing" class="paper-preview" @click="enterEditing">
      <InkPreviewImage
        :strokes="displayStrokes"
        :preview="node.attrs.preview ?? null"
        :width="surfaceWidth"
        :height="node.attrs.height ?? 210"
      />
    </div>

    <PaperSurface
      :strokes="displayStrokes"
      :focused="isEditing"
      :tool="surfaceTool"
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
      :paper-types="PAPER_TYPES"
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
import { resolvedDarkTheme } from '@/composable/theme';
import {
  setPaperEditing,
  attachKeyboardGuard,
  selectMediaBlock,
} from './helpers/paperEditing.js';
import PaperSurface from './PaperSurface.vue';
import InkPreviewImage from './InkPreviewImage.vue';
import PaperToolbar from './PaperToolbar.vue';
import { parseStrokes } from './ink/stroke-model.js';
import {
  displayStrokes as toDisplayStrokes,
  inkDisplayColor,
  setInkPaintMapper,
} from './ink/inkTheme.js';
import { PAPER_TYPES, useInkToolbar } from '@/composable/useInkToolbar.js';

export default {
  name: 'PaperBlock',
  components: { NodeViewWrapper, PaperSurface, InkPreviewImage, PaperToolbar },
  props: nodeViewProps,
  setup(props) {
    const { translations } = useTranslations();
    const {
      tool,
      toolSettings,
      surfaceTool,
      tools,
      currentToolColor,
      currentToolSize,
      activePresets,
      setTool,
      setColor,
      setSize,
      savePreset,
    } = useInkToolbar();
    const surfaceKey = `paper-${Math.random().toString(36).slice(2, 8)}`;
    const wrapperRef = ref(null);
    const surfaceWidth = ref(0);
    let detachKeyboardGuard = null;
    let previewRO = null;
    const isEditing = ref(false);

    const strokes = computed(() => parseStrokes(props.node.attrs.strokes));
    // Monochrome ink follows the note surface: black ink flips to white in dark
    // mode (white to black in light). Display-only — attrs/Yjs keep the stored
    // color, so the same drawing reads correctly in both themes.
    const isDark = computed(() => resolvedDarkTheme.value);
    const displayStrokes = computed(() => toDisplayStrokes(strokes.value, isDark.value));
    watch(
      isDark,
      (dark) => setInkPaintMapper((color) => inkDisplayColor(color, dark)),
      { immediate: true },
    );
    const hint = computed(
      () => translations.value.paperBlock?.startDrawing || 'Start drawing',
    );

    // Shared editor history: one stroke commit = one transaction, so
    // canUndo/canRedo come from the editor, not a private stack.
    const history = ref({ undo: false, redo: false });
    let historyRaf = null;
    const syncHistory = () => {
      const ed = props.editor;
      if (!ed || ed.isDestroyed) return;
      history.value = { undo: ed.can().undo(), redo: ed.can().redo() };
    };
    // can() probes the full history stack; every editor transaction elsewhere
    // in the note fired it once per paper block. Coalesce to one probe per
    // frame — a one-frame-late toolbar state is plenty for a drawing block.
    const scheduleSyncHistory = () => {
      if (historyRaf != null) return;
      historyRaf = requestAnimationFrame(() => {
        historyRaf = null;
        syncHistory();
      });
    };
    onMounted(() => {
      syncHistory();
      props.editor?.on?.('transaction', scheduleSyncHistory);
      const measure = () => {
        surfaceWidth.value = Math.round(wrapperRef.value?.$el?.clientWidth || 0);
      };
      measure();
      if (typeof ResizeObserver !== 'undefined' && wrapperRef.value?.$el) {
        previewRO = new ResizeObserver(measure);
        previewRO.observe(wrapperRef.value.$el);
      }
      // keyboard-less block: never let a tap summon the on-screen keyboard
      detachKeyboardGuard = attachKeyboardGuard(
        () => wrapperRef.value?.$el,
        () => props.editor,
      );
    });
    onUnmounted(() => {
      props.editor?.off?.('transaction', scheduleSyncHistory);
      if (historyRaf != null) cancelAnimationFrame(historyRaf);
      historyRaf = null;
      previewRO?.disconnect();
      previewRO = null;
      detachKeyboardGuard?.();
      detachKeyboardGuard = null;
    });
    const canUndo = computed(() => history.value.undo);
    const canRedo = computed(() => history.value.redo);

    function enterEditing() {
      if (isEditing.value) return;
      // ponytail: touch taps don't node-select like desktop clicks; select
      // explicitly (without keyboard focus) so the toolbar gate holds
      selectMediaBlock(props.editor, props.getPos?.());
      isEditing.value = true;
    }
    function exitEditing() {
      isEditing.value = false;
    }
    watch(
      () => props.selected,
      (sel) => {
        if (sel) enterEditing();
        else isEditing.value = false;
      },
    );
    // Scribble suppression is gesture-scoped in PaperSurface (useInkInput),
    // never tied to focus — keep only the double-tap-insert guard.
    watch(isEditing, (editing) => {
      setPaperEditing(surfaceKey, editing);
    });
    onUnmounted(() => {
      setPaperEditing(surfaceKey, false);
    });

    function onCommit(stroke) {
      props.updateAttributes({ strokes: [...strokes.value, stroke] });
    }
    function onUpdateStrokes(next) {
      props.updateAttributes({ strokes: next });
    }
    // Resizing grows the canvas — it never zooms the ink. Stroke geometry is
    // kept in note coordinates, so expanding just reveals more blank surface.
    // The surface emits absolute heights, which are immune to attr lag during
    // a rapid drag (no compounding scale factor).
    function onHeightChange(px) {
      const h = Math.max(60, Math.round(px));
      if (h === (props.node.attrs.height || 210)) return;
      props.updateAttributes({ height: h });
    }
    function setBackground(bg) {
      props.updateAttributes({ paperType: bg });
    }

    return {
      isEditing,
      surfaceKey,
      wrapperRef,
      surfaceWidth,
      displayStrokes,
      surfaceTool,
      hint,
      tool,
      toolSettings,
      tools,
      PAPER_TYPES,
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
.paper-preview {
  position: absolute;
  inset: 0;
  z-index: 2;
  cursor: text;
}
.paper-preview :deep(.ink-preview-image) {
  display: block;
  width: 100%;
  height: 100%;
}
</style>
