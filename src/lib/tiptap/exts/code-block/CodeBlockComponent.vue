<template>
  <node-view-wrapper class="relative">
    <div
      class="absolute right-2 top-2 z-10 flex items-center gap-1 border bg-neutral-50 dark:bg-neutral-900 rounded-lg px-2 py-1 print:hidden"
    >
      <ui-select
        v-model="selectedLanguage"
        contenteditable="false"
        class="code-lang-select"
        :options="languageOptions"
        :search="true"
        hide-placeholder-in-dropdown
      />
      <span class="border-r h-4 mx-0.5" />
      <v-remixicon :name="copyIcon" class="size-4" @click="copyToClipboard" />
      <v-remixicon
        name="riDeleteBin6Line"
        class="size-4 hover:text-red-600 dark:hover:text-red-400"
        @click="deleteNode"
      />
    </div>
    <pre><code class="hljs" :class="languageClass"><node-view-content as="code" /></code></pre>
  </node-view-wrapper>
</template>

<script>
import { ref, computed, watch, onMounted } from 'vue';
import { NodeViewWrapper, NodeViewContent, nodeViewProps } from '@tiptap/vue-3';
import { useClipboard } from '../../../../composable/clipboard';
import { detectLanguage } from '@speed-highlight/core/detect';
import { highlightText } from '@speed-highlight/core';
import defaultThemeStyles from '@speed-highlight/core/themes/default.css?raw';
import darkThemeStyles from '@speed-highlight/core/themes/atom-dark.css?raw';
import { codeHighlightPluginKey, parseHighlightedHtml } from './plugin';

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
        return `auto (detected: ${detectedLanguage.value})`;
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

    async function applyHighlight() {
      const code = props.node.textContent;
      if (!code) {
        updateDecorations([]);
        return;
      }
      const language = props.node.attrs.language || detectedLanguage.value;
      const lang = LANGUAGES.includes(language) ? language : 'plain';

      try {
        const html = await highlightText(code, lang);
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

    onMounted(() => {
      injectThemes();
      applyHighlight();
    });

    watch(
      [() => props.node.textContent, () => props.node.attrs.language],
      () => {
        applyHighlight();
      },
      { immediate: true }
    );

    watch(
      () => props.node.textContent,
      (code) => {
        detectLang(code);
      },
      { immediate: true }
    );

    const { copyState, copyToClipboard } = useClipboard();
    const copyIcon = computed(() =>
      copyState.value === 1
        ? 'riCheckFill'
        : copyState.value === 2
        ? 'riErrorWarningLine'
        : 'riClipboardLine'
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
      deleteNode,
      copyToClipboard: copy,
      copyState,
      copyIcon,
    };
  },
};
</script>

<style lang="postcss" scoped>
pre code {
  display: block;
  overflow-x: auto;
  padding: 0.5em;
  color: #383a42;
}

.dark {
  pre code {
    color: #abb2bf;
    background: #191919;
  }
}

.code-lang-select {
  :deep(.ui-select__content) {
    @apply bg-transparent border-0 rounded;
    box-shadow: none !important;
  }

  :deep(button) {
    padding: 0.125rem 0.25rem;
    @apply text-sm;
    width: auto;
    flex: 1;
    min-width: 0;
    min-height: 24px;
  }

  :deep(button + .absolute.right-2) {
    position: static;
    top: auto;
    transform: none;
  }

  :deep(.absolute.top-full) {
    min-width: max(220px, 100%);
    left: 50%;
    translate: -50% 0;
  }
}
</style>
