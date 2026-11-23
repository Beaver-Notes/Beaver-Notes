<template>
  <div
    class="paper-toolbar fixed bottom-[max(1rem,env(safe-area-inset-bottom))] left-1/2 -translate-x-1/2 z-50 flex flex-col items-center max-w-[calc(100vw-16px)] select-none drop-shadow-xl"
    :class="{ 'is-chrome-locked': inkStrokeActive }"
    role="toolbar"
    aria-label="Drawing tools"
  >
    <!-- Secondary row: history and stroke size -->
    <div
      class="flex items-center justify-center gap-1 px-3 py-1.5 bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-700 rounded-t-xl border-b-0 -mb-px"
    >
      <button
        type="button"
        class="icon-btn"
        title="Undo"
        aria-label="Undo"
        :disabled="!canUndo"
        @pointerdown.stop.prevent="onUndo"
        @keydown.enter.space.prevent="onUndo"
        v-html="icons.undo"
      />
      <button
        type="button"
        class="icon-btn"
        title="Redo"
        aria-label="Redo"
        :disabled="!canRedo"
        @pointerdown.stop.prevent="onRedo"
        @keydown.enter.space.prevent="onRedo"
        v-html="icons.redo"
      />

      <template v-if="showSizes">
        <span class="divider-v mx-1.5 h-5" />
        <button
          v-for="s in sizePresets"
          :key="s"
          type="button"
          class="size-btn"
          :class="{ 'bg-primary/10': currentToolSize === s, 'is-selected': currentToolSize === s }"
          :title="`Size ${s}`"
          :aria-label="`Size ${s}`"
          :aria-pressed="currentToolSize === s"
          @pointerdown.stop.prevent="onSize(s)"
          @keydown.enter.space.prevent="onSize(s)"
        >
          <span
            class="block rounded-full bg-neutral-800 dark:bg-neutral-200 transition-all"
            :style="{ width: dotSize(s), height: dotSize(s) }"
          />
        </button>
      </template>
    </div>

    <!-- Main pill -->
    <div
      class="relative flex items-center justify-center gap-2 px-5 rounded-full bg-white/95 dark:bg-neutral-900/95 backdrop-blur border shadow-xl"
    >
      <div class="flex items-start gap-1 h-20 overflow-hidden px-1">
        <button
          v-for="t in tools"
          :key="t.id"
          type="button"
          class="tool-btn relative flex flex-col items-center justify-start w-12 h-24 bg-transparent transition-transform duration-200 ease-out text-neutral-400 dark:text-neutral-500 hover:text-neutral-800 dark:hover:text-neutral-200 touch-manipulation"
          :class="{
            '-translate-y-4 !text-neutral-900 dark:!text-white z-10':
              tool === t.id,
          }"
          :title="t.label"
          :aria-label="t.label"
          :aria-pressed="tool === t.id"
          @pointerdown.stop.prevent="onTool(t.id)"
          @keydown.enter.space.prevent="onTool(t.id)"
        >
          <span
            class="paper-tool-icon flex items-start justify-center w-full transform translate-y-6"
            v-html="toolIconSvg(t)"
          />
        </button>
      </div>

      <span class="divider-v mx-3 h-10 self-center" />

      <div class="flex items-center gap-3 shrink-0">
        <template v-if="showColors">
          <div class="flex flex-wrap items-center justify-center w-[5.25rem]">
            <button
              v-for="(preset, i) in activePresets.slice(0, 5)"
              :key="`${tool}-${i}`"
              type="button"
              class="color-btn"
              :class="{ 'is-selected': isSameColor(preset, currentToolColor) }"
              :title="preset"
              :aria-label="`Colour ${preset}`"
              :aria-pressed="isSameColor(preset, currentToolColor)"
              @pointerdown.stop.prevent="onColor(preset)"
              @keydown.enter.space.prevent="onColor(preset)"
            >
              <span class="color-dot" :style="{ backgroundColor: preset }" />
            </button>

            <label
              class="color-btn cursor-pointer"
              title="Custom colour"
              aria-label="Custom colour"
            >
              <span
                class="color-dot relative overflow-hidden bg-[conic-gradient(red,yellow,lime,cyan,blue,magenta,red)]"
              >
                <input
                  type="color"
                  :value="currentToolColor"
                  class="absolute -inset-2 opacity-0 cursor-pointer"
                  @input="onColorInput"
                  @change="onSavePreset"
                />
              </span>
            </label>
          </div>

          <span v-if="paperTypes.length" class="divider-v h-8 self-center" />
        </template>

        <div
          v-if="paperTypes.length"
          class="grid grid-cols-2 gap-1.5"
          role="group"
          aria-label="Paper"
        >
          <button
            v-for="bg in paperTypes"
            :key="bg"
            type="button"
            class="paper-swatch"
            :class="[
              `paper-swatch--${bg}`,
              background === bg
                ? '!border-primary ring-2 ring-primary/20 is-selected'
                : '',
            ]"
            :title="`${bg[0].toUpperCase()}${bg.slice(1)} paper`"
            :aria-label="`${bg} paper`"
            :aria-pressed="background === bg"
            @pointerdown.stop.prevent="onBg(bg)"
            @keydown.enter.space.prevent="onBg(bg)"
          />
        </div>
      </div>
    </div>
  </div>
</template>

<script>
import { computed } from 'vue';
import { inkStrokeActive } from './ink/uiLock.js';
import penSvgRaw from './icons/Pen.svg?raw';
import pencilSvgRaw from './icons/Pencil.svg?raw';
import fountainSvgRaw from './icons/Funtain pen.svg?raw';
import highlighterSvgRaw from './icons/Highlighter.svg?raw';
import eraserSvgRaw from './icons/Eraser.svg?raw';
import lassoSvgRaw from './icons/Lasso.svg?raw';

function recolorTip(svg, color) {
  return svg
    .replace(/#0066CC/g, color)
    .replace(/#CCFF00/g, color)
    .replace(/fill="black"/g, `fill="${color}"`)
    .replace(/#3385FF/g, color)
    .replace(/#E6FF80/g, color);
}

function toolIconSvg(tool) {
  let raw;
  switch (tool.id) {
    case 'pen':
      raw = penSvgRaw;
      break;
    case 'pencil':
      raw = pencilSvgRaw;
      break;
    case 'fountain':
      raw = fountainSvgRaw;
      break;
    case 'marker':
    case 'highlighter':
      raw = highlighterSvgRaw;
      break;
    case 'eraser':
      raw = eraserSvgRaw;
      break;
    case 'lasso':
      raw = lassoSvgRaw;
      break;
    default:
      return '';
  }
  if (tool.hasSwatch) raw = recolorTip(raw, tool._color);

  raw = raw.replace(/\s(width|height)="[^"]*"/g, '');
  return raw;
}

// Inline stroke icons (24x24, lucide-style) for the history buttons.
const svg = (d) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
const icons = {
  undo: svg('<path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/>'),
  redo: svg('<path d="m15 14 5-5-5-5"/><path d="M20 9H9.5a5.5 5.5 0 0 0 0 11H13"/>'),
};

const isSameColor = (a, b) => a?.toLowerCase() === b?.toLowerCase();

export default {
  name: 'PaperToolbar',
  props: {
    tools: { type: Array, required: true },
    tool: { type: String, required: true },
    paperTypes: { type: Array, required: true },
    background: { type: String, default: 'transparent' },
    currentToolColor: { type: String, default: '#1a1a1a' },
    currentToolSize: { type: Number, default: 4 },
    activePresets: { type: Array, default: () => [] },
    canUndo: { type: Boolean, default: false },
    canRedo: { type: Boolean, default: false },
  },
  emits: ['tool', 'color', 'color-input', 'save-preset', 'size', 'bg', 'undo', 'redo'],
  setup(props, { emit }) {
    const sizePresets = computed(() => {
      const t = props.tool;
      if (t === 'marker' || t === 'highlighter') return [8, 12, 16, 24, 32];
      if (t === 'eraser') return [12, 20, 32, 44, 60];
      if (t === 'pencil') return [1, 2, 3, 5, 8];
      return [2, 4, 6, 10, 16];
    });

    const showColors = computed(() => {
      const t = props.tool;
      return t === 'pen' || t === 'pencil' || t === 'fountain' || t === 'marker';
    });
    const showSizes = computed(() => props.tool !== 'lasso');

    function dotSize(s) {
      const min = sizePresets.value[0],
        max = sizePresets.value[sizePresets.value.length - 1];
      return Math.round(6 + ((s - min) / Math.max(1, max - min)) * 14) + 'px';
    }
    function onTool(id) {
      emit('tool', id);
    }
    function onColor(c) {
      emit('color', c);
    }
    function onColorInput(e) {
      emit('color-input', e.target.value);
    }
    function onSavePreset(e) {
      emit('save-preset', e.target.value);
    }
    function onSize(s) {
      emit('size', s);
    }
    function onBg(bg) {
      emit('bg', bg);
    }
    function onUndo() {
      if (props.canUndo) emit('undo');
    }
    function onRedo() {
      if (props.canRedo) emit('redo');
    }

    return {
      inkStrokeActive,
      sizePresets,
      showColors,
      showSizes,
      icons,
      isSameColor,
      dotSize,
      toolIconSvg,
      onTool,
      onColor,
      onColorInput,
      onSavePreset,
      onSize,
      onBg,
      onUndo,
      onRedo,
    };
  },
};
</script>

<style scoped>
/* A7: while a stroke owns the pointer, the palette is inert — no accidental
   tool switch mid-stroke. */
.paper-toolbar.is-chrome-locked {
  pointer-events: none;
  opacity: 0.55;
}
.paper-tool-icon :deep(svg) {
  width: 28px;
  height: auto;
  display: block;
}

.divider-v {
  display: block;
  width: 1px;
  flex-shrink: 0;
  background: #e5e5e5;
}
.dark .divider-v {
  background: #404040;
}

/* ---- Buttons share one focus ring (keyboard only) ---- */
.icon-btn:focus-visible,
.size-btn:focus-visible,
.color-btn:focus-visible,
.paper-swatch:focus-visible,
.tool-btn:focus-visible {
  outline: none;
  box-shadow: inset 0 0 0 2px rgba(99, 102, 241, 0.7);
}
.tool-btn {
  border-radius: 12px;
}

/* ---- History icon buttons ---- */
.icon-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 2rem;
  height: 2rem;
  border-radius: 9999px;
  color: #525252;
  transition: background-color 0.15s ease, color 0.15s ease, opacity 0.15s ease;
  touch-action: manipulation;
}
.dark .icon-btn {
  color: #d4d4d4;
}
.icon-btn:disabled {
  opacity: 0.3;
  pointer-events: none;
}
@media (hover: hover) and (pointer: fine) {
  .icon-btn:hover {
    background: rgba(0, 0, 0, 0.06);
  }
  .dark .icon-btn:hover {
    background: rgba(255, 255, 255, 0.1);
  }
}

/* ---- Size presets ---- */
.size-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 2rem;
  height: 2rem;
  border-radius: 9999px;
  transition: background-color 0.15s ease;
  touch-action: manipulation;
}
@media (hover: hover) and (pointer: fine) {
  .size-btn:not(.is-selected):hover {
    background: rgba(0, 0, 0, 0.06);
  }
  .dark .size-btn:not(.is-selected):hover {
    background: rgba(255, 255, 255, 0.1);
  }
}

/* ---- Colours: 28px hit area around a 20px dot ---- */
.color-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 1.75rem;
  height: 1.75rem;
  border-radius: 9999px;
  touch-action: manipulation;
}
.color-dot {
  display: block;
  width: 1.25rem;
  height: 1.25rem;
  border-radius: 9999px;
  border: 2px solid rgba(0, 0, 0, 0.1);
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.12);
  transition: transform 0.15s ease, border-color 0.15s ease;
}
.dark .color-dot {
  border-color: rgba(255, 255, 255, 0.18);
}
.color-btn.is-selected .color-dot {
  border-color: #262626;
  transform: scale(1.08);
}
.dark .color-btn.is-selected .color-dot {
  border-color: #fff;
}
@media (hover: hover) and (pointer: fine) {
  .color-btn:hover .color-dot {
    transform: scale(1.12);
  }
}

/* ---- Paper swatches; --ink flips for dark mode so patterns stay visible ---- */
.paper-swatch {
  --ink: 0, 0, 0;
  width: 1.5rem;
  height: 1.5rem;
  border-radius: 0.5rem;
  border: 2px solid #e5e5e5;
  background-color: #fafafa;
  touch-action: manipulation;
  transition: border-color 0.15s ease, box-shadow 0.15s ease;
}
.dark .paper-swatch {
  --ink: 255, 255, 255;
  border-color: #525252;
  background-color: #404040;
}
.paper-swatch--transparent {
  background-image: linear-gradient(
    135deg,
    transparent 0 40%,
    rgba(var(--ink), 0.35) 40% 45%,
    transparent 45% 55%,
    rgba(var(--ink), 0.35) 55% 60%,
    transparent 60%
  );
}
.paper-swatch--grid {
  background-size: 4px 4px;
  background-image: linear-gradient(rgba(var(--ink), 0.1) 1px, transparent 1px),
    linear-gradient(90deg, rgba(var(--ink), 0.1) 1px, transparent 1px);
}
.paper-swatch--ruled {
  background-image: repeating-linear-gradient(
    transparent 0 4px,
    rgba(var(--ink), 0.14) 4px 5px
  );
}
.paper-swatch--dotted {
  background-size: 5px 5px;
  background-image: radial-gradient(rgba(var(--ink), 0.22) 1px, transparent 1.2px);
}
@media (hover: hover) and (pointer: fine) {
  .paper-swatch:not(.is-selected):hover {
    border-color: #a3a3a3;
  }
}

@media (prefers-reduced-motion: reduce) {
  .tool-btn,
  .icon-btn,
  .size-btn,
  .color-dot,
  .paper-swatch {
    transition: none !important;
  }
}
</style>
