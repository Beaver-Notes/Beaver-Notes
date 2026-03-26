<template>
  <NodeViewWrapper
    ref="wrapperRef"
    class="draw paper-node"
    :class="{ 'is-active': selected, 'is-editing': isEditing }"
    :contenteditable="false"
    style="touch-action: none"
    tabindex="0"
  >
    <div class="relative drawing-shell" @click="handleShellClick">
      <transition name="paper-toolbar">
        <div
          v-if="isEditing"
          class="paper-inline-toolbar"
          :class="toolbarPlacementClass"
        >
          <div class="paper-toolbar-panel">
            <button
              v-for="tool in tools"
              :key="tool.id"
              type="button"
              class="paper-tool-button"
              :class="{ 'is-active': toolbarState.tool === tool.id }"
              @click.stop="setTool(tool.id)"
            >
              <component
                :is="tool.component"
                :active-color="toolColor(tool.id)"
              />
              <span
                v-if="tool.swatch"
                class="paper-tool-swatch"
                :style="{ backgroundColor: toolColor(tool.id) }"
              />
            </button>

            <div
              v-if="
                toolbarState.tool !== 'eraser' && toolbarState.tool !== 'select'
              "
              class="paper-color-picker"
            >
              <span
                class="paper-color-swatch"
                :style="{ backgroundColor: currentToolColor }"
              >
                <input
                  type="color"
                  :value="currentToolColor"
                  @input="setColor"
                />
              </span>
            </div>

            <div
              v-if="toolbarState.tool !== 'select'"
              class="paper-size-control"
            >
              <span
                class="paper-size-dot"
                :style="{
                  width: `${sizePreview}px`,
                  height: `${sizePreview}px`,
                }"
              />
              <input
                type="range"
                :min="toolbarState.tool === 'pen' ? 1 : 5"
                :max="toolbarState.tool === 'eraser' ? 36 : 24"
                :value="currentToolSize"
                @input="setSize"
              />
            </div>

            <div class="paper-background-picker">
              <button
                v-for="paperType in paperTypes"
                :key="paperType"
                type="button"
                class="paper-type-button"
                :class="[
                  paperType,
                  toolbarState.background === paperType && 'is-active',
                ]"
                @click.stop="setBackground(paperType)"
              />
            </div>

            <button
              type="button"
              class="paper-tool-button"
              :disabled="toolbarState.undoDepth === 0"
              @click.stop="drawModeRef?.undo()"
            >
              <UndoIcon />
            </button>
            <button
              type="button"
              class="paper-tool-button"
              :disabled="toolbarState.redoDepth === 0"
              @click.stop="drawModeRef?.redo()"
            >
              <RedoIcon />
            </button>
            <button
              type="button"
              class="paper-done-button"
              @click.stop="isEditing = false"
            >
              <DoneIcon />
              <span>Done</span>
            </button>
          </div>
        </div>
      </transition>

      <DrawMode
        ref="drawModeRef"
        :node="node"
        :interactive="isEditing"
        @update-attributes="handleUpdateAttributes"
        @toolbar-state="handleToolbarState"
      />

      <button
        v-if="!isEditing"
        type="button"
        class="paper-draw-hint"
        @click.stop="isEditing = true"
      >
        <svg viewBox="0 0 24 24" class="size-6" fill="none">
          <path
            d="M7 16.1 12.5 5.3l4.5 4.5-5.7 5.8-4.3.5Z"
            fill="none"
            stroke="currentColor"
            stroke-width="1.2"
            stroke-linejoin="round"
          />
          <path
            d="M10.2 8.8 13.8 12.4"
            stroke="currentColor"
            stroke-opacity="0.3"
            stroke-width="1"
            stroke-linecap="round"
          />
          <circle
            cx="7.4"
            cy="16.3"
            r="1.5"
            :fill="toolbarState.penSettings.color"
          />
        </svg>
        <span>{{ translations.paperBlock.clickToDraw }}</span>
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
import DrawMode from './DrawMode.vue';
import '@/assets/css/paper.scss';

function iconSvg(paths) {
  return defineComponent({
    props: {
      activeColor: { type: String, default: 'currentColor' },
    },
    setup(props) {
      return () =>
        h(
          'svg',
          { viewBox: '0 0 24 24', class: 'size-[20px]', fill: 'none' },
          paths(props)
        );
    },
  });
}

const SelectIcon = iconSvg(() => [
  h('path', {
    d: 'M7 6.2 16.8 12 12.4 13.3 13.8 18.2 11.3 19 9.8 14.2 7 16.7V6.2Z',
    stroke: 'currentColor',
    'stroke-width': '1.3',
    'stroke-linejoin': 'round',
  }),
]);

const PenIcon = iconSvg((props) => [
  h('path', {
    d: 'M7 15.8 12.2 5l4.8 4.8-10.7 5.3L7 15.8Z',
    fill: 'none',
    stroke: 'currentColor',
    'stroke-width': '1.3',
    'stroke-linejoin': 'round',
  }),
  h('path', {
    d: 'M10.3 8.8 13.9 12.4',
    stroke: 'currentColor',
    'stroke-opacity': '0.3',
    'stroke-width': '1',
    'stroke-linecap': 'round',
  }),
  h('circle', { cx: '7.4', cy: '16.3', r: '1.6', fill: props.activeColor }),
]);

const HighlighterIcon = iconSvg((props) => [
  h('rect', {
    x: '7.2',
    y: '4.4',
    width: '9.6',
    height: '10',
    rx: '2.2',
    stroke: 'currentColor',
    'stroke-width': '1.3',
  }),
  h('path', {
    d: 'M9 14.4h6l-1.8 4.3H10.8L9 14.4Z',
    fill: props.activeColor,
    'fill-opacity': '0.7',
    stroke: 'currentColor',
    'stroke-width': '1.1',
    'stroke-linejoin': 'round',
  }),
  h('path', {
    d: 'M8.8 7.7h6.4',
    stroke: 'currentColor',
    'stroke-width': '1',
    'stroke-linecap': 'round',
  }),
]);

const EraserIcon = iconSvg(() => [
  h('path', {
    d: 'M6.3 15.8 10.8 8h6.9l-4.5 7.8H6.3Z',
    fill: 'none',
    stroke: 'currentColor',
    'stroke-width': '1.3',
    'stroke-linejoin': 'round',
  }),
  h('path', {
    d: 'M6.3 15.8 8.8 11.4H11l-2.5 4.4H6.3Z',
    fill: '#f9a8d4',
    'fill-opacity': '0.6',
  }),
  h('path', {
    d: 'M10.9 8.1v7.5',
    stroke: 'currentColor',
    'stroke-width': '1',
    'stroke-linecap': 'round',
  }),
]);

const UndoIcon = iconSvg(() => [
  h('path', {
    d: 'M8.7 8.2 5.2 11l3.5 2.8',
    stroke: 'currentColor',
    'stroke-width': '1.4',
    'stroke-linecap': 'round',
    'stroke-linejoin': 'round',
  }),
  h('path', {
    d: 'M6 11h7.2c2.7 0 4.8 1.4 5.8 4',
    stroke: 'currentColor',
    'stroke-width': '1.4',
    'stroke-linecap': 'round',
  }),
]);

const RedoIcon = iconSvg(() => [
  h('path', {
    d: 'M15.3 8.2 18.8 11l-3.5 2.8',
    stroke: 'currentColor',
    'stroke-width': '1.4',
    'stroke-linecap': 'round',
    'stroke-linejoin': 'round',
  }),
  h('path', {
    d: 'M18 11h-7.2c-2.7 0-4.8 1.4-5.8 4',
    stroke: 'currentColor',
    'stroke-width': '1.4',
    'stroke-linecap': 'round',
  }),
]);

const DoneIcon = iconSvg(() => [
  h('path', {
    d: 'M7 16.1 12.5 5.3l4.5 4.5-5.7 5.8-4.3.5Z',
    fill: 'none',
    stroke: 'currentColor',
    'stroke-width': '1.2',
    'stroke-linejoin': 'round',
  }),
  h('path', {
    d: 'M6.4 18.4 17.6 7.2',
    stroke: 'currentColor',
    'stroke-width': '1.1',
    'stroke-linecap': 'round',
  }),
]);

export default {
  name: 'CustomNodeView',
  components: {
    DrawMode,
    DoneIcon,
    EraserIcon,
    HighlighterIcon,
    NodeViewWrapper,
    PenIcon,
    RedoIcon,
    SelectIcon,
    UndoIcon,
  },
  props: nodeViewProps,
  setup(props) {
    const { translations } = useTranslations();
    const drawModeRef = ref(null);
    const wrapperRef = ref(null);
    const isEditing = ref(false);
    const scribbleScope = `paper-block-${Math.random()
      .toString(36)
      .slice(2, 10)}`;
    const toolbarState = ref({
      tool: 'pen',
      penSettings: { color: '#1a1a1a', size: 2.5 },
      highlighterSettings: { color: '#fbbf24', size: 14 },
      eraserSettings: { size: 18 },
      undoDepth: 0,
      redoDepth: 0,
      background: props.node.attrs.paperType || 'plain',
    });

    const tools = [
      { id: 'select', component: SelectIcon, swatch: false },
      { id: 'pen', component: PenIcon, swatch: true },
      { id: 'highlighter', component: HighlighterIcon, swatch: true },
      { id: 'eraser', component: EraserIcon, swatch: false },
    ];
    const paperTypes = ['grid', 'ruled', 'dotted', 'plain'];

    const toolbarPlacementClass = ref('toolbar-above');

    const currentToolColor = computed(() =>
      toolbarState.value.tool === 'highlighter'
        ? toolbarState.value.highlighterSettings.color
        : toolbarState.value.penSettings.color
    );

    const currentToolSize = computed(() => {
      if (toolbarState.value.tool === 'highlighter') {
        return toolbarState.value.highlighterSettings.size;
      }
      if (toolbarState.value.tool === 'eraser') {
        return toolbarState.value.eraserSettings.size;
      }
      return toolbarState.value.penSettings.size;
    });

    const sizePreview = computed(() => {
      const size = Number(currentToolSize.value || 1);
      const min = toolbarState.value.tool === 'pen' ? 1 : 5;
      const max = toolbarState.value.tool === 'eraser' ? 36 : 24;
      const normalized = (size - min) / Math.max(1, max - min);
      return 4 + normalized * 14;
    });

    const toolColor = (tool) =>
      tool === 'highlighter'
        ? toolbarState.value.highlighterSettings.color
        : toolbarState.value.penSettings.color;

    const updateToolbarPlacement = () => {
      if (!wrapperRef.value?.$el && !wrapperRef.value) return;
      const element = wrapperRef.value?.$el || wrapperRef.value;
      const rect = element.getBoundingClientRect();
      const prefersBelow = rect.top < 84;
      const forcedAbove = rect.bottom > window.innerHeight - 84;
      toolbarPlacementClass.value =
        prefersBelow && !forcedAbove ? 'toolbar-below' : 'toolbar-above';
    };

    const handleUpdateAttributes = (updates) => {
      const validatedUpdates = {};

      if (updates.lines !== undefined) {
        validatedUpdates.lines = Array.isArray(updates.lines)
          ? updates.lines
          : [];
      }
      if (updates.linesV2 !== undefined) {
        validatedUpdates.linesV2 = Array.isArray(updates.linesV2)
          ? updates.linesV2
          : [];
      }
      if (updates.height !== undefined) {
        validatedUpdates.height = Math.max(100, Number(updates.height) || 400);
      }
      if (updates.paperType !== undefined) {
        validatedUpdates.paperType = updates.paperType;
      }

      props.updateAttributes(validatedUpdates);
      updateToolbarPlacement();
    };

    const handleToolbarState = (nextState) => {
      toolbarState.value = {
        ...toolbarState.value,
        ...nextState,
      };
      updateToolbarPlacement();
    };

    const handleShellClick = () => {
      if (!isEditing.value) {
        isEditing.value = true;
        updateToolbarPlacement();
      }
    };

    const setTool = (tool) => {
      drawModeRef.value?.setTool(tool);
    };

    const setColor = (event) => {
      drawModeRef.value?.setColor(event.target.value);
    };

    const setSize = (event) => {
      drawModeRef.value?.setSize(event.target.value);
    };

    const setBackground = (paperType) => {
      drawModeRef.value?.setBackground(paperType);
    };

    watch(
      isEditing,
      (editing) => {
        setScribbleSuppressed(scribbleScope, editing);
      },
      { immediate: true }
    );

    watch(
      () => props.node.attrs.paperType,
      (paperType) => {
        toolbarState.value = {
          ...toolbarState.value,
          background: paperType || 'plain',
        };
      },
      { immediate: true }
    );

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
      sizePreview,
      toolColor,
      handleUpdateAttributes,
      handleToolbarState,
      handleShellClick,
      setTool,
      setColor,
      setSize,
      setBackground,
      UndoIcon,
      RedoIcon,
      DoneIcon,
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

.paper-draw-hint {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  color: var(--color-text-secondary);
  background: color-mix(
    in srgb,
    var(--color-background-primary) 55%,
    transparent
  );
  opacity: 0;
  transition: opacity 0.18s ease;
}

.paper-node:hover .paper-draw-hint,
.paper-draw-hint:focus-visible {
  opacity: 1;
}

.paper-inline-toolbar {
  position: absolute;
  left: 50%;
  z-index: 20;
  width: min(calc(100vw - 24px), max-content);
  transform: translateX(-50%);
}

.toolbar-above {
  bottom: calc(100% + 12px);
}

.toolbar-below {
  top: calc(100% + 12px);
}

.paper-toolbar-panel {
  display: flex;
  align-items: center;
  gap: 2px;
  padding: 6px 8px;
  border-radius: 14px;
  background: var(--color-background-primary);
  border: 1px solid var(--color-border-secondary);
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.12);
  max-width: 100%;
  overflow-x: auto;
}

.paper-tool-button,
.paper-done-button,
.paper-type-button {
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: inherit;
}

.paper-tool-button,
.paper-type-button {
  width: 38px;
  height: 40px;
  border-radius: 8px;
}

.paper-done-button {
  height: 40px;
  border-radius: 8px;
  gap: 6px;
  padding: 0 10px;
}

.paper-tool-button.is-active,
.paper-type-button.is-active {
  box-shadow: inset 0 1px 3px rgba(0, 0, 0, 0.12);
}

.paper-tool-button.is-active::after {
  content: '';
  position: absolute;
  bottom: 5px;
  left: 50%;
  width: 4px;
  height: 4px;
  transform: translateX(-50%);
  border-radius: 999px;
  background: currentColor;
}

.paper-tool-button:disabled {
  opacity: 0.3;
}

.paper-tool-swatch {
  position: absolute;
  bottom: 4px;
  left: 50%;
  width: 10px;
  height: 4px;
  transform: translateX(-50%);
  border-radius: 2px;
}

.paper-color-picker {
  padding: 0 4px;
}

.paper-color-swatch {
  position: relative;
  display: block;
  width: 22px;
  height: 22px;
  border-radius: 999px;
  border: 2px solid var(--color-border-primary);
  overflow: hidden;
}

.paper-color-swatch input {
  position: absolute;
  inset: 0;
  opacity: 0;
}

.paper-size-control {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 6px;
}

.paper-size-control input {
  width: 72px;
}

.paper-size-dot {
  display: block;
  border-radius: 999px;
  background: currentColor;
  min-width: 4px;
  min-height: 4px;
}

.paper-background-picker {
  display: flex;
  align-items: center;
  gap: 2px;
  padding: 0 4px;
}

.paper-type-button {
  border: 1px solid var(--color-border-secondary);
  background-color: var(--color-background-secondary, transparent);
}

.paper-type-button.grid {
  background-image: linear-gradient(
      to right,
      rgba(0, 0, 0, 0.08) 1px,
      transparent 1px
    ),
    linear-gradient(to bottom, rgba(0, 0, 0, 0.08) 1px, transparent 1px);
  background-size: 9px 9px;
}

.paper-type-button.ruled {
  background-image: repeating-linear-gradient(
    to bottom,
    transparent 0 9px,
    rgba(0, 0, 0, 0.1) 9px 10px
  );
}

.paper-type-button.dotted {
  background-image: radial-gradient(rgba(0, 0, 0, 0.14) 1px, transparent 1.3px);
  background-size: 10px 10px;
}

.paper-type-button.plain {
  background-image: none;
}

.paper-toolbar-enter-active,
.paper-toolbar-leave-active {
  transition: opacity 0.18s ease, transform 0.18s ease;
}

.paper-toolbar-enter-from,
.paper-toolbar-leave-to {
  opacity: 0;
  transform: translate(-50%, 10px);
}

.paper-toolbar-enter-to,
.paper-toolbar-leave-from {
  opacity: 1;
  transform: translate(-50%, 0);
}
</style>
