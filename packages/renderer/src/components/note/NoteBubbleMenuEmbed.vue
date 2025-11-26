<template>
  <div class="p-2 flex items-center space-x-2">
    <input
      id="bubble-input"
      v-model="embedUrl"
      type="url"
      :placeholder="translations.editor.embedPlaceholder || 'Enter embed URL…'"
      class="flex-1 bg-transparent"
      @keyup.enter="applyEmbed"
      @keydown.esc="editor.commands.focus()"
    />
    <button
      icon
      class="text-neutral-600 dark:text-neutral-200"
      title="Remove embed"
      @click="removeEmbed"
    >
      <v-remixicon name="riDeleteBin6Line" />
    </button>
    <button
      icon
      class="text-neutral-600 -mr-1 dark:text-neutral-200"
      title="Save embed"
      @click="applyEmbed"
    >
      <v-remixicon name="riSave3Line" />
    </button>
  </div>
</template>

<script>
import { ref, onMounted, watch } from 'vue';
import { useTranslation } from '@/composable/translations';

export default {
  props: {
    editor: {
      type: Object,
      default: () => ({}),
    },
  },
  setup(props) {
    const embedUrl = ref('');
    const translations = ref({ editor: {} });

    const applyEmbed = () => {
      if (!embedUrl.value.trim()) return;

      let url = embedUrl.value.trim();

      if (url.includes('youtube.com/watch?v=')) {
        const videoId = new URL(url).searchParams.get('v');
        if (videoId) url = `https://www.youtube.com/embed/${videoId}`;
      }

      props.editor
        .chain()
        .focus()
        .deleteSelection()
        .setIframe({ src: url })
        .run();

      embedUrl.value = '';
    };

    const removeEmbed = () => {
      // This assumes your iframe node is selected
      props.editor.chain().focus().deleteSelection().run();
    };

    watch(
      () => props.editor.getAttributes('iframe'),
      (attrs) => {
        embedUrl.value = attrs?.src ?? '';
      },
      { immediate: true }
    );

    onMounted(async () => {
      const trans = await useTranslation();
      if (trans) translations.value = trans;
    });

    return { embedUrl, translations, applyEmbed, removeEmbed };
  },
};
</script>
