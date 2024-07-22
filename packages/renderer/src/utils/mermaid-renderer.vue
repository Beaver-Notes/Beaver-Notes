<template>
  <pre
    ref="elRef"
    :class="['mermaid', className]"
    @click="onClick"
    v-html="mermaidString"
  ></pre>
</template>

<script>
import { defineComponent, ref, watch, onMounted } from 'vue';
import mermaid from 'mermaid';
import { useTheme } from '@/composable/theme'; // Adjust import path as per your actual setup

export default defineComponent({
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
      default: null,
    },
  },
  setup(props) {
    const elRef = ref(null);
    const mermaidString = ref('');
    const { currentTheme } = useTheme(); // Assuming useTheme provides currentTheme

    function genSvgId() {
      const max = 1000000;
      return `mermaid-svg-${genId(max)}${genId(max)}`;

      function genId(max) {
        return Math.floor(Math.random() * max);
      }
    }

    async function updateGraph(graphDefinition) {
      const id = genSvgId();
      const res = await mermaid.render(id, graphDefinition);
      mermaidString.value = res.svg;
    }

    function initializeMermaid() {
      if (!elRef.value) return;

      const isDarkMode = currentTheme.value === 'dark';
      const theme = isDarkMode ? 'dark' : 'default';

      mermaid.initialize({
        startOnLoad: false,
        theme,
        ...props.config,
      });
    }

    function addThemeToContent(content) {
      const isDarkMode = currentTheme.value === 'dark';
      const theme = isDarkMode ? 'dark' : 'default';

      return `%%{init: {'theme':'${theme}'}}%%\n${content}`;
    }

    onMounted(() => {
      initializeMermaid();
      if (props.content) {
        const themedContent = addThemeToContent(props.content);
        updateGraph(themedContent);
      }
    });

    watch(
      () => props.content,
      (newContent) => {
        if (newContent) {
          const themedContent = addThemeToContent(newContent);
          updateGraph(themedContent);
        }
      },
      { immediate: true }
    );

    watch(
      () => currentTheme.value,
      () => {
        initializeMermaid();
        if (props.content) {
          const themedContent = addThemeToContent(props.content);
          updateGraph(themedContent);
        }
      }
    );

    return {
      elRef,
      mermaidString,
      updateGraph,
      initializeMermaid,
    };
  },
});
</script>
