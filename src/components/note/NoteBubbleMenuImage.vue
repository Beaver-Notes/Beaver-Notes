<template>
  <div
    class="bg-white dark:bg-neutral-900 border z-20 w-fit mx-auto p-1 rounded-xl shadow-md no-print flex items-center"
  >
    <button
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
      class="hoverable h-8 w-8 rounded-lg transition-colors flex items-center justify-center"
      :class="
        currentLayout === 'block'
          ? 'bg-primary/10 text-primary ring-1 ring-primary/20 dark:bg-primary/15'
          : ''
      "
      :title="
        translations.editor.keepImageOnOwnLine || 'Keep image on its own line'
      "
      @click="setLayout('block')"
    >
      <v-remixicon name="riAlignCenter" class="size-5" />
    </button>
    <button
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
    <span class="border-r mx-1 h-6" />
    <button
      class="hoverable h-8 w-8 rounded-lg transition-colors flex items-center justify-center"
      :title="translations.editor.downloadImage || 'Download image'"
      @click="downloadImage"
    >
      <v-remixicon name="riDownload2Line" class="size-5" />
    </button>
    <span class="border-r mx-1 h-6" />
    <button
      class="hoverable h-8 w-8 rounded-lg transition-colors flex items-center justify-center"
      :title="deleteTitle"
      @click="removeImage"
    >
      <v-remixicon name="riDeleteBin6Line" class="size-5" />
    </button>
  </div>
</template>

<script>
import { onMounted, onUnmounted, ref } from 'vue';
import { useTranslations } from '@/composable/useTranslations';
import { saveDialog } from '@/lib/native/dialog';
import { readData, writeFile } from '@/lib/native/fs';
import { base64ToUint8Array } from '@/utils/helpers/index.js';

function normalizeSrc(src) {
  return String(src || '').split('?')[0];
}

function isLocalAsset(src) {
  return src.startsWith('assets://') || src.startsWith('file-assets://');
}



function getFileName(src) {
  const normalizedSrc = normalizeSrc(src);

  if (!normalizedSrc) return 'image';

  if (isLocalAsset(normalizedSrc)) {
    return decodeURIComponent(normalizedSrc.split('/').pop() || 'image');
  }

  try {
    const url = new URL(normalizedSrc);
    return decodeURIComponent(url.pathname.split('/').pop() || 'image');
  } catch {
    return 'image';
  }
}

function getNumericWidth(attrs) {
  const width = Number(attrs?.width);

  if (Number.isFinite(width) && width > 0) {
    return width;
  }

  if (attrs?.containerStyle) {
    const legacyWidth = attrs.containerStyle.match(/width:\s*([0-9.]+)px/);

    if (legacyWidth) {
      return Number(legacyWidth[1]);
    }
  }

  return null;
}

function getSuggestedWrapWidth(attrs) {
  const currentWidth = getNumericWidth(attrs);

  if (currentWidth) {
    return Math.min(currentWidth, 420);
  }

  return 420;
}

function getLayoutMode(attrs = {}) {
  if (['block', 'wrap-left', 'wrap-right'].includes(attrs.layout)) {
    return attrs.layout;
  }

  const wrapperStyle = attrs.wrapperStyle || '';

  if (wrapperStyle.includes('float: left')) return 'wrap-left';
  if (wrapperStyle.includes('float: right')) return 'wrap-right';

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
    const deleteTitle =
      translations.value?.card?.delete ||
      translations.value?.menu?.delete ||
      'Delete';

    function syncLayout() {
      currentLayout.value = getLayoutMode(props.editor.getAttributes('image'));
    }

    async function downloadImage() {
      const src = normalizeSrc(props.editor.getAttributes('image').src);

      if (!src) return;

      const { canceled, filePath } = await saveDialog({
        defaultPath: getFileName(src),
      });

      if (canceled || !filePath) return;

      if (isLocalAsset(src)) {
        const base64 = await readData(encodeURI(src));

        if (!base64) return;

        await writeFile(filePath, base64ToUint8Array(base64), {
          skipAssetEncryption: true,
        });

        return;
      }

      const response = await fetch(src);
      const payload = new Uint8Array(await response.arrayBuffer());

      await writeFile(filePath, payload, {
        skipAssetEncryption: true,
      });
    }

    function setLayout(mode) {
      const attrs = props.editor.getAttributes('image');
      const nextWidth =
        mode === 'block'
          ? getNumericWidth(attrs)
          : getSuggestedWrapWidth(attrs);

      const layouts = {
        block: {
          layout: 'block',
          width: nextWidth,
          wrapperStyle: null,
          containerStyle: null,
        },
        'wrap-left': {
          layout: 'wrap-left',
          width: nextWidth,
          wrapperStyle: null,
          containerStyle: null,
        },
        'wrap-right': {
          layout: 'wrap-right',
          width: nextWidth,
          wrapperStyle: null,
          containerStyle: null,
        },
      };

      props.editor
        .chain()
        .focus()
        .updateAttributes('image', layouts[mode])
        .run();
      currentLayout.value = mode;
    }

    function removeImage() {
      props.editor.chain().focus().deleteSelection().run();
    }

    onMounted(() => {
      syncLayout();
      props.editor.on('selectionUpdate', syncLayout);
      props.editor.on('transaction', syncLayout);
    });

    onUnmounted(() => {
      props.editor.off('selectionUpdate', syncLayout);
      props.editor.off('transaction', syncLayout);
    });

    return {
      currentLayout,
      deleteTitle,
      downloadImage,
      setLayout,
      removeImage,
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
