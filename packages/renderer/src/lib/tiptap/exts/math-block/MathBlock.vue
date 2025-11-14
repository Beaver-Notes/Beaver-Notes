<template>
  <node-view-wrapper>
    <!-- Preview area -->
    <div
      :class="[
        'overflow-x-auto max-w-full border bg-neutral-50 dark:bg-neutral-900 cursor-text min-h-20 p-2',
        isEditing ? 'rounded-t-lg' : ' rounded-lg',
      ]"
      @click="startEditing"
    >
      <p ref="contentRef" class="select-none pl-2"></p>
    </div>

    <!-- Editor panel -->
    <div
      v-if="isEditing"
      :class="[
        'bg-neutral-50 dark:bg-neutral-900 transition border flex flex-col',
        isEditing ? 'rounded-b-lg' : ' rounded-lg',
      ]"
      style="margin-top: 0; padding: 0"
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
          class="bg-transparent ml-2 pl-2 flex-1 resize-y min-h-32"
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
          class="bg-transparent ml-2 pl-2 flex-1 resize-y"
          @input="updateContent($event, 'macros', true)"
          @keydown="handleKeydown"
        />
      </div>

      <div
        class="flex p-2 border-t rounded-b-lg items-center justify-between bg-neutral-100 dark:bg-neutral-800/70"
      >
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
