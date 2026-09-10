<template>
  <node-view-wrapper>
    <!-- Preview area -->
    <div
      :class="[
        'overflow-x-auto max-w-full border bg-neutral-50 dark:bg-neutral-900 cursor-text min-h-20 p-2',
        isEditing ? 'rounded-t-xl' : 'rounded-xl',
      ]"
      @click="startEditing"
    >
      <p ref="contentRef" class="select-none pl-2"></p>
    </div>

    <!-- Editor panel -->
    <ExpandCollapse :open="isEditing">
      <div
        class="bg-neutral-50 dark:bg-neutral-900 border flex flex-col mt-0 p-0 rounded-b-lg"
      >
        <!-- Growable content area -->
        <div class="flex mb-2 p-2 flex-grow">
          <!-- Main content textarea -->
          <textarea
            v-if="!useKatexMacros"
            ref="contentTextarea"
            :value="node.attrs.content"
            type="textarea"
            :placeholder="translations.editor.mathPlaceholder || '-'"
            class="bg-transparent ml-2 pl-2 flex-1 resize-y min-h-32 ltr"
            @input="updateContent($event, 'content', true)"
            @keydown="handleKeydown"
          />

          <!-- KaTeX macros textarea -->
          <textarea
            v-if="useKatexMacros"
            ref="macrosTextarea"
            :value="node.attrs.macros"
            placeholder="KaTeX macros"
            class="bg-transparent ml-2 pl-2 flex-1 resize-y"
            @input="updateContent($event, 'macros', true)"
            @keydown="handleKeydown"
          />
        </div>

        <div
          class="flex p-2 border-t rounded-b-lg items-center justify-between bg-neutral-100 dark:bg-neutral-900/70"
        >
          <p class="text-sm m-0">
            <strong>{{ translations.editor.exit }}</strong>
          </p>
          <button
            type="button"
            v-tooltip="'KaTeX Macros (Ctrl+Shift+M)'"
            aria-label="KaTeX macros"
            :class="[
              'ml-2 flex items-center justify-center rounded-full size-8 transition-colors',
              useKatexMacros
                ? 'text-primary'
                : 'text-neutral-500 hover:bg-black/5 dark:text-neutral-400 dark:hover:bg-white/10',
            ]"
            @click="toggleMacros"
          >
            <v-remixicon name="riSettings3Line" />
          </button>
        </div>
      </div>
    </ExpandCollapse>
  </node-view-wrapper>
</template>

<script>
import { ref, onMounted, nextTick } from 'vue';
import { NodeViewWrapper, nodeViewProps } from '@tiptap/vue-3';
import { useTranslations } from '@/composable/useTranslations';
import ExpandCollapse from '@/components/ui/ExpandCollapse.vue';
import katex from 'katex';
import { debounce } from '@/utils/helpers/index.js';

export default {
  components: { NodeViewWrapper, ExpandCollapse },
  props: nodeViewProps,
  setup(props) {
    const contentRef = ref(null);
    const contentTextarea = ref(null);
    const macrosTextarea = ref(null);

    const isEditing = ref(false);
    const useKatexMacros = ref(false);
    const { translations } = useTranslations();

    // Render KaTeX
    const renderContent = () => {
      let macros = {};
      try {
        macros = JSON.parse(props.node.attrs.macros || '{}');
      } catch {
        //
      }
      katex.render(props.node.attrs.content || 'Empty', contentRef.value, {
        macros,
        displayMode: true,
        throwOnError: false,
        fleqn: true,
        trust: false,
        strict: 'ignore',
        output: 'htmlAndMathml',
      });
    };

    const debouncedRenderContent = debounce(renderContent, 300);

    // Update content or macros
    const updateContent = ({ target: { value } }, key, shouldRender) => {
      props.updateAttributes({ [key]: value });
      if (shouldRender) nextTick(() => debouncedRenderContent());
    };

    const startEditing = () => {
      isEditing.value = true;
      nextTick(() => {
        if (useKatexMacros.value) {
          macrosTextarea.value?.focus();
        } else {
          contentTextarea.value?.focus();
        }
      });
    };

    // Stop editing
    const stopEditing = () => {
      isEditing.value = false;
      useKatexMacros.value = false;
    };

    // Toggle macros textarea
    const toggleMacros = () => {
      useKatexMacros.value = !useKatexMacros.value;
      nextTick(() => {
        if (useKatexMacros.value) {
          macrosTextarea.value?.focus();
        } else {
          contentTextarea.value?.focus();
        }
      });
    };

    const handleKeydown = (event) => {
      const { ctrlKey, shiftKey, metaKey, key } = event;
      const mod = ctrlKey || metaKey;
      if (mod && shiftKey && key === 'M') toggleMacros();
      if (mod && key === 'Enter') {
        stopEditing();
        props.editor.commands.focus();
      }
    };

    onMounted(async () => {
      await nextTick();
      props.updateAttributes?.({ init: 'true' });
      renderContent();
    });

    return {
      contentRef,
      contentTextarea,
      macrosTextarea,
      isEditing,
      useKatexMacros,
      translations,
      startEditing,
      stopEditing,
      toggleMacros,
      updateContent,
      handleKeydown,
    };
  },
};
</script>
