<template>
  <button
    :class="[
      'hoverable h-8 px-1 rounded-lg transition-colors flex items-center gap-1.5',
      drawing.mode.value === 'drawing' &&
        'bg-secondary ring-1 ring-inset ring-secondary',
    ]"
    @click="drawing.toggleMode()"
  >
    <v-remixicon name="riPencilLine" />
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
