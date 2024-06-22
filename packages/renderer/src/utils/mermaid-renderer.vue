<template>
  <pre
    ref="elRef"
    :class="['mermaid', className]"
    v-html="mermaidString"
    @click="onClick"
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
      const res = await mermaid.render(
        id,
        graphDefinition,
        elRef.value || undefined
      );
      mermaidString.value = res.svg;
    }

    function applyThemeStyles(svgElement) {
      if (!svgElement) return;

      const isDarkMode = currentTheme.value === 'dark';

      // Define theme-specific colors
      const themeColors = {
        light: {
          textColor: '#000000',
          borderColor: '#333',
          arrowStrokeColor: '#000000',
        },
        dark: {
          textColor: '#FFFFFF',
          borderColor: '#666', // Darker border color for better visibility
          arrowStrokeColor: '#FFFFFF',
        },
      };

      // Apply colors based on current theme
      const colors = themeColors[isDarkMode ? 'dark' : 'light'];

      // Reset styles for all elements inside the SVG
      svgElement.querySelectorAll('*').forEach((elem) => {
        elem.style.stroke = null;
        elem.style.fill = null;
      });

      // Apply theme-specific styles
      svgElement.querySelectorAll('text').forEach((text) => {
        text.style.fill = colors.textColor;
      });

      svgElement.querySelectorAll('rect, circle, path').forEach((shape) => {
        shape.style.stroke = colors.borderColor;
        shape.style.fill = colors.fillColor;
      });

      svgElement.querySelectorAll('path').forEach((path) => {
        if (path.getAttribute('marker-end') === 'url(#arrowhead)') {
          path.style.stroke = colors.arrowStrokeColor;
        } else {
          path.style.stroke = colors.borderColor;
        }
      });

      svgElement.querySelectorAll('line').forEach((line) => {
        line.style.stroke = colors.borderColor;
      });

      svgElement.querySelectorAll('.actor-man circle').forEach((circle) => {
        circle.style.stroke = colors.borderColor;
      });
    }

    function initializeMermaid() {
      if (!elRef.value) return;

      if (props.config) {
        mermaid.initialize({ startOnLoad: false, ...props.config });
      } else {
        mermaid.initialize({ startOnLoad: false });
      }
    }

    onMounted(() => {
      initializeMermaid();
    });

    watch(
      () => props.content,
      (newContent) => {
        if (newContent) {
          updateGraph(newContent);
        }
      },
      { immediate: true }
    );

    watch(
      () => mermaidString.value,
      () => {
        applyThemeStyles(elRef.value.querySelector('svg'));
      }
    );

    watch(
      () => currentTheme.value,
      () => {
        applyThemeStyles(elRef.value.querySelector('svg'));
        initializeMermaid(); // Re-initialize Mermaid.js on theme change
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
