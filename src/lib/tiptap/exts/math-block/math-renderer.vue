<template>
  <div ref="mathRef" class="math-preview"></div>
</template>

<script>
import { ref, watch, onMounted } from 'vue';
import katex from 'katex';

// Module-level memo so virtualized card remounts don't re-render.
// Same options as the editor's MathBlock.vue.
const renderCache = new Map();

function renderCached(content, macrosStr) {
  const key = `${macrosStr}||${content}`;
  let html = renderCache.get(key);
  if (html === undefined) {
    let macros = {};
    try {
      macros = JSON.parse(macrosStr || '{}');
    } catch {
      // Malformed macros — render without them like the editor does.
    }
    html = katex.renderToString(content, {
      macros,
      displayMode: true,
      throwOnError: false,
      fleqn: true,
      trust: false,
      strict: 'ignore',
      output: 'htmlAndMathml',
    });
    if (renderCache.size > 100) renderCache.clear();
    renderCache.set(key, html);
  }
  return html;
}

export default {
  name: 'MathPreview',
  props: {
    content: {
      type: String,
      required: true,
    },
    macros: {
      type: String,
      default: '{}',
    },
  },
  setup(props) {
    const mathRef = ref(null);

    const render = () => {
      if (!mathRef.value) return;
      try {
        mathRef.value.innerHTML = renderCached(props.content, props.macros);
      } catch {
        mathRef.value.textContent = props.content;
      }
    };

    onMounted(render);
    watch(() => [props.content, props.macros], render);

    return { mathRef };
  },
};
</script>
