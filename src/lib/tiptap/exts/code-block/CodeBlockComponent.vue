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
        hidee-placeholder-in-dropdown
        placeholder="auto"
      />
      <span class="border-r h-4 mx-0.5" />
      <v-remixicon :name="copyIcon" class="size-4" @click="copyToClipboard" />
      <v-remixicon
        name="riDeleteBin6Line"
        class="size-4 hover:text-red-600 dark:hover:text-red-400"
        @click="deleteNode"
      />
    </div>
    <pre><code ref="codeRef" class="hljs" :class="languageClass"><node-view-content as="code" /></code></pre>
  </node-view-wrapper>
</template>

<script>
import { ref, computed, watch, nextTick } from 'vue';
import { NodeViewWrapper, NodeViewContent, nodeViewProps } from '@tiptap/vue-3';
import { useClipboard } from '../../../../composable/clipboard';

function escapeHtml(text) {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export default {
  components: {
    NodeViewWrapper,
    NodeViewContent,
  },
  props: nodeViewProps,
  setup(props) {
    const codeRef = ref(null);

    const selectedLanguage = computed({
      set(language) {
        props.updateAttributes({ language: language || null });
      },
      get() {
        return props.node.attrs.language || '';
      },
    });

    const languageOptions = computed(() => {
      try {
        const languages = props.extension.options.lowlight.listLanguages();
        return [
          { value: '', text: 'auto' },
          ...languages.map((lang) => ({ value: lang, text: lang })),
        ];
      } catch (e) {
        return [{ value: '', text: 'auto' }];
      }
    });

    const languageClass = computed(() => {
      const lang = props.node.attrs.language;
      return lang ? `language-${lang}` : '';
    });

    function applyHighlight() {
      const contentDom = codeRef.value?.querySelector(
        '[data-node-view-content]'
      );
      if (!contentDom) return;

      const code = props.node.textContent;
      const language = props.node.attrs.language;

      if (language) {
        try {
          const lowlight = props.extension.options.lowlight;
          const result = lowlight.highlight(language, code);
          contentDom.innerHTML = lowlight.valueToHtml(result);
          return;
        } catch (e) {
          // fall through
        }
      }

      contentDom.innerHTML = escapeHtml(code);
    }

    watch(
      [() => props.node.textContent, () => props.node.attrs.language],
      () => {
        nextTick().then(applyHighlight);
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
      const code = props.node.textContent;
      copyToClipboard(code);
    };

    const deleteNode = () => {
      if (typeof props.deleteNode === 'function') {
        props.deleteNode();
      }
    };

    return {
      codeRef,
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
