<template>
  <NodeViewWrapper
    ref="wrapperRef"
    class="paper-node"
    :class="{ 'is-active': selected, 'is-editing': isEditing }"
    :contenteditable="false"
    style="touch-action: none"
    tabindex="0"
  >
    <div class="relative drawing-shell" @click="handleShellClick">

      <!-- ── Toolbar ──────────────────────────────────────────────────────── -->
      <transition name="paper-toolbar">
        <div
          v-if="isEditing"
          class="paper-inline-toolbar"
          :class="toolbarPlacementClass"
        >
          <div class="paper-toolbar-panel">

            <!-- Tool buttons -->
            <button
              v-for="tool in tools"
              :key="tool.id"
              type="button"
              class="paper-tool-button"
              :class="{ 'is-active': toolbarState.tool === tool.id }"
              :title="tool.label"
              @click.stop="setTool(tool.id)"
            >
              <component :is="tool.icon" :active-color="toolSwatchColor(tool.id)" />
              <span
                v-if="tool.hasSwatch"
                class="paper-tool-swatch"
                :style="{ backgroundColor: toolSwatchColor(tool.id) }"
              />
            </button>

            <div class="paper-toolbar-sep" />

            <!-- Color presets (pen / highlighter only) -->
            <template v-if="toolbarState.tool === 'pen' || toolbarState.tool === 'highlighter'">
              <button
                v-for="(preset, i) in activePresets"
                :key="`preset-${i}`"
                type="button"
                class="paper-preset-swatch"
                :class="{ 'is-active': preset === currentToolColor }"
                :style="{ backgroundColor: preset }"
                :title="preset"
                @click.stop="applyPreset(preset)"
              />

              <!-- Custom colour picker -->
              <span
                class="paper-color-swatch"
                :style="{ backgroundColor: currentToolColor }"
                title="Custom colour"
              >
                <input
                  type="color"
                  :value="currentToolColor"
                  @input="onColorInput"
                  @change="savePreset"
                />
              </span>

              <div class="paper-toolbar-sep" />
            </template>

            <!-- Size slider (all tools except select / lasso) -->
            <div
              v-if="toolbarState.tool !== 'select' && toolbarState.tool !== 'lasso'"
              class="paper-size-control"
            >
              <span
                class="paper-size-dot"
                :style="{ width: `${sizePreviewPx}px`, height: `${sizePreviewPx}px` }"
              />
              <input
                type="range"
                :min="sizeMin"
                :max="sizeMax"
                :value="currentToolSize"
                @input="onSizeInput"
              />
            </div>

            <!-- Delete selection (visible when something is selected) -->
            <button
              v-if="toolbarState.hasSelection"
              type="button"
              class="paper-tool-button"
              title="Delete selection"
              @click.stop="deleteSelection"
            >
              <TrashIcon />
            </button>

            <div class="paper-toolbar-sep" />

            <!-- Background presets -->
            <div class="paper-background-picker">
              <button
                v-for="bg in paperTypes"
                :key="bg"
                type="button"
                class="paper-type-button"
                :class="[bg, { 'is-active': toolbarState.background === bg }]"
                :title="bg"
                @click.stop="setBackground(bg)"
              />
            </div>

            <div class="paper-toolbar-sep" />

            <!-- Undo / Redo -->
            <button
              type="button"
              class="paper-tool-button"
              :disabled="toolbarState.undoDepth === 0"
              title="Undo"
              @click.stop="drawModeRef?.undo()"
            >
              <UndoIcon />
            </button>
            <button
              type="button"
              class="paper-tool-button"
              :disabled="toolbarState.redoDepth === 0"
              title="Redo"
              @click.stop="drawModeRef?.redo()"
            >
              <RedoIcon />
            </button>

            <!-- Export -->
            <button
              type="button"
              class="paper-tool-button"
              title="Export as SVG"
              @click.stop="exportSVG"
            >
              <ExportIcon />
            </button>

            <!-- Done -->
            <button
              type="button"
              class="paper-done-button"
              @click.stop="isEditing = false"
            >
              Done
            </button>
          </div>
        </div>
      </transition>

      <!-- ── Canvas ───────────────────────────────────────────────────────── -->
      <DrawMode
        ref="drawModeRef"
        :node="node"
        :interactive="isEditing"
        @update-attributes="handleUpdateAttributes"
        @toolbar-state="handleToolbarState"
      />

      <!-- ── Click-to-edit hint (shown when not editing) ──────────────────── -->
      <button
        v-if="!isEditing"
        type="button"
        class="paper-draw-hint"
        @click.stop="isEditing = true"
      >
        <svg viewBox="0 0 24 24" class="size-5" fill="none">
          <path
            d="M7 15.8 12.2 5l4.8 4.8-10.7 5.3L7 15.8Z"
            stroke="currentColor"
            stroke-width="1.3"
            stroke-linejoin="round"
          />
          <circle cx="7.4" cy="16.3" r="1.6" :fill="toolbarState.penSettings?.color ?? '#000'" />
        </svg>
        <span>{{ translations.paperBlock?.clickToDraw ?? 'Click to draw' }}</span>
      </button>
    </div>
  </NodeViewWrapper>
</template>

<script>
/* eslint-disable vue/one-component-per-file */
import { computed, defineComponent, h, ref, watch, onUnmounted } from 'vue';
import { useTranslations } from '@/composable/useTranslations';
import { NodeViewWrapper, nodeViewProps } from '@tiptap/vue-3';
import {
  setScribbleSuppressed,
  clearScribbleSuppressed,
} from '@/lib/native/scribble';
import { usePaperBlockBus } from '@/composable/usePaperBlockBus';
import DrawMode from './DrawMode.vue';
import '@/assets/css/paper.scss';

// ---------------------------------------------------------------------------
// Colour presets — 5 per tool, persisted to localStorage
// ---------------------------------------------------------------------------

const PRESETS_KEY = 'beaver-paper-presets';
const DEFAULT_PRESETS = {
  pen: ['#1a1a1a', '#e53e3e', '#3182ce', '#38a169', '#805ad5'],
  highlighter: ['#fbbf24', '#34d399', '#60a5fa', '#f472b6', '#a78bfa'],
};

function loadPresets() {
  try {
    const raw = localStorage.getItem(PRESETS_KEY);
    if (raw) return { ...DEFAULT_PRESETS, ...JSON.parse(raw) };
  } catch { /* ignore */ }
  return { ...DEFAULT_PRESETS };
}

function savePresets(presets) {
  try { localStorage.setItem(PRESETS_KEY, JSON.stringify(presets)); } catch { /* ignore */ }
}

// ---------------------------------------------------------------------------
// Icon helpers
// ---------------------------------------------------------------------------

function iconSvg(paths) {
  return defineComponent({
    props: { activeColor: { type: String, default: 'currentColor' } },
    setup(props) {
      return () => h('svg', { viewBox: '0 0 24 24', class: 'size-[18px]', fill: 'none' }, paths(props));
    },
  });
}

const SelectIcon = iconSvg(() => [
  h('path', { d: 'M7 6.2 16.8 12 12.4 13.3 13.8 18.2 11.3 19 9.8 14.2 7 16.7V6.2Z', stroke: 'currentColor', 'stroke-width': '1.3', 'stroke-linejoin': 'round' }),
]);

const LassoIcon = iconSvg(() => [
  h('path', { d: 'M12 5c-3.9 0-7 2.4-7 5.5 0 2 1.4 3.8 3.5 4.7L7 19h10l-1.5-3.8C17.6 14.3 19 12.5 19 10.5 19 7.4 15.9 5 12 5Z', stroke: 'currentColor', 'stroke-width': '1.3', 'stroke-linejoin': 'round', fill: 'none' }),
  h('path', { d: 'M9 10.5 11.5 13 15 9', stroke: 'currentColor', 'stroke-width': '1.2', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }),
]);

const PenIcon = iconSvg((props) => [
  h('path', { d: 'M7 15.8 12.2 5l4.8 4.8-10.7 5.3L7 15.8Z', fill: 'none', stroke: 'currentColor', 'stroke-width': '1.3', 'stroke-linejoin': 'round' }),
  h('path', { d: 'M10.3 8.8 13.9 12.4', stroke: 'currentColor', 'stroke-opacity': '0.3', 'stroke-width': '1', 'stroke-linecap': 'round' }),
  h('circle', { cx: '7.4', cy: '16.3', r: '1.6', fill: props.activeColor }),
]);

const HighlighterIcon = iconSvg((props) => [
  h('rect', { x: '7.2', y: '4.4', width: '9.6', height: '10', rx: '2.2', stroke: 'currentColor', 'stroke-width': '1.3' }),
  h('path', { d: 'M9 14.4h6l-1.8 4.3H10.8L9 14.4Z', fill: props.activeColor, 'fill-opacity': '0.7', stroke: 'currentColor', 'stroke-width': '1.1', 'stroke-linejoin': 'round' }),
  h('path', { d: 'M8.8 7.7h6.4', stroke: 'currentColor', 'stroke-width': '1', 'stroke-linecap': 'round' }),
]);

const EraserIcon = iconSvg(() => [
  h('path', { d: 'M6.3 15.8 10.8 8h6.9l-4.5 7.8H6.3Z', fill: 'none', stroke: 'currentColor', 'stroke-width': '1.3', 'stroke-linejoin': 'round' }),
  h('path', { d: 'M6.3 15.8 8.8 11.4H11l-2.5 4.4H6.3Z', fill: '#f9a8d4', 'fill-opacity': '0.6' }),
  h('path', { d: 'M10.9 8.1v7.5', stroke: 'currentColor', 'stroke-width': '1', 'stroke-linecap': 'round' }),
]);

const UndoIcon = iconSvg(() => [
  h('path', { d: 'M8.7 8.2 5.2 11l3.5 2.8', stroke: 'currentColor', 'stroke-width': '1.4', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }),
  h('path', { d: 'M6 11h7.2c2.7 0 4.8 1.4 5.8 4', stroke: 'currentColor', 'stroke-width': '1.4', 'stroke-linecap': 'round' }),
]);

const RedoIcon = iconSvg(() => [
  h('path', { d: 'M15.3 8.2 18.8 11l-3.5 2.8', stroke: 'currentColor', 'stroke-width': '1.4', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }),
  h('path', { d: 'M18 11h-7.2c-2.7 0-4.8 1.4-5.8 4', stroke: 'currentColor', 'stroke-width': '1.4', 'stroke-linecap': 'round' }),
]);

const TrashIcon = iconSvg(() => [
  h('path', { d: 'M6 8h12M10 8V6h4v2M9 8v10h6V8H9Z', stroke: 'currentColor', 'stroke-width': '1.3', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }),
]);

const ExportIcon = iconSvg(() => [
  h('path', { d: 'M12 4v10m0 0-3-3m3 3 3-3', stroke: 'currentColor', 'stroke-width': '1.4', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }),
  h('path', { d: 'M6 17v2h12v-2', stroke: 'currentColor', 'stroke-width': '1.4', 'stroke-linecap': 'round' }),
]);

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default {
  name: 'PaperBlock',
  components: {
    DrawMode,
    NodeViewWrapper,
    SelectIcon, LassoIcon, PenIcon, HighlighterIcon, EraserIcon,
    UndoIcon, RedoIcon, TrashIcon, ExportIcon,
  },
  props: nodeViewProps,

  setup(props) {
    const { translations } = useTranslations();
    const drawModeRef   = ref(null);
    const wrapperRef    = ref(null);
    const isEditing     = ref(false);
    const scribbleScope = `paper-block-${Math.random().toString(36).slice(2, 10)}`;

    const toolbarState = ref({
      tool: 'pen',
      penSettings:         { color: '#1a1a1a', size: 4 },
      highlighterSettings: { color: '#fbbf24', size: 16 },
      eraserSettings:      { size: 20 },
      undoDepth:  0,
      redoDepth:  0,
      background: props.node.attrs.paperType ?? 'plain',
      hasSelection: false,
    });

    // ── Tools list ───────────────────────────────────────────────────────────

    const tools = [
      { id: 'pen',         label: 'Pen',         icon: PenIcon,         hasSwatch: true  },
      { id: 'highlighter', label: 'Highlighter',  icon: HighlighterIcon, hasSwatch: true  },
      { id: 'eraser',      label: 'Eraser',       icon: EraserIcon,      hasSwatch: false },
      { id: 'select',      label: 'Select (box)', icon: SelectIcon,      hasSwatch: false },
      { id: 'lasso',       label: 'Lasso',        icon: LassoIcon,       hasSwatch: false },
    ];

    const paperTypes = ['plain', 'grid', 'ruled', 'dotted'];

    // ── Toolbar placement ─────────────────────────────────────────────────────

    const toolbarPlacementClass = ref('toolbar-above');

    function updateToolbarPlacement() {
      const el = wrapperRef.value?.$el ?? wrapperRef.value;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const prefersBelow = rect.top < 84;
      const forcedAbove  = rect.bottom > window.innerHeight - 84;
      toolbarPlacementClass.value = (prefersBelow && !forcedAbove) ? 'toolbar-below' : 'toolbar-above';
    }

    // ── Colour presets ────────────────────────────────────────────────────────

    const presets = ref(loadPresets());

    const activePresets = computed(() => {
      const tool = toolbarState.value.tool;
      return presets.value[tool] ?? presets.value.pen;
    });

    const currentToolColor = computed(() => {
      const ts = toolbarState.value;
      if (ts.tool === 'highlighter') return ts.highlighterSettings?.color ?? '#fbbf24';
      return ts.penSettings?.color ?? '#1a1a1a';
    });

    function applyPreset(color) {
      drawModeRef.value?.setColor(color);
    }

    function onColorInput(e) {
      drawModeRef.value?.setColor(e.target.value);
    }

    function savePreset(e) {
      const color = e.target.value;
      const tool  = toolbarState.value.tool;
      if (tool !== 'pen' && tool !== 'highlighter') return;
      const list  = [...(presets.value[tool] ?? DEFAULT_PRESETS[tool])];
      if (!list.includes(color)) {
        list.splice(0, 1); // drop oldest
        list.push(color);
        presets.value = { ...presets.value, [tool]: list };
        savePresets(presets.value);
      }
    }

    // ── Size ─────────────────────────────────────────────────────────────────

    const sizeMin = computed(() => {
      if (toolbarState.value.tool === 'eraser') return 8;
      if (toolbarState.value.tool === 'highlighter') return 8;
      return 1;
    });
    const sizeMax = computed(() => {
      if (toolbarState.value.tool === 'eraser') return 60;
      if (toolbarState.value.tool === 'highlighter') return 40;
      return 20;
    });

    const currentToolSize = computed(() => {
      const ts = toolbarState.value;
      if (ts.tool === 'highlighter') return ts.highlighterSettings?.size ?? 16;
      if (ts.tool === 'eraser')      return ts.eraserSettings?.size ?? 20;
      return ts.penSettings?.size ?? 4;
    });

    const sizePreviewPx = computed(() => {
      const size       = Number(currentToolSize.value || 1);
      const normalized = (size - sizeMin.value) / Math.max(1, sizeMax.value - sizeMin.value);
      return Math.round(4 + normalized * 14);
    });

    function onSizeInput(e) {
      drawModeRef.value?.setSize(e.target.value);
    }

    // ── Tool swatch colour ────────────────────────────────────────────────────

    function toolSwatchColor(toolId) {
      if (toolId === 'highlighter') return toolbarState.value.highlighterSettings?.color ?? '#fbbf24';
      return toolbarState.value.penSettings?.color ?? '#1a1a1a';
    }

    // ── Handlers ─────────────────────────────────────────────────────────────

    function handleUpdateAttributes(updates) {
      const out = {};
      if (Array.isArray(updates.linesV2)) out.linesV2 = updates.linesV2;
      if (Array.isArray(updates.lines))   out.lines   = updates.lines;
      if (updates.height !== undefined)   out.height  = Math.max(100, Number(updates.height) || 400);
      if (updates.paperType !== undefined) out.paperType = updates.paperType;
      props.updateAttributes(out);
      updateToolbarPlacement();
    }

    function handleToolbarState(next) {
      toolbarState.value = { ...toolbarState.value, ...next };
      updateToolbarPlacement();
    }

    function handleShellClick() {
      if (!isEditing.value) {
        isEditing.value = true;
        updateToolbarPlacement();
      }
    }

    function setTool(tool)       { drawModeRef.value?.setTool(tool); }
    function setBackground(type) { drawModeRef.value?.setBackground(type); }

    function deleteSelection() {
      drawModeRef.value?.deleteSelection?.();
    }

    // ── SVG / PNG export ─────────────────────────────────────────────────────

    function exportSVG() {
      const svgStr  = drawModeRef.value?.exportSVG?.();
      if (!svgStr) return;
      const blob    = new Blob([svgStr], { type: 'image/svg+xml' });
      const url     = URL.createObjectURL(blob);
      const a       = document.createElement('a');
      a.href        = url;
      a.download    = 'drawing.svg';
      a.click();
      URL.revokeObjectURL(url);
    }

    // ── Watchers ──────────────────────────────────────────────────────────────

    watch(isEditing, (editing) => {
      setScribbleSuppressed(scribbleScope, editing);
    }, { immediate: true });

    watch(() => props.node.attrs.paperType, (paperType) => {
      toolbarState.value = { ...toolbarState.value, background: paperType ?? 'plain' };
    }, { immediate: true });

    onUnmounted(() => {
      clearScribbleSuppressed(scribbleScope);
    });

    return {
      translations,
      wrapperRef,
      drawModeRef,
      isEditing,
      tools,
      paperTypes,
      toolbarState,
      toolbarPlacementClass,
      currentToolColor,
      currentToolSize,
      sizeMin,
      sizeMax,
      sizePreviewPx,
      activePresets,
      applyPreset,
      onColorInput,
      savePreset,
      onSizeInput,
      toolSwatchColor,
      handleUpdateAttributes,
      handleToolbarState,
      handleShellClick,
      setTool,
      setBackground,
      deleteSelection,
      exportSVG,
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

/* ── Click-to-edit hint ───────────────────────────────────────────────────── */

.paper-draw-hint {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  color: var(--color-text-secondary, #666);
  background: rgba(255, 255, 255, 0.55);
  opacity: 0;
  transition: opacity 0.15s ease;
  pointer-events: none;
}

.paper-node:hover .paper-draw-hint {
  opacity: 1;
  pointer-events: auto;
}

.dark .paper-draw-hint {
  background: rgba(0, 0, 0, 0.45);
}

/* ── Toolbar positioning ──────────────────────────────────────────────────── */

.paper-inline-toolbar {
  position: absolute;
  left: 50%;
  z-index: 20;
  width: min(calc(100vw - 24px), max-content);
  transform: translateX(-50%);
}

.toolbar-above { bottom: calc(100% + 10px); }
.toolbar-below { top: calc(100% + 10px); }

/* ── Toolbar panel ────────────────────────────────────────────────────────── */

.paper-toolbar-panel {
  display: flex;
  align-items: center;
  gap: 2px;
  padding: 5px 8px;
  border-radius: 14px;
  background: var(--color-background-primary, #fff);
  border: 1px solid var(--color-border-secondary, rgba(0,0,0,0.1));
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.13);
  max-width: 100%;
  overflow-x: auto;
  scrollbar-width: none;
}

.paper-toolbar-panel::-webkit-scrollbar { display: none; }

.paper-toolbar-sep {
  width: 1px;
  height: 22px;
  background: var(--color-border-secondary, rgba(0,0,0,0.1));
  margin: 0 4px;
  flex-shrink: 0;
}

/* ── Tool buttons ─────────────────────────────────────────────────────────── */

.paper-tool-button,
.paper-done-button,
.paper-type-button {
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: inherit;
  flex-shrink: 0;
}

.paper-tool-button {
  width: 34px;
  height: 36px;
  border-radius: 8px;
}

.paper-done-button {
  height: 34px;
  padding: 0 12px;
  border-radius: 8px;
  font-size: 13px;
  font-weight: 500;
  background: var(--color-primary, #6366f1);
  color: white;
  margin-left: 2px;
}

.paper-tool-button.is-active {
  background: rgba(99, 102, 241, 0.1);
}

.paper-tool-button.is-active::after {
  content: '';
  position: absolute;
  bottom: 4px;
  left: 50%;
  transform: translateX(-50%);
  width: 4px;
  height: 4px;
  border-radius: 50%;
  background: rgba(99, 102, 241, 0.8);
}

.paper-tool-button:disabled {
  opacity: 0.28;
  cursor: default;
}

.paper-tool-swatch {
  position: absolute;
  bottom: 3px;
  left: 50%;
  width: 10px;
  height: 3px;
  transform: translateX(-50%);
  border-radius: 2px;
}

/* ── Colour presets ───────────────────────────────────────────────────────── */

.paper-preset-swatch {
  width: 18px;
  height: 18px;
  border-radius: 50%;
  border: 2px solid transparent;
  flex-shrink: 0;
  transition: transform 0.1s, border-color 0.1s;
  margin: 0 1px;
}

.paper-preset-swatch.is-active,
.paper-preset-swatch:hover {
  border-color: rgba(99, 102, 241, 0.7);
  transform: scale(1.15);
}

.paper-color-swatch {
  position: relative;
  display: block;
  width: 20px;
  height: 20px;
  border-radius: 50%;
  border: 2px solid var(--color-border-primary, rgba(0,0,0,0.15));
  overflow: hidden;
  flex-shrink: 0;
  margin: 0 2px;
  cursor: pointer;
}

.paper-color-swatch input[type="color"] {
  position: absolute;
  inset: -4px;
  opacity: 0;
  cursor: pointer;
}

/* ── Size control ─────────────────────────────────────────────────────────── */

.paper-size-control {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 0 4px;
}

.paper-size-control input[type="range"] {
  width: 68px;
  accent-color: rgba(99, 102, 241, 0.8);
}

.paper-size-dot {
  display: block;
  border-radius: 50%;
  background: currentColor;
  min-width: 4px;
  min-height: 4px;
  flex-shrink: 0;
}

/* ── Background picker ────────────────────────────────────────────────────── */

.paper-background-picker {
  display: flex;
  align-items: center;
  gap: 3px;
}

.paper-type-button {
  width: 24px;
  height: 24px;
  border-radius: 5px;
  border: 1.5px solid var(--color-border-secondary, rgba(0,0,0,0.12));
}

.paper-type-button.is-active {
  border-color: rgba(99, 102, 241, 0.75);
  box-shadow: 0 0 0 1.5px rgba(99, 102, 241, 0.3);
}

.paper-type-button.plain  { background: #f9f9f9; }
.paper-type-button.grid   {
  background-image: linear-gradient(rgba(0,0,0,0.07) 1px, transparent 1px),
                    linear-gradient(90deg, rgba(0,0,0,0.07) 1px, transparent 1px);
  background-size: 6px 6px;
  background-color: #f9f9f9;
}
.paper-type-button.ruled  {
  background-image: repeating-linear-gradient(transparent 0 6px, rgba(0,0,0,0.09) 6px 7px);
  background-color: #f9f9f9;
}
.paper-type-button.dotted {
  background-image: radial-gradient(rgba(0,0,0,0.12) 1px, transparent 1.2px);
  background-size: 7px 7px;
  background-color: #f9f9f9;
}

/* ── Toolbar enter/leave transition ───────────────────────────────────────── */

.paper-toolbar-enter-active,
.paper-toolbar-leave-active {
  transition: opacity 0.15s ease, transform 0.15s ease;
}

.paper-toolbar-enter-from,
.paper-toolbar-leave-to {
  opacity: 0;
  transform: translate(-50%, 8px);
}

.paper-toolbar-enter-to,
.paper-toolbar-leave-from {
  opacity: 1;
  transform: translate(-50%, 0);
}
</style>
