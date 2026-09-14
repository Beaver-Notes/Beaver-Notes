<template>
  <div
    class="share-preview-editor max-h-[55dvh] min-h-[30dvh] overflow-y-auto overscroll-contain bg-white px-4 py-4 dark:bg-neutral-900 md:px-6 md:py-5"
  >
    <div v-if="!editor" class="max-w-none space-y-3 animate-pulse" aria-hidden="true">
      <div class="h-4 w-3/4 rounded-lg bg-neutral-200 dark:bg-neutral-700" />
      <div class="h-4 w-1/2 rounded-lg bg-neutral-200 dark:bg-neutral-700" />
      <div class="h-4 w-2/3 rounded-lg bg-neutral-200 dark:bg-neutral-700" />
      <div class="h-4 w-5/6 rounded-lg bg-neutral-200 dark:bg-neutral-700" />
    </div>
    <editor-content
      v-else
      :editor="editor"
      class="prose prose-sm md:prose-base prose-stone dark:prose-invert max-w-none break-words select-text pointer-events-none"
    />
  </div>
</template>

<script>
import { onBeforeUnmount, shallowRef } from 'vue';
import { Editor, EditorContent } from '@tiptap/vue-3';
import { extensions } from '@/lib/tiptap';

export default {
  components: { EditorContent },
  props: { content: { type: Object, required: true } },
  setup(props) {
    const editor = shallowRef(null);
    editor.value = new Editor({
      content: props.content,
      editable: false,
      extensions,
    });
    onBeforeUnmount(() => editor.value?.destroy());
    return { editor };
  },
};
</script>

<style scoped>
.share-preview-editor :deep(.tiptap) {
  outline: none;
}
.share-preview-editor :deep(img) {
  border-radius: 0.75rem;
  max-width: 100%;
  height: auto;
}
.share-preview-editor :deep(pre) {
  white-space: pre-wrap;
  word-break: break-word;
}
</style>
