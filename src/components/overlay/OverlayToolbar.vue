<template>
  <teleport to="body">
    <transition name="overlay-toolbar">
      <div
        v-if="drawing.mode.value === 'drawing'"
        class="overlay-toolbar-shell"
      >
        <div class="overlay-toolbar-panel">
          <button
            v-for="tool in tools"
            :key="tool.id"
            type="button"
            class="overlay-tool-button"
            :class="{ 'is-active': drawing.activeTool.value === tool.id }"
            @click="drawing.setTool(tool.id)"
          >
            <component
              :is="tool.component"
              :active-color="toolColor(tool.id)"
            />
            <span
              v-if="tool.swatch"
              class="tool-swatch"
              :style="{ backgroundColor: toolColor(tool.id) }"
            />
          </button>

          <div
            v-if="drawing.activeTool.value !== 'eraser'"
            class="color-picker-wrap"
          >
            <span
              class="color-swatch"
              :style="{ backgroundColor: drawing.activeSettings.value.color }"
            >
              <input
                type="color"
                :value="drawing.activeSettings.value.color"
                @input="drawing.setColor($event.target.value)"
              />
            </span>
          </div>

          <div class="size-control">
            <span
              class="size-dot"
              :style="{ width: `${sizePreview}px`, height: `${sizePreview}px` }"
            />
            <input
              type="range"
              :min="drawing.activeTool.value === 'pen' ? 1 : 5"
              :max="drawing.activeTool.value === 'eraser' ? 36 : 24"
              :value="drawing.activeSettings.value.size"
              @input="drawing.setSize($event.target.value)"
            />
          </div>

          <button
            type="button"
            class="overlay-tool-button"
            :disabled="drawing.undoStack.value.length === 0"
            @click="drawing.undo()"
          >
            <UndoIcon />
          </button>
          <button
            type="button"
            class="overlay-tool-button"
            :disabled="drawing.redoStack.value.length === 0"
            @click="drawing.redo()"
          >
            <RedoIcon />
          </button>
          <button
            type="button"
            class="overlay-tool-button"
            :disabled="drawing.strokes.value.length === 0"
            @click="confirmClear"
          >
            <TrashIcon />
          </button>
          <button
            type="button"
            class="done-button"
            @click="drawing.exitDrawMode()"
          >
            <DoneIcon />
            <span>Done</span>
          </button>
        </div>
      </div>
    </transition>
  </teleport>
</template>

<script setup>
import { computed, defineComponent, h } from 'vue';
import { useDialog } from '@/composable/dialog';
import { useOverlayDrawing } from '@/composable/useOverlayDrawing';

const drawing = useOverlayDrawing();
const dialog = useDialog();

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
  h('path', {
    d: 'M12.7 6.1c2.2-.8 4-.8 5.5.1',
    stroke: 'currentColor',
    'stroke-opacity': '0.35',
    'stroke-width': '0.95',
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

const TrashIcon = iconSvg(() => [
  h('path', {
    d: 'M8 8.3h8.1l-.8 9.5H8.8L8 8.3Z',
    stroke: 'currentColor',
    'stroke-width': '1.3',
    'stroke-linejoin': 'round',
  }),
  h('path', {
    d: 'M9.4 8.2c.5-1.4 1.4-2.1 2.7-2.1 1.3 0 2.2.7 2.7 2.1',
    stroke: 'currentColor',
    'stroke-width': '1.2',
    'stroke-linecap': 'round',
  }),
  h('path', {
    d: 'M7 8.2h10.2',
    stroke: 'currentColor',
    'stroke-width': '1.2',
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

const tools = [
  { id: 'pen', component: PenIcon, swatch: true },
  { id: 'highlighter', component: HighlighterIcon, swatch: true },
  { id: 'eraser', component: EraserIcon, swatch: false },
];

const toolColor = (toolId) =>
  toolId === 'highlighter'
    ? drawing.toolSettings.highlighter.color
    : drawing.toolSettings.pen.color;

const sizePreview = computed(() => {
  const currentSize = Number(drawing.activeSettings.value.size || 1);
  const min = drawing.activeTool.value === 'pen' ? 1 : 5;
  const max = drawing.activeTool.value === 'eraser' ? 36 : 24;
  const normalized = (currentSize - min) / Math.max(1, max - min);
  return 4 + normalized * 14;
});

function confirmClear() {
  dialog.confirm({
    title: 'Clear drawing?',
    body: 'This removes all overlay strokes on this note.',
    okText: 'Clear',
    cancelText: 'Cancel',
    onConfirm: () => drawing.clearAll(),
  });
}
</script>

<style scoped>
.overlay-toolbar-shell {
  position: fixed;
  left: 50%;
  bottom: 28px;
  transform: translateX(-50%);
  z-index: 50;
}

.overlay-toolbar-panel {
  display: flex;
  align-items: center;
  gap: 2px;
  padding: 6px 8px;
  border-radius: 14px;
  background: var(--color-background-primary);
  border: 1px solid var(--color-border-secondary);
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.12);
}

.overlay-tool-button,
.done-button {
  position: relative;
  width: 38px;
  height: 40px;
  border-radius: 8px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: inherit;
  transition: background-color 0.15s ease, opacity 0.15s ease;
}

.done-button {
  width: auto;
  padding: 0 10px;
  gap: 6px;
}

.overlay-tool-button.is-active {
  box-shadow: inset 0 1px 3px rgba(0, 0, 0, 0.12);
}

.overlay-tool-button.is-active::after {
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

.overlay-tool-button:disabled {
  opacity: 0.3;
}

.tool-swatch {
  position: absolute;
  bottom: 4px;
  left: 50%;
  width: 10px;
  height: 4px;
  transform: translateX(-50%);
  border-radius: 2px;
}

.color-picker-wrap {
  padding: 0 4px;
}

.color-swatch {
  position: relative;
  display: block;
  width: 22px;
  height: 22px;
  border-radius: 999px;
  border: 2px solid var(--color-border-primary);
  overflow: hidden;
}

.color-swatch input {
  position: absolute;
  inset: 0;
  opacity: 0;
}

.size-control {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 6px;
}

.size-control input {
  width: 72px;
}

.size-dot {
  display: block;
  border-radius: 999px;
  background: currentColor;
  min-width: 4px;
  min-height: 4px;
}

.overlay-toolbar-enter-active {
  transition: opacity 180ms cubic-bezier(0.34, 1.56, 0.64, 1),
    transform 180ms cubic-bezier(0.34, 1.56, 0.64, 1);
}

.overlay-toolbar-leave-active {
  transition: opacity 140ms ease, transform 140ms ease;
}

.overlay-toolbar-enter-from,
.overlay-toolbar-leave-to {
  opacity: 0;
  transform: translateY(10px);
}

.overlay-toolbar-enter-to,
.overlay-toolbar-leave-from {
  opacity: 1;
  transform: translateY(0);
}

@media print {
  .overlay-toolbar-shell {
    display: none;
  }
}
</style>
