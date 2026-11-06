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
        <button class="markup-done" type="button" @click="$emit('close')">
          {{ t('pdfBlock.done', 'Done') }}
        </button>
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

      <!-- Shared drawing toolbar -->
      <PaperToolbar
        class="markup-toolbar-bar"
        :tools="tools"
        :tool="tool"
        :paper-types="[]"
        :current-tool-color="currentToolColor"
        :current-tool-size="currentToolSize"
        :active-presets="[]"
        :can-undo="canUndo"
        :can-redo="canRedo"
        @tool="(value) => $emit('tool', value)"
        @color="(value) => $emit('color', value)"
        @color-input="(value) => $emit('color', value)"
        @size="(value) => $emit('size', value)"
        @save-preset="() => {}"
        @bg="() => {}"
        @undo="$emit('undo')"
        @redo="$emit('redo')"
      />
    </div>
  </Teleport>
</template>

<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue';
import PaperSurface from '../paper-block/PaperSurface.vue';
import PaperToolbar from '../paper-block/PaperToolbar.vue';
import { offsetStrokes } from './pdfMarkup.js';
import { TOOL_DEFAULTS } from '../paper-block/ink/stroke-model';
import { useTranslations } from '@/composable/useTranslations';

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
  'size',
]);

const { translations } = useTranslations();
const t = (key, fallback) => {
  const dot = key.indexOf('.');
  return (
    translations.value?.[key.slice(0, dot)]?.[key.slice(dot + 1)] ?? fallback
  );
};

const tools = computed(() => {
  const labels = translations.value.paperBlock ?? {};
  const swatch = (id, label) => ({
    id,
    label,
    hasSwatch: true,
    _color: props.toolSettings?.[id]?.color ?? TOOL_DEFAULTS[id].color,
  });
  return [
    swatch('pen', labels.pen || 'Pen'),
    swatch('pencil', labels.pencil || 'Pencil'),
    swatch('fountain', labels.fountainPen || 'Fountain pen'),
    swatch('marker', labels.highlighter || 'Highlighter'),
    { id: 'eraser', label: labels.eraser || 'Eraser', hasSwatch: false, _color: null },
    { id: 'lasso', label: labels.lassoSelect || 'Lasso select', hasSwatch: false, _color: null },
  ];
});
const currentSettings = computed(
  () => props.toolSettings?.[props.tool] ?? TOOL_DEFAULTS.pen,
);
const currentToolColor = computed(() => currentSettings.value.color);
const currentToolSize = computed(() => currentSettings.value.size);

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
/* app tokens: --color-bg/--color-text flip with the app theme, dark-mode free */
.markup-editor {
  @apply fixed inset-0 z-50 flex flex-col;
  background: var(--color-bg, #fff);
  color: var(--color-text, #1a1a1a);
  padding-top: env(safe-area-inset-top);
  padding-bottom: env(safe-area-inset-bottom);
}
.markup-header {
  @apply flex items-center justify-between px-4 py-2 gap-2;
}
.markup-close {
  @apply p-1 rounded-md hover:bg-neutral-500/10;
}
.markup-page-label {
  @apply text-sm opacity-70;
}
.markup-done {
  @apply px-3 py-1 rounded-full text-sm font-medium;
  background: var(--color-text, #1a1a1a);
  color: var(--color-bg, #fff);
}
.markup-pages {
  @apply flex-1 flex overflow-x-auto snap-x snap-mandatory;
}
.markup-page {
  @apply relative shrink-0 snap-center;
  background: var(--color-text, #1a1a1a);
}
.markup-page-canvas {
  @apply absolute top-0 bg-white;
}
.markup-overlay {
  @apply absolute inset-0;
}
.markup-toolbar-bar {
  @apply mt-auto self-center mb-3;
}
</style>
