<template>
  <NodeViewWrapper>
    <div
      v-if="showTextarea"
      class="bg-neutral-50 dark:bg-neutral-900 transition rounded-lg p-2"
    >
      <div class="flex">
        <textarea
          ref="inputRef"
          :value="mermaidContent"
          type="textarea"
          :placeholder="translations.editor.mermaidPlaceholder || '-'"
          class="bg-transparent min-h-24 w-full resize-y leading-tight p-2"
          @input="updateContent($event)"
          @keydown.ctrl.enter="closeTextarea"
          @keydown.exact="handleKeydown"
          @scroll="syncScroll"
        ></textarea>
      </div>
      <div class="border-t-2 p-2 flex justify-between">
        <p style="margin: 0">
          <strong>{{ translations.editor.exit }}</strong>
        </p>
        <v-remixicon
          class="cursor-pointer"
          name="riCloseLine"
          @click="() => (showTextarea = false)"
        />
      </div>
    </div>
    <div
      class="relative min-h-[6em] rounded-lg bg-neutral-50 dark:bg-neutral-900 w-full cursor-text mt-2"
      @click="openTextarea"
    >
      <MermaidComponent
        ref="mermaidRef"
        :content="mermaidContent"
        class="w-full overflow-visible pointer-events-none"
      />
    </div>
  </NodeViewWrapper>
</template>

<script>
import { ref, watch, onMounted } from 'vue';
import { NodeViewWrapper, nodeViewProps } from '@tiptap/vue-3';
import { useTranslation } from '@/composable/translations';
import MermaidComponent from '@/utils/mermaid-renderer.vue';

export default {
  components: {
    MermaidComponent,
    NodeViewWrapper,
  },
  props: nodeViewProps,
  setup(props) {
    const mermaidContent = ref('');
    const inputRef = ref(null);
    const showTextarea = ref(false);

    function renderContent() {
      mermaidContent.value = props.node.attrs.content || '';
    }

    function updateContent(event) {
      const { value } = event.target;
      props.updateAttributes({ content: value });
      mermaidContent.value = value;
    }

    function openTextarea() {
      showTextarea.value = true;
      setTimeout(() => {
        if (inputRef.value) {
          inputRef.value.focus();
        }
      }, 0);
    }

    function closeTextarea() {
      showTextarea.value = false;
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

      // Insert a tab character at the cursor's current position
      const newValue = `${mermaidContent.value.substring(
        0,
        start
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
      }
    );

    const translations = ref({
      editor: {},
    });

    onMounted(async () => {
      await useTranslation().then((trans) => {
        if (trans) {
          translations.value = trans;
        }
      });
    });

    return {
      updateContent,
      mermaidContent,
      inputRef,
      showTextarea,
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
