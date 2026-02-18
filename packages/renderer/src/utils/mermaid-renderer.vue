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

    const renderDiagram = async () => {
      if (!props.content || !elRef.value) return;

      const id = `mermaid-svg-${Math.floor(Math.random() * 1000000)}`;

      try {
        const { svg, bindFunctions } = await mermaid.render(id, props.content);

        elRef.value.innerHTML = svg;

        await nextTick();
        if (bindFunctions) {
          bindFunctions(elRef.value);
        }
      } catch (error) {
        console.error('Mermaid render failed:', error);
        elRef.value.innerHTML = `<div class="error">${
          translations.value?.editor?.error || 'Invalid Syntax'
        }</div>`;
      }
    };

    onMounted(async () => {
      initializeMermaid();
      renderDiagram();
    });

    watch(
      () => props.content,
      () => {
        renderDiagram();
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
  display: flex;
  justify-content: center;
  cursor: pointer;
}

:deep(div.label) {
  color: inherit;
}
</style>
