<template>
  <div
    class="flex items-center rounded-2xl border border-primary/15 bg-white/90 px-2 py-1.5 text-neutral-700 backdrop-blur dark:border-primary/20 dark:bg-neutral-800/90 dark:text-[color:var(--selected-dark-text)]"
  >
    <button
      type="button"
      class="flex h-10 w-10 items-center justify-center rounded-xl text-sm font-semibold text-neutral-500 transition hover:bg-primary/10 hover:text-primary dark:text-neutral-300 dark:hover:bg-primary/15 dark:hover:text-primary"
      :class="
        currentLayout === 'wrap-left'
          ? 'bg-primary/10 text-primary ring-1 ring-primary/20 dark:bg-primary/15'
          : ''
      "
      title="Wrap text on the right"
      @click="setLayout('wrap-left')"
    >
      <span>L</span>
    </button>
    <button
      type="button"
      class="flex h-10 w-10 items-center justify-center rounded-xl text-sm font-semibold text-neutral-500 transition hover:bg-primary/10 hover:text-primary dark:text-neutral-300 dark:hover:bg-primary/15 dark:hover:text-primary"
      :class="
        currentLayout === 'block'
          ? 'bg-primary/10 text-primary ring-1 ring-primary/20 dark:bg-primary/15'
          : ''
      "
      title="Keep image on its own line"
      @click="setLayout('block')"
    >
      <span>C</span>
    </button>
    <button
      type="button"
      class="flex h-10 w-10 items-center justify-center rounded-xl text-sm font-semibold text-neutral-500 transition hover:bg-primary/10 hover:text-primary dark:text-neutral-300 dark:hover:bg-primary/15 dark:hover:text-primary"
      :class="
        currentLayout === 'wrap-right'
          ? 'bg-primary/10 text-primary ring-1 ring-primary/20 dark:bg-primary/15'
          : ''
      "
      title="Wrap text on the left"
      @click="setLayout('wrap-right')"
    >
      <span>R</span>
    </button>
    <span class="mx-1 h-8 w-px rounded-full bg-primary/15 dark:bg-primary/20" />
    <button
      type="button"
      class="flex h-10 w-10 items-center justify-center rounded-xl text-neutral-500 transition hover:bg-primary/10 hover:text-primary dark:text-neutral-300 dark:hover:bg-primary/15 dark:hover:text-primary"
      title="Download image"
      @click="downloadImage"
    >
      <v-remixicon name="riDownload2Line" />
    </button>
    <span class="mx-1 h-8 w-px rounded-full bg-primary/15 dark:bg-primary/20" />
    <button
      type="button"
      class="flex h-10 w-10 items-center justify-center rounded-xl text-neutral-500 transition hover:bg-red-50 hover:text-red-500 dark:text-neutral-300 dark:hover:bg-red-500/10 dark:hover:text-red-300"
      :title="deleteTitle"
      @click="removeImage"
    >
      <v-remixicon name="riDeleteBin6Line" />
    </button>
  </div>
</template>

<script>
import { onMounted, onUnmounted, ref } from 'vue';
import { useTranslations } from '@/composable/useTranslations';
import { backend } from '@/lib/tauri-bridge';

function normalizeSrc(src) {
  return String(src || '').split('?')[0];
}

function isLocalAsset(src) {
  return src.startsWith('assets://') || src.startsWith('file-assets://');
}

function base64ToUint8Array(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);

  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }

  return bytes;
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

function getWidthStyle(attrs) {
  if (attrs?.containerStyle) {
    const width = attrs.containerStyle.match(/width:\s*([^;]+)/);

    if (width) {
      return width[1].trim();
    }
  }

  if (attrs?.width) {
    return `${attrs.width}px`;
  }

  return '100%';
}

function getNumericWidth(attrs) {
  if (attrs?.containerStyle) {
    const width = attrs.containerStyle.match(/width:\s*([0-9.]+)px/);

    if (width) {
      return Number(width[1]);
    }
  }

  return Number(attrs?.width) || null;
}
function getSuggestedWrapWidth(attrs) {
  const currentWidth = getNumericWidth(attrs);

  if (currentWidth) {
    return `${Math.min(currentWidth, 420)}px`;
  }

  return '62%';
}

function getLayoutMode(attrs = {}) {
  const wrapperStyle = attrs.wrapperStyle || '';

  if (wrapperStyle.includes('float: left')) return 'wrap-left';
  if (wrapperStyle.includes('float: right')) return 'wrap-right';

  return 'block';
}

export default {
  props: {
    editor: {
      type: Object,
      default: () => ({}),
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

      const { canceled, filePath } = await backend.invoke('dialog:save', {
        defaultPath: getFileName(src),
      });

      if (canceled || !filePath) return;

      if (isLocalAsset(src)) {
        const base64 = await backend.invoke('fs:readData', encodeURI(src));

        if (!base64) return;

        await backend.invoke('fs:writeFile', {
          path: filePath,
          data: base64ToUint8Array(base64),
          skipAssetEncryption: true,
        });

        return;
      }

      const response = await fetch(src);
      const payload = new Uint8Array(await response.arrayBuffer());

      await backend.invoke('fs:writeFile', {
        path: filePath,
        data: payload,
        skipAssetEncryption: true,
      });
    }

    function setLayout(mode) {
      const attrs = props.editor.getAttributes('image');
      const width =
        mode === 'block' ? getWidthStyle(attrs) : getSuggestedWrapWidth(attrs);

      const layouts = {
        block: {
          wrapperStyle: 'display: block; clear: both;',
          containerStyle: `width: ${width}; height: auto; margin: 0 auto;`,
        },
        'wrap-left': {
          wrapperStyle: 'display: block; float: left;',
          containerStyle: `width: ${width}; height: auto; margin: 0 1rem 0.75rem 0;`,
        },
        'wrap-right': {
          wrapperStyle: 'display: block; float: right;',
          containerStyle: `width: ${width}; height: auto; margin: 0 0 0.75rem 1rem;`,
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
      translations,
      currentLayout,
      deleteTitle,
      downloadImage,
      setLayout,
      removeImage,
    };
  },
};
</script>
