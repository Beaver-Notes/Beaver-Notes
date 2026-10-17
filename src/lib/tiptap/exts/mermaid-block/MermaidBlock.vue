<template>
  <NodeViewWrapper>
    <div @click="openTextarea" class="relative">
      <MermaidComponent
        ref="mermaidRef"
        :content="mermaidContent"
        :class="[
          'w-full max-w-full overflow-x-auto bg-neutral-50 dark:bg-neutral-900 pointer-events-none p-2 border min-h-20',
          isEditing ? 'rounded-t-xl border-b-0' : 'rounded-xl',
        ]"
      />
    </div>

    <ExpandCollapse :open="isEditing">
      <div
        class="bg-neutral-50 dark:bg-neutral-900 border flex flex-col mt-0 p-0 rounded-b-xl"
      >
        <div class="flex mb-2 p-2 flex-grow">
          <textarea
            ref="inputRef"
            :value="mermaidContent"
            type="textarea"
            :placeholder="translations.editor.mermaidPlaceholder || '-'"
            class="bg-transparent ml-2 pl-2 flex-1 resize-y min-h-32"
            @input="updateContent($event)"
            @keydown.ctrl.enter="closeTextarea"
          @keydown.exact="handleKeydown"
          ></textarea>
        </div>
        <div
          class="flex p-2 border-t rounded-b-xl items-center justify-between bg-neutral-100 dark:bg-neutral-900/70"
        >
          <p class="text-sm m-0">
            <strong>{{ translations.editor.exit }}</strong>
          </p>
          <button
            type="button"
            aria-label="Close"
            class="flex items-center justify-center rounded-full size-8 text-neutral-500 hover:bg-black/5 dark:text-neutral-400 dark:hover:bg-white/10 transition-colors"
            @click="closeTextarea"
          >
            <v-remixicon name="riCloseLine" />
          </button>
        </div>
      </div>
    </ExpandCollapse>
  </NodeViewWrapper>
</template>

<script>
import { ref, watch, onMounted } from 'vue';
import { NodeViewWrapper, nodeViewProps } from '@tiptap/vue-3';
import { useTranslations } from '@/composable/useTranslations';
import ExpandCollapse from '@/components/ui/ExpandCollapse.vue';
import MermaidComponent from './mermaid-renderer.vue';

export default {
  components: {
    MermaidComponent,
    NodeViewWrapper,
    ExpandCollapse,
  },
  props: nodeViewProps,
  setup(props) {
    const isEditing = ref(false);
    const mermaidContent = ref('');
    const inputRef = ref(null);

    function renderContent() {
      mermaidContent.value = props.node.attrs.content || '';
    }

    function updateContent(event) {
      const { value } = event.target;
      props.updateAttributes({ content: value });
      mermaidContent.value = value;
    }

    function openTextarea() {
      isEditing.value = true;
      setTimeout(() => {
        if (inputRef.value) {
          inputRef.value.focus();
        }
      }, 0);
    }

    function closeTextarea() {
      isEditing.value = false;
    }

    function handleKeydown(event) {
      if (event.key === 'Tab') {
        event.preventDefault();
        insertTabAtCursor();
      }
    }

    function insertTabAtCursor() {
      const textarea = inputRef.value;
      const start = textarea.selectionStart;
      const end = textarea.selectionEnd;

      const newValue = `${mermaidContent.value.substring(
        0,
        start,
      )}\t${mermaidContent.value.substring(end)}`;
      mermaidContent.value = newValue;

      props.updateAttributes({ content: newValue });

      textarea.value = newValue;

      textarea.setSelectionRange(start + 1, start + 1);

      textarea.focus();
    }

    onMounted(() => {
      renderContent();
    });

    watch(
      () => props.node.attrs.content,
      (newContent) => {
        mermaidContent.value = newContent;
      },
    );

    const { translations } = useTranslations();

    return {
      updateContent,
      mermaidContent,
      inputRef,
      isEditing,
      translations,
      openTextarea,
      closeTextarea,
      handleKeydown,
    };
  },
};
</script>

<style scoped>
textarea {
  font-family: monospace;
  line-height: inherit;
  overflow-y: auto;
}
</style>
