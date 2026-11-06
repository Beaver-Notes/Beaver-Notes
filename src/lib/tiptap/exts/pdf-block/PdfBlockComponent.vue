<template>
  <NodeViewWrapper class="pdf-block" data-pdf-block>
    <div v-if="pdfError" class="pdf-error">
      <v-remixicon name="riFilePdfLine" class="w-6 h-6" />
      <p>{{ t('pdfBlock.error', 'This PDF could not be displayed') }}</p>
    </div>

    <div v-else class="pdf-frame">
      <!-- Header rail -->
      <div class="pdf-header">
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
      </div>

      <!-- Thumbnail filmstrip -->
      <div v-show="showThumbs" class="pdf-filmstrip" role="listbox">
        <button
          v-for="entry in railLayout_"
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
        :style="{ height: `${RAIL_HEIGHT}px` }"
      >
        <template v-if="ready">
          <div
            class="pdf-rail-pages"
            :style="{ width: `${railWidth}px`, height: `${RAIL_HEIGHT}px` }"
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
            :chrome="false"
            :tool="railTool"
            :tool-settings="toolSettings"
            :height="RAIL_HEIGHT"
            paper-type="transparent"
            media
            :node-key="surfaceKey"
            @commit="onRailCommit"
            @height-change="noop"
          />
        </template>
        <div v-if="loading" class="pdf-loading" aria-live="polite">
          <v-remixicon name="riLoader4Line" class="w-5 h-5 animate-spin" />
        </div>
      </div>
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
import InkPreview from '../paper-block/InkPreview.vue';
import MarkupEditor from './MarkupEditor.vue';
import { openPdf } from './pdfSource.js';
import {
  RAIL_PAGE_GAP,
  railLayout,
  railStrokeToStored,
  strokesToRail,
} from './pdfMarkup.js';
import { DRAW_TOOLS, RAIL_HEIGHT } from './constants.js';
import { parseStrokes, TOOL_DEFAULTS } from '../paper-block/ink/stroke-model';
import { useTranslations } from '@/composable/useTranslations';
import { resolveAssetPath } from '@/lib/tauri/scoped-storage';
import { readFileBinaryBytes } from '@/lib/native/fs';

const props = defineProps({ ...nodeViewProps });
const editor = computed(() => props.editor);

const { t } = useTranslations();
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

const pageDims = shallowRef([]);
const railLayout_ = computed(() =>
  railLayout(pageDims.value, RAIL_HEIGHT, RAIL_PAGE_GAP),
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

const thumbStrokes = (page) => {
  const entry = railLayout_.value[page];
  if (!entry) return [];
  return strokesToRail(
    markup.value.filter((s) => (s.page ?? 0) === page),
    [entry],
  );
};

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
  for (const entry of railLayout_.value) {
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
    const path = await resolveAssetPath(src);
    if (!path) throw new Error('unresolvable');
    const bytes = await readFileBinaryBytes(path);
    pdf = await openPdf(bytes);
    pageDims.value = await pdf.pageDims;
    ready.value = true;
    loading.value = false;
    await renderPages();
  } catch (error) {
    pdfError.value = true;
    ready.value = false;
    loading.value = false;
    console.warn('pdf-block: failed to load', error);
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

const noop = () => {};

watch(
  () => props.node.attrs.src,
  () => {
    if (props.node.attrs.src) load();
  },
);

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
.pdf-loading {
  @apply absolute inset-0 flex items-center justify-center bg-white/60 dark:bg-black/40;
}
</style>
