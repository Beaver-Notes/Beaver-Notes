<template>
  <NodeViewWrapper>
    <div @click="openTextarea" class="relative">
      <MermaidComponent
        ref="mermaidRef"
        :content="mermaidContent"
        :class="[
          'w-full bg-neutral-50 dark:bg-neutral-900 pointer-events-none p-2 border min-h-20',
          showTextarea ? 'rounded-t-lg border-b-0' : 'rounded-lg',
        ]"
      />
    </div>

    <div
      v-if="isEditing"
      :class="[
        'bg-neutral-50 dark:bg-neutral-900 transition border flex flex-col',
        isEditing ? 'rounded-b-lg' : ' rounded-lg',
      ]"
      style="margin-top: 0; padding: 0"
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
          @scroll="syncScroll"
        ></textarea>
      </div>
      <div
        class="flex p-2 border-t rounded-b-lg items-center justify-between bg-neutral-100 dark:bg-neutral-800/70"
      >
        <p class="text-sm m-0">
          <strong>{{ translations.editor.exit }}</strong>
        </p>
        <v-remixicon
          class="cursor-pointer"
          name="riCloseLine"
          @click="closeTextarea"
        />
      </div>
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
    const isEditing = ref(false);
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
      isEditing.value = true;
      showTextarea.value = true;
      setTimeout(() => {
        if (inputRef.value) {
          inputRef.value.focus();
        }
      }, 0);
    }

    function closeTextarea() {
      isEditing.value = false;
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
      isEditing,
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
