<template>
  <NodeViewWrapper class="pdf-block" data-pdf-block>
    <div v-if="pdfError" class="pdf-error">
      <v-remixicon name="riFilePdfLine" class="w-6 h-6" />
      <p>{{ t('pdfBlock.error', 'This PDF could not be displayed') }}</p>
    </div>

    <div v-else class="pdf-frame">
      <!-- Header rail -->
      <div class="pdf-header" @click="selectBlock">
        <span class="pdf-label">
          <v-remixicon name="riFilePdfLine" class="w-4 h-4" />
          {{ t('pdfBlock.title', 'PDF') }}
          <v-remixicon name="riArrowDownSLine" class="w-4 h-4 opacity-60" />
        </span>
        <button
          class="pdf-thumbs-toggle"
          type="button"
          @click="showThumbs = !showThumbs"
        >
          {{ t('pdfBlock.showThumbnails', 'Show Thumbnails') }}
        </button>
        <button
          class="pdf-convert-back"
          type="button"
          :title="t('pdfBlock.convertBack', 'Convert to attachment')"
          @click="convertBack"
        >
          <v-remixicon name="riArrowGoBackLine" class="w-4 h-4" />
        </button>
      </div>

      <!-- Thumbnail filmstrip -->
      <div v-show="showThumbs" class="pdf-filmstrip" role="listbox">
        <button
          v-for="entry in thumbLayout_"
          :key="entry.page"
          type="button"
          class="pdf-thumb"
          :style="{ width: `${entry.width}px`, height: `${entry.height}px` }"
          @click="openEditor(entry.page)"
        >
          <canvas :ref="(el) => setThumbRef(entry.page, el)" />
          <InkPreview
            class="pdf-thumb-ink"
            :strokes="thumbStrokes(entry.page)"
            :width="entry.width"
            :height="entry.height"
          />
        </button>
      </div>

      <!-- Inline ink rail -->
      <div
        ref="railRef"
        class="pdf-rail"
        :style="{ height: `${railHeight}px` }"
      >
        <template v-if="ready">
          <div
            class="pdf-rail-pages"
            :style="{ width: `${railWidth}px`, height: `${railHeight}px` }"
          >
            <canvas
              v-for="entry in railLayout_"
              :key="`rail-${entry.page}`"
              :ref="(el) => setRailPageRef(entry.page, el)"
              class="pdf-rail-page"
              :style="{
                left: `${entry.x}px`,
                width: `${entry.width}px`,
                height: `${entry.height}px`,
              }"
            />
          </div>
          <PaperSurface
            class="pdf-rail-surface"
            :strokes="railStrokes"
            :focused="true"
            :chrome="selected"
            :tool="railTool"
            :tool-settings="toolSettings"
            :height="railHeight"
            paper-type="transparent"
            media
            :node-key="surfaceKey"
            @commit="onRailCommit"
            @height-change="onRailHeight"
          />
        </template>
        <div v-if="loading" class="pdf-loading" aria-live="polite">
          <v-remixicon name="riLoader4Line" class="w-5 h-5 animate-spin" />
        </div>
      </div>
      <PaperToolbar
        v-if="selected && ready"
        class="pdf-rail-toolbar"
        :tools="railTools"
        :tool="tool"
        :paper-types="[]"
        :current-tool-color="currentToolColor"
        :current-tool-size="currentToolSize"
        :active-presets="[]"
        :can-undo="canUndo"
        :can-redo="canRedo"
        @tool="tool = $event"
        @color="setColor"
        @color-input="setColor"
        @size="setSize"
        @undo="editor.commands.undo()"
        @redo="editor.commands.redo()"
      />
    </div>

    <MarkupEditor
      v-if="editorPage !== null && ready"
      :pages="pageDims"
      :doc="pdf"
      :initial-page="editorPage"
        :strokes="markup"
        :tool="tool"
        :tool-settings="toolSettings"
        :can-undo="canUndo"
        :can-redo="canRedo"
        @close="editorPage = null"
        @commit="onEditorCommit"
        @update-page="onEditorUpdatePage"
        @undo="editor.commands.undo()"
        @redo="editor.commands.redo()"
        @tool="(value) => (tool = value)"
        @color="onEditorColor"
        @color-input="onEditorColor"
        @size="setSize"
      />
  </NodeViewWrapper>
</template>

<script setup>
import {
  computed,
  nextTick,
  onBeforeUnmount,
  onMounted,
  ref,
  shallowRef,
  watch,
} from 'vue';
import { NodeViewWrapper, nodeViewProps } from '@tiptap/vue-3';
import PaperSurface from '../paper-block/PaperSurface.vue';
import PaperToolbar from '../paper-block/PaperToolbar.vue';
import InkPreview from '../paper-block/InkPreview.vue';
import MarkupEditor from './MarkupEditor.vue';
import { openPdf } from './pdfSource.js';
import { decodeDataUrl } from './dataUrl.js';
import { fetchAssetBytes } from './assetBytes.js';
import {
  RAIL_PAGE_GAP,
  railLayout,
  railStrokeToStored,
  strokesToRail,
} from './pdfMarkup.js';
import { DRAW_TOOLS, RAIL_HEIGHT, THUMB_HEIGHT } from './constants.js';
import { parseStrokes, TOOL_DEFAULTS } from '../paper-block/ink/stroke-model';
import { useTranslations } from '@/composable/useTranslations';

const props = defineProps({ ...nodeViewProps });
const editor = computed(() => props.editor);

const { translations } = useTranslations();
const t = (key, fallback) => {
  const dot = key.indexOf('.');
  return (
    translations.value?.[key.slice(0, dot)]?.[key.slice(dot + 1)] ?? fallback
  );
};
const loading = ref(true);
const pdfError = ref(false);
const ready = ref(false);
const showThumbs = ref(false);
const editorPage = ref(null);
const surfaceKey = `pdf-${Math.random().toString(36).slice(2, 8)}`;

const tool = ref('pen');
const toolSettings = ref(
  Object.fromEntries(
    Object.entries(TOOL_DEFAULTS).map(([name, settings]) => [
      name,
      { ...settings },
    ]),
  ),
);

const markup = computed(() => parseStrokes(props.node.attrs.markup));

const railHeight = computed(() => Number(props.node.attrs.height) || RAIL_HEIGHT);
const pageDims = shallowRef([]);
const railLayout_ = computed(() =>
  railLayout(pageDims.value, railHeight.value, RAIL_PAGE_GAP),
);
const railWidth = computed(() => {
  const entries = railLayout_.value;
  if (!entries.length) return 0;
  const last = entries.at(-1);
  return last.x + last.width;
});
const railStrokes = computed(() =>
  strokesToRail(markup.value, railLayout_.value),
);
const railTool = computed(() =>
  DRAW_TOOLS.includes(tool.value) ? tool.value : null,
);
const currentSettings = computed(
  () => toolSettings.value[tool.value] ?? TOOL_DEFAULTS.pen,
);
const currentToolColor = computed(() => currentSettings.value.color);
const currentToolSize = computed(() => currentSettings.value.size);
const railTools = computed(() => {
  const labels = translations.value.paperBlock ?? {};
  const swatch = (id, label) => ({
    id,
    label,
    hasSwatch: true,
    _color: toolSettings.value[id]?.color ?? TOOL_DEFAULTS[id].color,
  });
  return [
    swatch('pen', labels.pen || 'Pen'),
    swatch('pencil', labels.pencil || 'Pencil'),
    swatch('fountain', labels.fountainPen || 'Fountain pen'),
    swatch('marker', labels.highlighter || 'Highlighter'),
  ];
});

const thumbStrokes = (page) => {
  const entry = thumbLayout_.value[page];
  if (!entry) return [];
  return strokesToRail(
    markup.value.filter((s) => (s.page ?? 0) === page),
    [entry],
  );
};

const thumbLayout_ = computed(() =>
  railLayout(pageDims.value, THUMB_HEIGHT, RAIL_PAGE_GAP),
);

const thumbCanvases = new Map();
const railCanvases = new Map();
let renderToken = 0;

function setThumbRef(page, el) {
  if (el) thumbCanvases.set(page, el);
}
function setRailPageRef(page, el) {
  if (el) railCanvases.set(page, el);
}

function sizeCanvas(canvas, cssWidth, cssHeight) {
  const dpr = devicePixelRatio || 1;
  canvas.width = Math.max(1, Math.ceil(cssWidth * dpr));
  canvas.height = Math.max(1, Math.ceil(cssHeight * dpr));
}

async function renderPages() {
  const token = ++renderToken;
  await nextTick();
  const dims = pageDims.value;
  if (!dims.length) return;
  for (const entry of railLayout_.value) {
    const canvas = railCanvases.get(entry.page);
    if (!canvas || token !== renderToken) return;
    sizeCanvas(canvas, entry.width, entry.height);
    try {
      await pdf.renderPage(
        entry.page,
        canvas,
        (entry.height / dims[entry.page].height) * (devicePixelRatio || 1),
      );
    } catch {}
  }
  for (const entry of thumbLayout_.value) {
    const canvas = thumbCanvases.get(entry.page);
    if (!canvas || token !== renderToken) return;
    sizeCanvas(canvas, entry.width, entry.height);
    try {
      await pdf.renderPage(
        entry.page,
        canvas,
        (entry.height / dims[entry.page].height) * (devicePixelRatio || 1),
      );
    } catch {}
  }
}

let pdf = null;

async function load() {
  loading.value = true;
  pdfError.value = false;
  ready.value = false;
  try {
    const src = String(props.node.attrs.src || '');
    const inlineBytes = decodeDataUrl(src);
    if (inlineBytes) {
      pdf = await openPdf(inlineBytes);
    } else {
      pdf = await openPdf(await fetchAssetBytes(src));
    }
    pageDims.value = await pdf.pageDims;
    ready.value = true;
    loading.value = false;
    await renderPages();
  } catch (error) {
    pdfError.value = true;
    ready.value = false;
    loading.value = false;
    console.warn('pdf-block: failed to load', String(props.node.attrs.src || ''), error);
  }
}

function openEditor(page) {
  editorPage.value = page;
}

function commitMarkup(next) {
  props.updateAttributes({ markup: next });
}

function onRailCommit(railStroke) {
  const stored = railStrokeToStored(railStroke, railLayout_.value);
  if (!stored.length) return;
  commitMarkup([...markup.value, ...stored]);
}

function onEditorCommit(stroke) {
  commitMarkup([...markup.value, stroke]);
}

function onEditorUpdatePage({ page, strokes }) {
  const kept = markup.value.filter((s) => (s.page ?? 0) !== page);
  commitMarkup([...kept, ...strokes]);
}

function onEditorColor(color) {
  toolSettings.value[tool.value] = {
    ...toolSettings.value[tool.value],
    color,
  };
}

function setColor(color) {
  onEditorColor(color);
}

function setSize(size) {
  toolSettings.value[tool.value] = {
    ...toolSettings.value[tool.value],
    size,
  };
}

function onRailHeight(px) {
  props.updateAttributes({ height: Math.max(60, Math.round(px)) });
}

function convertBack() {
  const view = props.editor?.view;
  const pos = props.getPos?.();
  if (!view || typeof pos !== 'number') return;
  try {
    const next = view.state.schema.nodes.fileEmbed.create({
      src: props.node.attrs.src ?? '',
      fileName: props.node.attrs.fileName ?? null,
      markup: markup.value,
    });
    view.dispatch(view.state.tr.replaceWith(pos, pos + (props.node.nodeSize ?? 0), next));
  } catch (error) {
    console.warn('pdf-block: convert back failed', error);
  }
}

function selectBlock() {
  const pos = props.getPos?.();
  if (typeof pos === 'number') props.editor.commands.setNodeSelection(pos);
}

watch(
  () => props.node.attrs.src,
  () => {
    if (props.node.attrs.src) load();
  },
);

// Height changes re-layout the rail; page canvases must re-render at the new
// scale or they stretch stale bitmaps (unreadable after resize).
watch(railHeight, () => {
  if (ready.value) renderPages();
});

onMounted(load);
onBeforeUnmount(() => {
  renderToken += 1;
});
</script>

<style scoped>
.pdf-error {
  @apply flex items-center gap-2 p-4 rounded-xl bg-neutral-100 dark:bg-neutral-800 text-neutral-500;
}
.pdf-header {
  @apply flex items-center justify-between px-2 py-1;
}
.pdf-label {
  @apply flex items-center gap-1 text-sm font-medium;
}
.pdf-thumbs-toggle {
  @apply text-xs px-2 py-1 rounded-md hover:bg-neutral-100 dark:hover:bg-neutral-800;
}
.pdf-filmstrip {
  @apply flex gap-2 overflow-x-auto px-2 pb-2;
}
.pdf-thumb {
  @apply relative shrink-0 rounded border border-neutral-200 dark:border-neutral-700 overflow-hidden p-0;
}
.pdf-thumb-ink {
  @apply absolute inset-0 pointer-events-none;
}
.pdf-rail {
  @apply relative w-full overflow-x-auto rounded-lg;
}
.pdf-rail-pages {
  @apply absolute top-0 left-0;
}
.pdf-rail-page {
  @apply absolute top-0 bg-white shadow-sm;
}
.pdf-rail-surface {
  @apply absolute inset-0;
}
.pdf-rail-toolbar {
  @apply mt-1;
}
.pdf-convert-back {
  @apply text-xs px-1.5 py-1 rounded-md hover:bg-neutral-100 dark:hover:bg-neutral-800;
}
.pdf-loading {
  @apply absolute inset-0 flex items-center justify-center bg-white/60 dark:bg-black/40;
}
</style>
