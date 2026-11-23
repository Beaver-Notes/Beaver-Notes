<template>
  <canvas ref="el" class="ink-preview-image" />
</template>

<script setup>
import { onMounted, ref, watch } from 'vue';
import { PreviewImage, parsePreviewImage } from './ink/previewImage.js';

const props = defineProps({
  /** Serialized preview bitmap (JSON string or object): { width, height, strokes } */
  preview: { type: [String, Object], default: null },
  /** Source-of-truth strokes, used to composite a bitmap when preview is absent. */
  strokes: { type: Array, default: () => [] },
  width: { type: Number, default: 0 },
  height: { type: Number, default: 0 },
});

const el = ref(null);

function canvasSize() {
  return {
    width: Math.max(1, Math.round(props.width || 0)),
    height: Math.max(1, Math.round(props.height || 0)),
  };
}

function render() {
  const canvas = el.value;
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const dims = canvasSize();
  const dpr = (typeof window !== 'undefined' && window.devicePixelRatio) || 1;
  canvas.width = Math.max(1, Math.round(dims.width * dpr));
  canvas.height = Math.max(1, Math.round(dims.height * dpr));
  // CSS size stays in layout pixels: the browser must not upscale a 1x bitmap
  canvas.style.width = `${dims.width}px`;
  canvas.style.height = `${dims.height}px`;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, dims.width, dims.height);

  if (props.preview != null) {
    const parsed = parsePreviewImage(props.preview);
    if (parsed) parsed.drawTo(ctx);
  } else {
    // Fallback: composite a stroke bitmap from the `strokes` attr.
    const img = new PreviewImage({ width: dims.width, height: dims.height, strokes: props.strokes, canvas });
    img.commit();
  }
}

onMounted(render);
watch(
  () => [props.preview, props.strokes, props.width, props.height],
  render,
  { deep: true },
);
</script>
