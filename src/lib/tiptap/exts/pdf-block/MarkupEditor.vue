<template>
  <Teleport to="body">
    <div class="markup-editor" role="dialog" aria-modal="true">
      <header class="markup-header">
        <button class="markup-close" type="button" @click="$emit('close')">
          <v-remixicon name="riCloseLine" class="w-5 h-5" />
        </button>
        <span class="markup-page-label">
          {{ activePage + 1 }} / {{ pages.length }}
        </span>
      </header>

      <div
        ref="scrollerRef"
        class="markup-pages"
        @scroll.passive="onScroll"
      >
        <div
          v-for="(dim, page) in pages"
          :key="page"
          class="markup-page"
          :style="{ width: `${pageWidth}px`, height: `${pageHeight}px` }"
        >
          <canvas
            :ref="(el) => setPageRef(page, el)"
            class="markup-page-canvas"
            :style="{
              left: `${offsetX}px`,
              width: `${dim.width * pageScale}px`,
              height: `${dim.height * pageScale}px`,
            }"
          />
          <PaperSurface
            v-if="page >= activeWindow.start && page <= activeWindow.end"
            class="markup-overlay"
            :strokes="viewportStrokes(page)"
            :focused="true"
            :chrome="false"
            :tool="tool"
            :tool-settings="toolSettings"
            :height="pageHeight"
            paper-type="transparent"
            media
            :node-key="`markup-${page}`"
            @commit="(stroke) => $emit('commit', toStored(stroke))"
            @update-strokes="
              (strokes) => $emit('update-page', { page, strokes: strokes.map(toStored) })
            "
          />
        </div>
      </div>

      <!-- Floating bottom toolbar pill -->
      <div class="markup-toolbar">
        <button
          class="markup-tool"
          type="button"
          :disabled="!canUndo"
          @click="$emit('undo')"
        >
          <v-remixicon name="riArrowGoBackLine" class="w-5 h-5" />
        </button>
        <button
          class="markup-tool"
          type="button"
          :disabled="!canRedo"
          @click="$emit('redo')"
        >
          <v-remixicon name="riArrowGoForwardLine" class="w-5 h-5" />
        </button>
        <span class="markup-sep" />
        <button
          v-for="name in TOOLS"
          :key="name"
          type="button"
          class="markup-tool"
          :class="{ 'is-active': tool === name }"
          @click="$emit('tool', name)"
        >
          <v-remixicon :name="TOOL_ICONS[name]" class="w-5 h-5" />
        </button>
        <span class="markup-sep" />
        <button
          v-for="swatch in SWATCHES"
          :key="swatch"
          type="button"
          class="markup-swatch"
          :style="{ background: swatch }"
          :aria-label="swatch"
          @click="$emit('color', swatch)"
        />
        <button
          class="markup-tool"
          type="button"
          :disabled="true"
          :title="t('pdfBlock.add', 'Add')"
          @click="() => {}"
        >
          <v-remixicon name="riAddLine" class="w-5 h-5" />
        </button>
      </div>
    </div>
  </Teleport>
</template>

<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue';
import PaperSurface from '../paper-block/PaperSurface.vue';
import { offsetStrokes } from './pdfMarkup.js';
import { useTranslations } from '@/composable/useTranslations';

const TOOLS = ['pen', 'pencil', 'fountain', 'marker', 'eraser', 'lasso'];
const TOOL_ICONS = {
  pen: 'riBallPenLine',
  pencil: 'riPencilLine',
  fountain: 'riQuillPenLine',
  marker: 'riMarkerLine',
  eraser: 'riEraserLine',
  lasso: 'riLassoLine',
};
const SWATCHES = ['#1a1a1a', '#4a4a4a', '#1a2744', '#fbbf24'];

const props = defineProps({
  pages: { type: Array, default: () => [] }, // [{width, height}] pdf points
  doc: { type: Object, default: null }, // openPdf() handle
  initialPage: { type: Number, default: 0 },
  strokes: { type: Array, default: () => [] },
  tool: { type: String, default: 'pen' },
  toolSettings: { type: Object, default: () => ({}) },
  canUndo: { type: Boolean, default: false },
  canRedo: { type: Boolean, default: false },
});
const emit = defineEmits([
  'close',
  'commit',
  'update-page',
  'undo',
  'redo',
  'tool',
  'color',
]);

const { t } = useTranslations();

const scrollerRef = ref(null);
const pageCanvases = new Map();
const viewportW = ref(window.innerWidth);
const viewportH = ref(window.innerHeight);

const pageScale = computed(() => {
  // fit page width into the viewport with side margins for spill
  const margin = Math.min(48, viewportW.value * 0.05);
  const maxW = viewportW.value - margin * 2;
  const first = props.pages[0] ?? { width: 612 };
  return Math.min(1.5, maxW / first.width);
});
const pageWidth = computed(() => viewportW.value);
const pageHeight = computed(() => {
  const first = props.pages[0] ?? { height: 792 };
  return Math.ceil(first.height * pageScale.value);
});
const offsetX = computed(() => {
  const first = props.pages[0] ?? { width: 612 };
  return Math.round((pageWidth.value - first.width * pageScale.value) / 2);
});

/** Only the page pair around the scroll position gets a live overlay. */
const activePage = ref(props.initialPage);
const activeWindow = computed(() => ({
  start: Math.max(0, activePage.value - 1),
  end: Math.min(props.pages.length - 1, activePage.value + 1),
}));

function viewportStrokes(page) {
  const pageStrokesList = props.strokes.filter(
    (stroke) => (stroke.page ?? 0) === page,
  );
  return offsetStrokes(pageStrokesList, offsetX.value);
}

function toStored(stroke) {
  return {
    ...stroke,
    points: stroke.points.map(([x, y, p]) => [
      x - offsetX.value,
      y,
      p,
    ]),
  };
}

function setPageRef(page, el) {
  if (el) pageCanvases.set(page, el);
}

async function renderVisible() {
  const dims = props.pages;
  if (!dims.length || !props.doc) return;
  const { start, end } = activeWindow.value;
  for (let page = start; page <= end; page += 1) {
    const canvas = pageCanvases.get(page);
    if (!canvas) continue;
    const dim = dims[page];
    canvas.width = Math.ceil(
      dim.width * pageScale.value * (devicePixelRatio || 1),
    );
    canvas.height = Math.ceil(
      dim.height * pageScale.value * (devicePixelRatio || 1),
    );
    try {
      await props.doc.renderPage(
        page,
        canvas,
        pageScale.value * (devicePixelRatio || 1),
      );
    } catch {}
  }
}

function onScroll() {
  const el = scrollerRef.value;
  if (!el) return;
  activePage.value = Math.min(
    props.pages.length - 1,
    Math.max(0, Math.round(el.scrollLeft / pageWidth.value)),
  );
  renderVisible();
}

onMounted(async () => {
  await renderVisible();
  await nextTick();
  const el = scrollerRef.value;
  if (el) el.scrollLeft = props.initialPage * pageWidth.value;
});
onBeforeUnmount(() => {});
</script>

<style scoped>
.markup-editor {
  @apply fixed inset-0 z-50 bg-neutral-900 text-white flex flex-col;
}
.markup-header {
  @apply flex items-center justify-between px-4 py-2;
}
.markup-close {
  @apply p-1 rounded-md hover:bg-white/10;
}
.markup-page-label {
  @apply text-sm opacity-70;
}
.markup-pages {
  @apply flex-1 flex overflow-x-auto snap-x snap-mandatory;
}
.markup-page {
  @apply relative shrink-0 snap-center bg-neutral-800;
}
.markup-page-canvas {
  @apply absolute top-0 bg-white;
}
.markup-overlay {
  @apply absolute inset-0;
}
.markup-toolbar {
  @apply flex items-center gap-1 px-3 py-2 m-3 self-center rounded-full bg-neutral-800/95 shadow-lg;
}
.markup-tool {
  @apply p-2 rounded-full hover:bg-white/10 disabled:opacity-30;
}
.markup-tool.is-active {
  @apply bg-white/15;
}
.markup-swatch {
  @apply w-5 h-5 rounded-full border border-white/20;
}
.markup-sep {
  @apply w-px h-6 bg-white/15 mx-1;
}
</style>
