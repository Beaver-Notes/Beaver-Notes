<template>
  <div
    class="bg-white dark:bg-neutral-900 border z-20 w-fit mx-auto p-1 rounded-xl shadow-md no-print flex items-center"
  >
    <button
      v-keep-focus
      class="hoverable h-8 w-8 rounded-lg transition-colors flex items-center justify-center"
      :class="
        currentLayout === 'wrap-left'
          ? 'bg-primary/10 text-primary ring-1 ring-primary/20 dark:bg-primary/15'
          : ''
      "
      :title="translations.editor.wrapRight || 'Wrap text on the right'"
      @click="setLayout('wrap-left')"
    >
      <v-remixicon name="riAlignLeft" class="size-5" />
    </button>
    <button
      v-keep-focus
      class="hoverable h-8 w-8 rounded-lg transition-colors flex items-center justify-center"
      :class="
        currentLayout === 'block'
          ? 'bg-primary/10 text-primary ring-1 ring-primary/20 dark:bg-primary/15'
          : ''
      "
      :title="
        translations.editor.keepVideoOnOwnLine || 'Keep video on its own line'
      "
      @click="setLayout('block')"
    >
      <v-remixicon name="riAlignCenter" class="size-5" />
    </button>
    <button
      v-keep-focus
      class="hoverable h-8 w-8 rounded-lg transition-colors flex items-center justify-center"
      :class="
        currentLayout === 'wrap-right'
          ? 'bg-primary/10 text-primary ring-1 ring-primary/20 dark:bg-primary/15'
          : ''
      "
      :title="translations.editor.wrapLeft || 'Wrap text on the left'"
      @click="setLayout('wrap-right')"
    >
      <v-remixicon name="riAlignRight" class="size-5" />
    </button>
  </div>
</template>

<script>
import { onMounted, onUnmounted, ref } from 'vue';
import { useTranslations } from '@/composable/useTranslations';

function getLayoutMode(attrs = {}) {
  if (['block', 'wrap-left', 'wrap-right'].includes(attrs.layout)) {
    return attrs.layout;
  }

  return 'block';
}

export default {
  props: {
    editor: {
      type: Object,
      default: null,
    },
  },
  setup(props) {
    const { translations } = useTranslations();
    const currentLayout = ref('block');

    function syncLayout() {
      currentLayout.value = getLayoutMode(props.editor.getAttributes('Video'));
    }

    function setLayout(mode) {
      const attrs = props.editor.getAttributes('Video');
      const currentWidth = Number(attrs?.width);
      const width =
        Number.isFinite(currentWidth) && currentWidth > 0
          ? currentWidth
          : mode === 'block'
            ? null
            : 420;

      props.editor
        .chain()
        .focus()
        .updateAttributes('Video', { layout: mode, width })
        .run();
      currentLayout.value = mode;
    }

    onMounted(() => {
      syncLayout();
      props.editor.on('selectionUpdate', syncLayout);
      props.editor.on('transaction', syncLayout);
    });

    onUnmounted(() => {
      if (!props.editor) return;
      props.editor.off('selectionUpdate', syncLayout);
      props.editor.off('transaction', syncLayout);
    });

    return {
      currentLayout,
      setLayout,
      translations,
    };
  },
};
</script>

<style scoped>
@media print {
  .no-print {
    visibility: hidden;
  }
}
</style>
