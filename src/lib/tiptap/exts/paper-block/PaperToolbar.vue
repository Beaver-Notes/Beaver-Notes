<template>
  <div
    class="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 flex flex-col items-center max-w-[calc(100vw-16px)] select-none"
  >
    <div
      v-if="showSizes"
      class="flex items-center justify-center gap-3 px-5 py-2 bg-white dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 rounded-t-xl border-b-0 -mb-px"
    >
      <button
        v-for="s in sizePresets"
        :key="s"
        type="button"
        class="flex items-center justify-center w-8 h-8 rounded-full bg-transparent hover:bg-black/5 dark:hover:bg-white/10 transition-colors"
        :class="{ 'bg-primary/10': currentToolSize === s }"
        @pointerdown.stop.prevent="onSize(s)"
      >
        <span
          class="block rounded-full bg-neutral-800 dark:bg-neutral-200 transition-all"
          :style="{ width: dotSize(s), height: dotSize(s) }"
        />
      </button>
    </div>

    <div
      class="relative flex items-center justify-center gap-1 px-4 rounded-2xl bg-white dark:bg-neutral-800 borderUndo"
    >
      <div class="flex items-start gap-1 h-20 overflow-hidden px-1">
        <button
          v-for="tool in tools"
          :key="tool.id"
          type="button"
          class="relative flex flex-col items-center justify-start w-12 h-24 bg-transparent transition-transform duration-200 ease-out text-neutral-400 dark:text-neutral-500 hover:text-neutral-800 dark:hover:text-neutral-200 touch-manipulation"
          :class="{
            '-translate-y-4 !text-neutral-900 dark:!text-white z-10':
              toolbarState.tool === tool.id,
          }"
          @pointerdown.stop.prevent="onTool(tool.id)"
        >
          <span
            class="paper-tool-icon flex items-start justify-center w-full transform translate-y-6"
            v-html="toolIcon(tool)"
          />
        </button>
      </div>

      <span
        class="w-px h-10 bg-neutral-200 dark:bg-neutral-700 mx-3 self-center shrink-0"
      />

      <div class="flex items-center gap-3 shrink-0">
        <div v-if="showColors" class="grid grid-cols-3 gap-2">
          <button
            v-for="(preset, i) in activePresets.slice(0, 3)"
            :key="'c1-' + i"
            type="button"
            class="w-5 h-5 rounded-full border-2 border-transparent hover:scale-110 transition-transform shrink-0 touch-manipulation shadow-sm"
            :class="{
              '!border-neutral-800 dark:!border-white scale-105':
                preset === currentToolColor,
            }"
            :style="{ backgroundColor: preset }"
            @pointerdown.stop.prevent="onColor(preset)"
          />

          <button
            v-for="(preset, i) in activePresets.slice(3, 5)"
            :key="'c2-' + i"
            type="button"
            class="w-5 h-5 rounded-full border-2 border-transparent hover:scale-110 transition-transform shrink-0 touch-manipulation shadow-sm"
            :class="{
              '!border-neutral-800 dark:!border-white scale-105':
                preset === currentToolColor,
            }"
            :style="{ backgroundColor: preset }"
            @pointerdown.stop.prevent="onColor(preset)"
          />

          <span
            class="w-5 h-5 rounded-full border-2 border-neutral-200 dark:border-neutral-600 overflow-hidden shrink-0 cursor-pointer relative bg-[conic-gradient(red,yellow,lime,cyan,blue,magenta,red)] shadow-sm"
          >
            <input
              type="color"
              :value="currentToolColor"
              class="absolute -inset-2 opacity-0 cursor-pointer"
              @input="onColorInput"
              @change="onSavePreset"
            />
          </span>
        </div>

        <span
          v-if="showColors"
          class="w-px h-8 bg-neutral-200 dark:bg-neutral-700 self-center shrink-0"
        />

        <div class="grid grid-cols-2 gap-2">
          <button
            v-for="bg in paperTypes.slice(0, 4)"
            :key="bg"
            type="button"
            class="w-6 h-6 rounded-lg border-2 border-neutral-200 dark:border-neutral-600 bg-neutral-50 dark:bg-neutral-700 shrink-0 touch-manipulation transition-all"
            :class="[
              bgClass(bg),
              toolbarState.background === bg
                ? '!border-primary ring-2 ring-primary/20'
                : 'hover:border-neutral-400 dark:hover:border-neutral-400',
            ]"
            @pointerdown.stop.prevent="onBg(bg)"
          />
        </div>
      </div>
    </div>
  </div>
</template>

<script>
import { computed } from 'vue';
import penSvgRaw from './icons/Pen.svg?raw';
import pencilSvgRaw from './icons/Pencil.svg?raw';
import fountainSvgRaw from './icons/Funtain pen.svg?raw';
import highlighterSvgRaw from './icons/Highlighter.svg?raw';
import eraserSvgRaw from './icons/Eraser.svg?raw';

const lassoSvg = `<svg viewBox="0 0 24 24" class="size-6" fill="none" xmlns="http://www.w3.org/2000/svg">
  <path d="M12 5c-3.9 0-7 2.4-7 5.5 0 2 1.4 3.8 3.5 4.7L7 19h10l-1.5-3.8C17.6 14.3 19 12.5 19 10.5 19 7.4 15.9 5 12 5Z" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/>
  <path d="M9 10.5 11.5 13 15 9" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/>
</svg>`;

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
    case 'highlighter':
      raw = highlighterSvgRaw;
      break;
    case 'eraser':
      raw = eraserSvgRaw;
      break;
    default:
      return '';
  }
  if (tool.hasSwatch) raw = recolorTip(raw, tool._color);

  raw = raw.replace(/\s(width|height)="[^"]*"/g, '');
  return raw;
}

function bgClass(bg) {
  if (bg === 'grid')
    return 'bg-[length:4px_4px] bg-[image:linear-gradient(rgba(0,0,0,0.07)_1px,transparent_1px),linear-gradient(90deg,rgba(0,0,0,0.07)_1px,transparent_1px)]';
  if (bg === 'ruled')
    return 'bg-[image:repeating-linear-gradient(transparent_0_4px,rgba(0,0,0,0.09)_4px_5px)]';
  if (bg === 'dotted')
    return 'bg-[length:5px_5px] bg-[image:radial-gradient(rgba(0,0,0,0.12)_1px,transparent_1.2px)]';
  return '';
}

export default {
  name: 'PaperToolbar',
  props: {
    toolbarState: { type: Object, required: true },
    tools: { type: Array, required: true },
    paperTypes: { type: Array, required: true },
    currentToolColor: { type: String, default: '#1a1a1a' },
    currentToolSize: { type: Number, default: 4 },
    activePresets: { type: Array, default: () => [] },
  },
  emits: [
    'tool',
    'color',
    'color-input',
    'save-preset',
    'size',
    'bg',
    'image',
    'delete',
  ],
  setup(props, { emit }) {
    const sizePresets = computed(() => {
      const t = props.toolbarState.tool;
      if (t === 'highlighter') return [8, 12, 16, 24, 32];
      if (t === 'eraser') return [12, 20, 32, 44, 60];
      if (t === 'pencil') return [1, 2, 3, 5, 8];
      return [2, 4, 6, 10, 16];
    });

    const showColors = computed(() => {
      const t = props.toolbarState.tool;
      return (
        t === 'pen' || t === 'pencil' || t === 'fountain' || t === 'highlighter'
      );
    });
    const showSizes = computed(() => props.toolbarState.tool !== 'lasso');

    // Dot scaling configuration helper
    function dotSize(s) {
      const min = sizePresets.value[0],
        max = sizePresets.value[sizePresets.value.length - 1];
      return Math.round(6 + ((s - min) / Math.max(1, max - min)) * 14) + 'px';
    }
    function toolIcon(tool) {
      return tool.id === 'lasso' ? lassoSvg : toolIconSvg(tool);
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
    function onImage() {
      emit('image');
    }
    function onDelete() {
      emit('delete');
    }

    return {
      sizePresets,
      showColors,
      showSizes,
      dotSize,
      toolIcon,
      bgClass,
      onTool,
      onColor,
      onColorInput,
      onSavePreset,
      onSize,
      onBg,
      onImage,
      onDelete,
    };
  },
};
</script>

<style scoped>
.paper-tool-icon :deep(svg) {
  width: 28px;
  height: auto;
  display: block;
}
</style>
