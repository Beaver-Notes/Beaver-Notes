<template>
  <node-view-wrapper>
    <!-- Editor panel -->
    <div
      v-if="isEditing"
      class="bg-neutral-50 dark:bg-neutral-900 transition rounded-lg p-2"
    >
      <div class="flex mb-2">
        <!-- Main content textarea -->
        <textarea
          v-if="!useKatexMacros"
          ref="contentTextarea"
          :value="node.attrs.content"
          type="textarea"
          :placeholder="translations.editor.mathPlaceholder || '-'"
          class="bg-transparent flex-1 resize-y"
          style="direction: ltr"
          @input="updateContent($event, 'content', true)"
          @keydown="handleKeydown"
        />

        <!-- KaTeX macros textarea -->
        <textarea
          v-if="useKatexMacros"
          ref="macrosTextarea"
          :value="node.attrs.macros"
          placeholder="KaTeX macros"
          class="bg-transparent ml-2 pl-2 border-l flex-1 resize-y"
          @input="updateContent($event, 'macros', true)"
          @keydown="handleKeydown"
        />
      </div>

      <!-- Footer with toggle and exit -->
      <div
        class="flex border-t items-center pt-2 text-neutral-600 dark:text-neutral-300"
      >
        <img src="@/assets/svg/katex.svg" width="48" style="margin: 0" />
        <div class="flex-grow"></div>
        <p class="text-sm" style="margin: 0">
          <strong>{{ translations.editor.exit }}</strong>
        </p>
        <v-remixicon
          v-tooltip="'KaTeX Macros (Ctrl+Shift+M)'"
          :class="{ 'text-primary': useKatexMacros }"
          name="riSettings3Line"
          class="ml-2 cursor-pointer"
          @click="toggleMacros"
        />
      </div>
    </div>

    <!-- Rendered output -->
    <div
      class="overflow-x-auto max-w-full p-2 rounded-lg bg-neutral-50 dark:bg-neutral-900 cursor-text min-h-[2em]"
      @click="startEditing"
    >
      <p ref="contentRef" class="select-none"></p>
    </div>
  </node-view-wrapper>
</template>

<script>
import { ref, onMounted, nextTick } from 'vue';
import { NodeViewWrapper, nodeViewProps } from '@tiptap/vue-3';
import { useTranslation } from '@/composable/translations';
import katex from 'katex';

export default {
  components: { NodeViewWrapper },
  props: nodeViewProps,
  setup(props) {
    const contentRef = ref(null);
    const contentTextarea = ref(null);
    const macrosTextarea = ref(null);

    const isEditing = ref(false);
    const useKatexMacros = ref(false);
    const translations = ref({ editor: {} });

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
        trust: true,
        strict: 'ignore',
        output: 'htmlAndMathml',
      });
    };

    const debounce = (func, delay) => {
      let timer;
      return (...args) => {
        clearTimeout(timer);
        timer = setTimeout(() => func(...args), delay);
      };
    };
    const debouncedRenderContent = debounce(renderContent, 300);

    // Update content or macros
    const updateContent = ({ target: { value } }, key, shouldRender) => {
      props.updateAttributes({ [key]: value });
      if (shouldRender) nextTick(() => debouncedRenderContent());
    };

    // Start editing and focus textarea
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

    // Handle keyboard shortcuts
    const handleKeydown = (event) => {
      const { ctrlKey, shiftKey, metaKey, key } = event;
      const mod = ctrlKey || metaKey;

      if (mod && key.toLowerCase() === 'a') {
        event.preventDefault();
        stopEditing();
        props.editor.commands.selectAll();
        return;
      }
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

      const trans = await useTranslation();
      if (trans) translations.value = trans;
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
