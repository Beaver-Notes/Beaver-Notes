<template>
  <div ref="viewer" :class="['mermaid-viewer', className]" @click="onClick">
    <div
      v-if="svgHtml"
      :class="['mermaid-svg', { 'is-wide': isWide }]"
      :style="isWide ? { '--mermaid-rendered-width': renderedWidth + 'px' } : null"
      v-html="svgHtml"
    ></div>

    <div v-else-if="fallback" class="mermaid-fallback">
      <span
        v-if="fallback.kind === 'unsupported'"
        class="mermaid-fallback-badge"
      >
        {{
          translations.editor.unsupportedDiagram || 'Unsupported diagram type'
        }}
      </span>
      <pre class="mermaid-fallback-code">{{ content }}</pre>
      <p v-if="fallback.kind === 'error'" class="mermaid-fallback-error">
        {{ fallback.message }}
      </p>
    </div>
  </div>
</template>

<script>
import {
  defineComponent,
  nextTick,
  onBeforeUnmount,
  onMounted,
  ref,
  watch,
} from 'vue';
import { renderMermaidSVG } from 'beautiful-mermaid';
import { useTheme } from '@/composable/theme';
import { useTranslations } from '@/composable/useTranslations';

// beautiful-mermaid renders exactly these types; everything else gets the
// plaintext "unsupported" badge instead of a library exception.
const SUPPORTED_TYPES = new Set([
  'flowchart',
  'state',
  'sequence',
  'class',
  'er',
  'xychart',
  'pie',
  'mindmap',
  'timeline',
  'quadrant',
]);

// Extension point: add new diagram types here as support lands. Types present
// in SUPPORTED_TYPES render; the others fall back to a plaintext badge.
const TYPE_PATTERNS = [
  [/^(?:graph|flowchart)\b/i, 'flowchart'],
  [/^stateDiagram(-v2)?\b/i, 'state'],
  [/^sequenceDiagram\b/i, 'sequence'],
  [/^classDiagram\b/i, 'class'],
  [/^erDiagram\b/i, 'er'],
  [/^xychart-beta\b/i, 'xychart'],
  [/^pie\b/i, 'pie'],
  [/^gantt\b/i, 'gantt'],
  [/^mindmap\b/i, 'mindmap'],
  [/^journey\b/i, 'journey'],
  [/^timeline\b/i, 'timeline'],
  [/^gitGraph\b/i, 'gitgraph'],
  [/^quadrantChart\b/i, 'quadrant'],
  [/^sankey-beta\b/i, 'sankey'],
  [/^block-beta\b/i, 'block'],
  [/^kanban-beta\b/i, 'kanban'],
  [/^packet-beta\b/i, 'packet'],
  [/^architecture-beta\b/i, 'architecture'],
  [/^zenuml\b/i, 'zenuml'],
];

function detectType(content) {
  const firstLine =
    content
      .split('\n')
      .map((line) => line.trim())
      .find((line) => line.length > 0 && !line.startsWith('%%')) || '';

  for (const [pattern, type] of TYPE_PATTERNS) {
    if (pattern.test(firstLine)) {
      return { type, supported: SUPPORTED_TYPES.has(type) };
    }
  }
  return { type: null, supported: false };
}

// Memoized render: output is pure for (source, theme), and card previews
// remount on scroll while the editor re-renders on unrelated updates.
const svgCache = new Map();
const SVG_CACHE_MAX = 100;

function renderCached(content, dark) {
  const key = `${dark ? 'd' : 'l'}:${content}`;
  if (svgCache.has(key)) return svgCache.get(key);
  const svg = renderMermaidSVG(content, resolveThemeColors());
  if (svgCache.size >= SVG_CACHE_MAX) svgCache.clear();
  svgCache.set(key, svg);
  return svg;
}

// Intrinsic width of the rendered SVG in its own units (from viewBox).
function naturalWidth(svg) {
  const match = svg.match(/viewBox="[\d.+-]+\s+[\d.+-]+\s+([\d.]+)\s+[\d.+-]+"/);
  return match ? parseFloat(match[1]) : 0;
}

function resolveThemeColors() {
  const styles = window.getComputedStyle(document.documentElement);
  const read = (name, fallback) =>
    styles.getPropertyValue(name).trim() || fallback;

  return {
    bg: read('--app-theme-background', '#ffffff'),
    fg: read('--text-dark', '#171717'),
    muted: read('--text-muted', '#737373'),
    transparent: true,
  };
}

export default defineComponent({
  name: 'MermaidChart',
  props: {
    content: {
      type: String,
      required: true,
    },
    className: {
      type: String,
      default: '',
    },
    // Opt-in: keep wide diagrams at a readable scale and scroll them. Off by
    // default so compact contexts (card previews) keep shrinking to fit.
    scrollWide: {
      type: Boolean,
      default: false,
    },
    onClick: {
      type: Function,
      default: () => {},
    },
  },
  setup(props) {
    const { isDark } = useTheme();
    const { translations } = useTranslations();

    const viewer = ref(null);
    const svgHtml = ref('');
    const svgWidth = ref(0);
    const isWide = ref(false);
    const renderedWidth = ref(0);
    const fallback = ref(null);

    // A diagram wider than its card is drawn at a fraction of its natural size
    // and scrolls horizontally, instead of being shrunk until its labels are
    // unreadable. Raise toward 1 for bigger text, lower for a more compact view.
    const WIDE_MIN_SCALE = 0.50;

    const measure = () => {
      const available = viewer.value?.clientWidth ?? 0;
      const natural = svgWidth.value;
      // available === 0 means not laid out yet (hidden/collapsed); don't guess.
      isWide.value =
        props.scrollWide &&
        Boolean(svgHtml.value) &&
        available > 0 &&
        natural > available;
      renderedWidth.value = isWide.value
        ? Math.max(available, Math.round(natural * WIDE_MIN_SCALE))
        : 0;
    };

    const render = () => {
      if (!props.content?.trim()) {
        svgHtml.value = '';
        fallback.value = null;
        nextTick(measure);
        return;
      }

      const { type, supported } = detectType(props.content);

      if (!supported && type) {
        svgHtml.value = '';
        fallback.value = { kind: 'unsupported', message: '' };
        nextTick(measure);
        return;
      }

      try {
        svgHtml.value = renderCached(props.content, isDark());
        svgWidth.value = naturalWidth(svgHtml.value);
        fallback.value = null;
      } catch (error) {
        svgHtml.value = '';
        fallback.value = {
          kind: 'error',
          message: error instanceof Error ? error.message : String(error),
        };
      }
      nextTick(measure);
    };

    // Re-measure when the card itself changes size (editor resize, sidebar, etc.).
    let observer = null;
    onMounted(() => {
      if (typeof ResizeObserver !== 'undefined' && viewer.value) {
        observer = new ResizeObserver(measure);
        observer.observe(viewer.value);
      }
    });
    onBeforeUnmount(() => observer?.disconnect());

    watch(() => props.content, render, { immediate: true });

    watch(
      () => isDark(),
      () => render(),
    );

    return {
      viewer,
      svgHtml,
      svgWidth,
      isWide,
      renderedWidth,
      fallback,
      translations,
    };
  },
});
</script>

<style scoped>
.mermaid-viewer {
  width: 100%;
  max-width: 100%;
  overflow-x: auto;
  cursor: pointer;
}

.mermaid-svg :deep(svg) {
  display: block;
  max-width: 100%;
  height: auto;
  margin: 0 auto;
}

/* Wide diagrams: scaled-down width; the viewer scrolls horizontally. */
.mermaid-svg.is-wide :deep(svg) {
  width: var(--mermaid-rendered-width) !important;
  max-width: none !important;
}

:deep(div.label) {
  color: inherit;
}

.mermaid-fallback {
  width: 100%;
  text-align: left;
}

.mermaid-fallback-badge {
  display: inline-block;
  margin-bottom: 0.5rem;
  padding: 0.125rem 0.5rem;
  border-radius: 9999px;
  font-size: 0.6875rem;
  font-weight: 500;
  color: var(--text-muted);
  background: color-mix(in srgb, var(--text-muted) 12%, transparent);
}

.mermaid-fallback-code {
  margin: 0;
  overflow-x: auto;
  font-family: var(--selected-font-code);
  font-size: 0.8125rem;
  line-height: 1.5;
  white-space: pre-wrap;
  word-break: break-word;
  color: var(--text-dark);
}

.mermaid-fallback-error {
  margin: 0.5rem 0 0;
  font-size: 0.75rem;
  color: #dc2626;
}
</style>
