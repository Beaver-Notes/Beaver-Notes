<template>
  <button
    :class="[
      'hoverable h-8 px-1.5 rounded-lg transition-colors flex items-center gap-1.5',
      drawing.mode.value === 'drawing' &&
        'bg-secondary ring-1 ring-inset ring-secondary',
    ]"
    @click="drawing.toggleMode()"
  >
    <svg viewBox="0 0 18 18" class="size-[18px]" fill="none">
      <path
        d="M5.3 11.9 11.9 5.3l2.7 2.7-6.6 6.6-3 .5z"
        :fill="pencilFill"
        stroke="currentColor"
        stroke-width="1.1"
        stroke-linejoin="round"
      />
      <path
        d="M11.4 4.8 13.2 3l1.8 1.8-1.8 1.8z"
        fill="#f9a8d4"
        fill-opacity="0.8"
        stroke="currentColor"
        stroke-width="1.1"
        stroke-linejoin="round"
      />
      <path
        d="M7.3 10 10 7.3"
        stroke="currentColor"
        stroke-opacity="0.3"
        stroke-width="0.9"
        stroke-linecap="round"
      />
      <circle
        cx="5.8"
        cy="12.4"
        r="1.2"
        :fill="drawing.toolSettings.pen.color"
      />
    </svg>
    <span v-if="drawing.mode.value === 'drawing'" class="text-xs font-medium">
      Drawing
    </span>
  </button>
</template>

<script setup>
import { computed } from 'vue';
import { useOverlayDrawing } from '@/composable/useOverlayDrawing';

const drawing = useOverlayDrawing();

const pencilFill = computed(() =>
  drawing.mode.value === 'drawing'
    ? `${drawing.toolSettings.pen.color}33`
    : 'none'
);
</script>
