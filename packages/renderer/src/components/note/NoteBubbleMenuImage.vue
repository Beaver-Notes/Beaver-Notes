<template>
  <div class="p-2">
    <div class="flex items-center">
      <input
        id="bubble-input"
        v-model="currentImage"
        type="text"
        class="flex-1 bg-transparent w-52 mr-4"
        :placeholder="translations.image.imgUrl"
        @keydown.esc="editor.commands.focus()"
        @keyup.enter="editorImage.set(currentImage)"
      />
      <v-remixicon
        name="riFolderOpenLine"
        title="Open image"
        class="dark:text-neutral-200 text-neutral-600 mr-3 cursor-pointer"
        @click="editorImage.select()"
      />
      <v-remixicon
        name="riSave3Line"
        class="dark:text-neutral-200 text-neutral-600 cursor-pointer"
        @click="editorImage.set(currentImage)"
      />
    </div>
  </div>
</template>
<script>
import { watch, ref, onMounted } from 'vue';
import { useTranslation } from '@/composable/translations';
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

    const translations = ref({
      image: {},
    });

    onMounted(async () => {
      await useTranslation().then((trans) => {
        if (trans) {
          translations.value = trans;
        }
      });
    });

    return {
      translations,
      editorImage,
      currentImage,
    };
  },
};
</script>
