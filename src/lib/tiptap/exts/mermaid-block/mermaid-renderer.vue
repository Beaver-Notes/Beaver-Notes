<template>
  <div
    :class="['mermaid-viewer', className]"
    @click="onClick"
  >
    <div
      v-if="svgHtml"
      class="mermaid-svg"
      v-html="svgHtml"
    ></div>

    <div
      v-else-if="fallback"
      class="mermaid-fallback"
    >
      <span
        v-if="fallback.kind === 'unsupported'"
        class="mermaid-fallback-badge"
      >
        {{
          translations.editor.unsupportedDiagram ||
          'Unsupported diagram type'
        }}
      </span>
      <pre class="mermaid-fallback-code">{{ content }}</pre>
      <p
        v-if="fallback.kind === 'error'"
        class="mermaid-fallback-error"
      >
        {{ fallback.message }}
      </p>
    </div>
  </div>
</template>

<script>
import { defineComponent, ref, watch } from 'vue';
import { renderMermaidSVG } from 'beautiful-mermaid';
import { useTheme } from '@/composable/theme';
import { useTranslations } from '@/composable/useTranslations';

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
  'quadrant'
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
    onClick: {
      type: Function,
      default: () => {},
    },
  },
  setup(props) {
    const { isDark } = useTheme();
    const { translations } = useTranslations();

    const svgHtml = ref('');
    const fallback = ref(null);

    const render = () => {
      if (!props.content?.trim()) {
        svgHtml.value = '';
        fallback.value = null;
        return;
      }

      const { type, supported } = detectType(props.content);

      if (!supported && type) {
        svgHtml.value = '';
        fallback.value = { kind: 'unsupported', message: '' };
        return;
      }

      try {
        svgHtml.value = renderMermaidSVG(props.content, resolveThemeColors());
        fallback.value = null;
      } catch (error) {
        svgHtml.value = '';
        fallback.value = {
          kind: 'error',
          message: error instanceof Error ? error.message : String(error),
        };
      }
    };

    watch(() => props.content, render, { immediate: true });

    watch(
      () => isDark(),
      () => render()
    );

    return {
      svgHtml,
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
  display: flex;
  justify-content: center;
  cursor: pointer;
}

:deep(svg) {
  max-width: 100%;
  height: auto;
}

:deep(svg[style*='max-width']) {
  max-width: 100% !important;
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
