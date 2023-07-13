<template>
  <div class="p-2">
    <div class="flex items-center">
      <input
        id="bubble-input"
        v-model="currentImage"
        type="text"
        class="flex-1 bg-transparent w-52 mr-4"
        placeholder="Image url"
        @keydown.esc="editor.commands.focus()"
        @keyup.enter="editorImage.set(currentImage)"
      />
      <v-remixicon
        name="riFolderOpenLine"
        title="Open image"
        class="dark:text-gray-200 text-gray-600 mr-3 cursor-pointer"
        @click="editorImage.select()"
      />
      <v-remixicon
        name="riSave3Line"
        class="dark:text-gray-200 text-gray-600 cursor-pointer"
        @click="editorImage.set(currentImage)"
      />
    </div>
    <span class="text-xs text-gray-600 dark:text-gray-300 leading-none"
      >Press Ctrl+L to focus the input</span
    >
  </div>
</template>
<script>
import { watch, ref } from 'vue';
import { useEditorImage } from '@/composable/editorImage';

export default {
  props: {
    editor: {
      type: Object,
      default: () => ({}),
    },
  },
  setup(props) {
    const editorImage = useEditorImage(props.editor);

    const currentImage = ref('');

    watch(
      () => props.editor.getAttributes('image'),
      (value) => {
        currentImage.value = value.src ?? '';
      },
      { immediate: true }
    );

    return {
      editorImage,
      currentImage,
    };
  },
};
</script>
