<template>
  <div
    class="inline-flex items-center justify-center rounded-full text-white font-medium shrink-0"
    :style="{
      backgroundColor: bgColor,
      width: size + 'px',
      height: size + 'px',
      fontSize: size * 0.4 + 'px',
    }"
  >
    {{ initials }}
  </div>
</template>

<script setup>
import { computed } from 'vue';

const props = defineProps({
  name: { type: String, default: '' },
  size: { type: Number, default: 32 },
});

const initials = computed(() => {
  const words = props.name.trim().split(/\s+/);
  if (words.length >= 2) return (words[0][0] + words[1][0]).toUpperCase();
  return (words[0]?.[0] || '?').toUpperCase();
});

const bgColor = computed(() => {
  let hash = 0;
  for (const c of props.name) hash = ((hash << 5) - hash + c.charCodeAt(0)) | 0;
  const hue = Math.abs(hash) % 360;
  return `hsl(${hue}, 55%, 45%)`;
});
</script>
