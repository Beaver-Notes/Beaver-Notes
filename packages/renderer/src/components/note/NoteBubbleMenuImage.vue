<template>
  <div class="p-2">
    <div class="flex items-center">
      <input
        id="bubble-input"
        v-model="currentImage"
        type="text"
        class="flex-1 bg-transparent w-52 mr-4"
        :placeholder="translations.image.imgurl"
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
  </div>
</template>
<script>
import { watch, ref, onMounted, shallowReactive } from 'vue';
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

    const translations = shallowReactive({
      image: {
        imgurl: 'image.imgurl',
      },
    });

    onMounted(async () => {
      // Load translations
      const loadedTranslations = await loadTranslations();
      if (loadedTranslations) {
        Object.assign(translations, loadedTranslations);
      }
    });

    const loadTranslations = async () => {
      const selectedLanguage = localStorage.getItem('selectedLanguage') || 'en';
      try {
        const translationModule = await import(
          `../../pages/settings/locales/${selectedLanguage}.json`
        );
        return translationModule.default;
      } catch (error) {
        console.error('Error loading translations:', error);
        return null;
      }
    };

    return {
      translations,
      editorImage,
      currentImage,
    };
  },
};
</script>
