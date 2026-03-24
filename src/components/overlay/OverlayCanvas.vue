<template>
  <teleport to="body">
    <div
      class="overlay-canvas-root fixed inset-0 z-30 transition-opacity duration-150 ease-in-out"
      :class="
        drawing.mode.value === 'drawing'
          ? 'opacity-100 pointer-events-auto'
          : 'opacity-0 pointer-events-none'
      "
    >
      <svg
        ref="svgRef"
        class="size-full"
        @pointerdown="onPointerDown"
        @pointermove="onPointerMove"
        @pointerup="onPointerUp"
        @pointerleave="onPointerLeave"
        @pointercancel="onPointerCancel"
        @touchmove.prevent
        @touchstart.prevent
      >
        <g>
          <path
            v-for="stroke in drawing.strokes.value"
            :key="stroke.id"
            :d="drawing.getPathForStroke(stroke)"
            :fill="stroke.tool === 'pen' ? stroke.color : 'none'"
            :stroke="stroke.tool === 'highlighter' ? stroke.color : 'none'"
            :stroke-width="stroke.tool === 'highlighter' ? stroke.size : 0"
            :opacity="stroke.tool === 'highlighter' ? 0.38 : 1"
            stroke-linecap="round"
            stroke-linejoin="round"
          />
        </g>

        <path
          v-if="drawing.isDrawing.value && drawing.currentPathData.value"
          :d="drawing.currentPathData.value"
          :fill="
            drawing.activeTool.value === 'pen'
              ? drawing.activeSettings.value.color
              : 'none'
          "
          :stroke="
            drawing.activeTool.value === 'highlighter'
              ? drawing.activeSettings.value.color
              : 'none'
          "
          :stroke-width="
            drawing.activeTool.value === 'highlighter'
              ? drawing.activeSettings.value.size
              : 0
          "
          :opacity="drawing.activeTool.value === 'highlighter' ? 0.38 : 1"
          stroke-linecap="round"
          stroke-linejoin="round"
        />

        <circle
          v-if="showEraserCursor"
          :cx="eraserCursor.x"
          :cy="eraserCursor.y"
          :r="drawing.toolSettings.eraser.size / 2"
          fill="none"
          :stroke="eraserCursor.color"
          opacity="0.5"
          pointer-events="none"
        />
      </svg>
    </div>
  </teleport>
</template>

<script setup>
import { computed, onMounted, onUnmounted, reactive, ref } from 'vue';
import { useOverlayDrawing } from '@/composable/useOverlayDrawing';

const drawing = useOverlayDrawing();
const svgRef = ref(null);
const eraserCursor = reactive({
  x: 0,
  y: 0,
  color: drawing.toolSettings.pen.color,
});

const showEraserCursor = computed(
  () =>
    drawing.mode.value === 'drawing' && drawing.activeTool.value === 'eraser'
);

function updateCursorPosition(event) {
  if (!svgRef.value) return;

  const point = svgRef.value.createSVGPoint();
  point.x = event.clientX;
  point.y = event.clientY;

  const ctm = svgRef.value.getScreenCTM();
  const transformed = ctm ? point.matrixTransform(ctm.inverse()) : point;

  eraserCursor.x = transformed.x;
  eraserCursor.y = transformed.y;
  eraserCursor.color = drawing.toolSettings.pen.color;
}

function onPointerDown(event) {
  if (!svgRef.value) return;

  svgRef.value.setPointerCapture(event.pointerId);
  updateCursorPosition(event);
  drawing.beginStroke(svgRef.value, event);
}

function onPointerMove(event) {
  updateCursorPosition(event);
  drawing.continueStroke(svgRef.value, event);
}

function onPointerUp() {
  drawing.endStroke();
}

function onPointerLeave() {
  drawing.endStroke();
}

function onPointerCancel() {
  drawing.cancelStroke();
}

onMounted(() => {
  window.addEventListener('keydown', drawing.handleKeyDown);
});

onUnmounted(() => {
  window.removeEventListener('keydown', drawing.handleKeyDown);
});
</script>
