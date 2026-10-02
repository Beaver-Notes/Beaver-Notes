<template>
  <node-view-wrapper class="relative">
    <div
      class="absolute right-2 top-2 z-10 flex items-center gap-1 border rounded-lg px-2 py-1 print:hidden bg-white dark:bg-neutral-900 border-neutral-200 dark:border-neutral-700"
    >
      <ui-select
        v-model="selectedLanguage"
        contenteditable="false"
        class="code-lang-select"
        :options="languageOptions"
        :search="true"
      />
      <span class="border-r h-4 mx-0.5" />
      <button
        type="button"
        aria-label="Copy code"
        class="flex items-center justify-center rounded-md p-0.5 text-neutral-500 hover:bg-black/5 dark:text-neutral-400 dark:hover:bg-white/10 transition-colors"
        @click="copyToClipboard"
      >
        <v-remixicon :name="copyIcon" class="size-4" />
      </button>
      <button
        type="button"
        aria-label="Delete block"
        class="flex items-center justify-center rounded-md p-0.5 text-neutral-500 hover:bg-black/5 hover:text-red-600 dark:text-neutral-400 dark:hover:bg-white/10 dark:hover:text-red-400 transition-colors"
        @click="deleteNode"
      >
        <v-remixicon name="riDeleteBin6Line" class="size-4" />
      </button>
    </div>
    <pre class="codeblock-pre"><span
      class="codeblock-gutter"
      contenteditable="false"
      aria-hidden="true"
    ><span v-for="n in lineCount" :key="n">{{ n }}</span></span><code class="hljs" :class="languageClass"><node-view-content as="code" /></code></pre>
  </node-view-wrapper>
</template>

<script>
import { ref, computed, watch, onMounted } from 'vue';
import { NodeViewWrapper, NodeViewContent, nodeViewProps } from '@tiptap/vue-3';
import { useClipboard } from '../../../../composable/clipboard';
import { detectLanguage } from '@speed-highlight/core/detect';
import { highlightHTML } from '@speed-highlight/core';
import defaultThemeStyles from '@speed-highlight/core/themes/default.css?raw';
import darkThemeStyles from '@speed-highlight/core/themes/atom-dark.css?raw';
import { codeHighlightPluginKey, parseHighlightedHtml } from './plugin';
import { createDebouncedLatest } from '@/utils/helpers/latest';

const LANGUAGES = [
  'bash',
  'c',
  'css',
  'csv',
  'diff',
  'docker',
  'git',
  'go',
  'html',
  'http',
  'ini',
  'java',
  'js',
  'json',
  'lua',
  'make',
  'md',
  'pl',
  'py',
  'regex',
  'rs',
  'sql',
  'toml',
  'ts',
  'xml',
  'yaml',
  'asm',
  'bf',
  'log',
  'todo',
  'uri',
];

let themesInjected = false;
function injectThemes() {
  if (themesInjected) return;
  themesInjected = true;
  const light = document.createElement('style');
  light.textContent = defaultThemeStyles;
  document.head.appendChild(light);
  const dark = document.createElement('style');
  dark.textContent = `.dark {\n${darkThemeStyles}\n}`;
  document.head.appendChild(dark);
}

function extractCodeHtml(html) {
  const marker = '</div><div>';
  const start = html.indexOf(marker);
  if (start === -1) return null;
  const contentStart = start + marker.length;
  const contentEnd = html.lastIndexOf('</div></div>');
  if (contentEnd === -1) return null;
  return html.substring(contentStart, contentEnd);
}

export default {
  components: { NodeViewWrapper, NodeViewContent },
  props: nodeViewProps,
  setup(props) {
    const detectedLanguage = ref(null);

    const selectedLanguage = computed({
      set(language) {
        props.updateAttributes({ language: language || null });
      },
      get() {
        return props.node.attrs.language || '';
      },
    });

    function detectLang(code) {
      if (!code || !code.trim()) {
        detectedLanguage.value = null;
        return;
      }
      // SHL's detector has no JSON patterns — exact check first
      const trimmed = code.trim();
      if (trimmed[0] === '{' || trimmed[0] === '[') {
        try {
          JSON.parse(trimmed);
          detectedLanguage.value = 'json';
          return;
        } catch {
          // Not valid JSON — fall through to heuristic detection
        }
      }
      try {
        const raw = detectLanguage(code);
        detectedLanguage.value = raw === 'plain' ? null : raw;
      } catch (e) {
        console.warn('[CodeBlock] detection failed:', e);
        detectedLanguage.value = null;
      }
    }

    const autoLabel = computed(() => {
      if (!selectedLanguage.value && detectedLanguage.value) {
        return `${detectedLanguage.value} (auto)`;
      }
      return 'auto';
    });

    const languageOptions = computed(() => {
      return [
        { value: '', text: autoLabel.value },
        ...LANGUAGES.map((l) => ({ value: l, text: l })),
      ];
    });

    const languageClass = computed(() => {
      const lang = props.node.attrs.language || detectedLanguage.value;
      return lang ? `language-${lang}` : '';
    });

    const lineCount = computed(() => props.node.textContent.split('\n').length);

    // Guard so an in-flight highlight never overwrites a newer one
    let highlightSeq = 0;

    async function applyHighlight() {
      const seq = ++highlightSeq;
      const code = props.node.textContent;
      if (!code) {
        updateDecorations([]);
        return;
      }
      const language = props.node.attrs.language || detectedLanguage.value;
      const lang = LANGUAGES.includes(language) ? language : 'plain';

      try {
        const html = await highlightHTML(code, lang);
        if (seq !== highlightSeq) return;
        const inner = extractCodeHtml(html);
        if (!inner) {
          updateDecorations([]);
          return;
        }
        updateDecorations(parseHighlightedHtml(inner));
      } catch (e) {
        console.warn('[CodeBlock] highlight failed:', e);
        updateDecorations([]);
      }
    }

    function updateDecorations(tokens) {
      const editor = props.editor;
      if (!editor?.view) return;
      const pos = props.getPos();
      if (pos == null) return;
      const { state, dispatch } = editor.view;
      const tr = state.tr.setMeta(codeHighlightPluginKey, {
        nodePos: pos,
        tokens,
      });
      dispatch(tr);
    }

    const debouncedHighlight = createDebouncedLatest(applyHighlight, 300);

    onMounted(() => {
      injectThemes();
      applyHighlight();
    });

    watch(
      [() => props.node.textContent, () => props.node.attrs.language],
      () => {
        debouncedHighlight();
      },
    );

    watch(
      () => props.node.textContent,
      (code) => {
        detectLang(code);
      },
      { immediate: true },
    );

    const { copyState, copyToClipboard } = useClipboard();
    const copyIcon = computed(() =>
      copyState.value === 1
        ? 'riCheckCircle'
        : copyState.value === 2
          ? 'riErrorWarningLine'
          : 'riClipboardLine',
    );

    const copy = () => {
      copyToClipboard(props.node.textContent);
    };

    const deleteNode = () => {
      if (typeof props.deleteNode === 'function') {
        props.deleteNode();
      }
    };

    return {
      selectedLanguage,
      languageOptions,
      languageClass,
      lineCount,
      deleteNode,
      copyToClipboard: copy,
      copyState,
      copyIcon,
    };
  },
};
</script>

<style lang="postcss" scoped>
.codeblock-pre {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  /* Flush top/bottom/left so the rail starts at line 1 with no gap */
  padding: 0 1rem 0 0;
  /* rounded-xl — overrides the global rounded-lg on .ProseMirror/.tiptap pre */
  border-radius: 0.75rem;
}

.codeblock-gutter {
  position: sticky;
  left: 0;
  z-index: 1;
  /* Stretch to the full block height (pre has no vertical padding left to
     bleed into); without this, wrapped lines leave the rail short */
  align-self: stretch;
  user-select: none;
  -webkit-user-select: none;
  font-family: var(--selected-font-code);
  font-size: 0.8rem;
  line-height: inherit;
  text-align: right;
  padding: 0 0.75rem 0 0.75rem;
  margin-right: 0.75rem;
  border-right: 1px solid rgb(127 127 127 / 0.25);
  @apply bg-neutral-100 dark:bg-neutral-800 text-neutral-400 dark:text-neutral-500;
}

.codeblock-gutter > span {
  display: block;
}

.codeblock-pre > code.hljs {
  min-width: 0;
  padding: 0;
}

pre code {
  display: block;
  color: #383a42;
}

.dark {
  pre code {
    color: #abb2bf;
    background: #191919;
  }
}

.code-lang-select {
  min-width: 0;

  :deep(.ui-select__content) {
    @apply bg-transparent border-0 rounded;
    box-shadow: none !important;
  }

  :deep(button) {
    padding: 0.125rem 2.5rem 0.125rem 0.25rem;
    @apply text-sm;
    width: auto;
    min-width: 0;
    max-width: 10rem;
    overflow: hidden;
  }
}
</style>
