<template>
  <pre
    ref="elRef"
    :class="['mermaid', className]"
    @click="onClick"
    v-html="mermaidString"
  ></pre>
</template>

<script>
import { defineComponent, ref, watch, onMounted, shallowReactive } from 'vue';
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
    const hasSyntaxError = ref(false);

    function genSvgId() {
      const max = 1000000;
      return `mermaid-svg-${genId(max)}${genId(max)}`;

      function genId(max) {
        return Math.floor(Math.random() * max);
      }
    }

    async function updateGraph(graphDefinition) {
      const id = genSvgId();
      try {
        const res = await mermaid.render(id, graphDefinition);
        mermaidString.value = res.svg;
        hasSyntaxError.value = false; // No syntax error
      } catch (e) {
        console.error('Error rendering Mermaid diagram:', e);
        mermaidString.value = `<div class="text-red-500 text-center">${translations._idvue.error}</div>`;
        hasSyntaxError.value = true; // Syntax error
      }
    }

    function initializeMermaid() {
      if (!elRef.value) return;

      const isDarkMode = currentTheme.value === 'dark';
      const theme = isDarkMode ? 'dark' : 'default';

      mermaid.initialize({
        startOnLoad: true,
        suppressErrorRendering: true,
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

    const translations = shallowReactive({
      _idvue: {
        error: '_idvue.error',
      },
    });

    onMounted(async () => {
      // Load translations
      const loadedTranslations = await loadTranslations();
      if (loadedTranslations) {
        Object.assign(translations, loadedTranslations);
      }
    });

    const loadTranslations = async () => {
      const selectedLanguage = localStorage.getItem('selectedLanguage') || 'en';
      try {
        const translationModule = await import(
          `../pages/settings/locales/${selectedLanguage}.json`
        );
        return translationModule.default;
      } catch (error) {
        console.error('Error loading translations:', error);
        return null;
      }
    };

    return {
      elRef,
      mermaidString,
      updateGraph,
      initializeMermaid,
      hasSyntaxError,
    };
  },
});
</script>
