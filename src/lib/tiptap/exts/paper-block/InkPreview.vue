<template>
  <canvas ref="el" class="ink-preview" />
</template>

<script setup>
import { onMounted, ref, watch } from 'vue';
import { strokeOutline } from './ink/smoother.js';

const props = defineProps({
  strokes: { type: Array, default: () => [] },
  width: { type: Number, default: 0 },
  height: { type: Number, default: 0 },
});

const el = ref(null);
let ctx = null;

function draw() {
  if (!ctx) return;
  ctx.clearRect(0, 0, props.width, props.height);
  for (const stroke of props.strokes) {
    const outline = strokeOutline(stroke);
    if (outline.length < 2) continue;
    ctx.globalAlpha = stroke.opacity ?? 1;
    ctx.fillStyle = stroke.color ?? '#000';
    ctx.beginPath();
    ctx.moveTo(outline[0][0], outline[0][1]);
    for (let i = 1; i < outline.length; i += 1) {
      ctx.lineTo(outline[i][0], outline[i][1]);
    }
    ctx.closePath();
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

onMounted(() => {
  const dpr = devicePixelRatio || 1;
  el.value.width = Math.max(1, props.width * dpr);
  el.value.height = Math.max(1, props.height * dpr);
  el.value.style.width = `${props.width}px`;
  el.value.style.height = `${props.height}px`;
  ctx = el.value.getContext('2d');
  if (ctx) ctx.scale(dpr, dpr);
  draw();
});

watch(() => props.strokes, draw);
</script>
