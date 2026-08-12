<template>
  <div
    ref="elRef"
    :class="['mermaid-viewer', className]"
    @click="onClick"
  ></div>
</template>

<script>
import { defineComponent, ref, watch, nextTick, onMounted } from 'vue';
import mermaid from 'mermaid';
import { useTheme } from '@/composable/theme';
import { useTranslations } from '@/composable/useTranslations';

export default defineComponent({
  name: 'MermaidChart',
  props: {
    content: {
      type: String,
      required: true,
    },
    config: {
      type: Object,
      default: () => ({}),
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
    const elRef = ref(null);
    const { isDark } = useTheme();
    const { translations } = useTranslations();

    const initializeMermaid = () => {
      const theme = isDark() ? 'dark' : 'default';

      mermaid.initialize({
        startOnLoad: false,
        securityLevel: 'loose',
        theme,
        flowchart: { htmlLabels: true, useMaxWidth: true },
        ...props.config,
      });
    };

    // `mermaid.render` is CPU-heavy (seconds on low-end devices for complex
    // diagrams). While editing, the textarea updates `content` on every
    // keystroke; rendering each keystroke made typing a large diagram unusable.
    // Debounce to the pause in typing (mirrors MathBlock's 300 ms) and skip the
    // render entirely when the content hasn't changed since the last success.
    const RENDER_DEBOUNCE_MS = 300;
    let renderTimer = null;
    let lastRenderedContent = null;

    const renderDiagram = async () => {
      if (!props.content || !elRef.value) return;
      if (props.content === lastRenderedContent) return;

      const id = `mermaid-svg-${Math.floor(Math.random() * 1000000)}`;

      try {
        const { svg, bindFunctions } = await mermaid.render(id, props.content);

        elRef.value.innerHTML = svg;
        lastRenderedContent = props.content;

        await nextTick();
        if (bindFunctions) {
          bindFunctions(elRef.value);
        }
      } catch (error) {
        // Keep the cache clear so a fix is re-rendered on the next change.
        lastRenderedContent = null;
        console.error('Mermaid render failed:', error);
        elRef.value.innerHTML = `<div class="error">${
          translations.value?.editor?.error || 'Invalid Syntax'
        }</div>`;
      }
    };

    const scheduleRender = () => {
      if (renderTimer) clearTimeout(renderTimer);
      renderTimer = setTimeout(() => {
        renderTimer = null;
        renderDiagram();
      }, RENDER_DEBOUNCE_MS);
    };

    onMounted(async () => {
      initializeMermaid();
      renderDiagram();
    });

    watch(
      () => props.content,
      () => {
        scheduleRender();
      }
    );

    watch(
      () => isDark(),
      () => {
        initializeMermaid();
        renderDiagram();
      }
    );

    return {
      elRef,
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
</style>
