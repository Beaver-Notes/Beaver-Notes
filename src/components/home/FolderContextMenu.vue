<template>
  <Teleport to="body">
    <div
      class="fixed z-[70] w-44 rounded-xl border bg-white dark:bg-neutral-900 shadow-xl p-1.5 overflow-hidden text-neutral-900 dark:text-neutral-100"
      :style="{ left: `${clampedX}px`, top: `${clampedY}px` }"
      @click.stop
      @contextmenu.prevent
    >
      <template v-if="variant === 'folder'">
        <button
          class="w-full text-left px-3 py-2 text-sm hover:bg-neutral-100 dark:hover:bg-neutral-800 flex items-center gap-2 rounded-lg"
          @click="pick('subfolder')"
        >
          <v-remixicon name="riFolderAddLine" class="size-4" />{{
            t('newSubfolder', 'New subfolder')
          }}
        </button>
        <button
          class="w-full text-left px-3 py-2 text-sm hover:bg-neutral-100 dark:hover:bg-neutral-800 flex items-center gap-2 rounded-lg"
          @click="pick('customize')"
        >
          <v-remixicon name="riPaletteLine" class="size-4" />{{
            t('customize', 'Customize')
          }}
        </button>
        <button
          class="w-full text-left px-3 py-2 text-sm hover:bg-neutral-100 dark:hover:bg-neutral-800 flex items-center gap-2 rounded-lg"
          @click="pick('archive')"
        >
          <v-remixicon
            :name="isArchived ? 'riInboxUnarchiveLine' : 'riArchiveLine'"
            class="size-4"
          />{{
            isArchived ? t('unarchive', 'Unarchive') : t('archive', 'Archive')
          }}
        </button>
        <button
          class="w-full text-left px-3 py-2 text-sm hover:bg-neutral-100 dark:hover:bg-neutral-800 flex items-center gap-2 rounded-lg"
          @click="pick('move')"
        >
          <v-remixicon name="riFolderTransferLine" class="size-4" />{{
            t('move', 'Move')
          }}
        </button>
        <button
          class="w-full text-left px-3 py-2 text-sm text-red-600 hover:bg-red-50 dark:hover:bg-red-500/10 flex items-center gap-2 rounded-lg"
          @click="pick('delete')"
        >
          <v-remixicon name="riDeleteBin6Line" class="size-4" />{{
            t('delete', 'Delete')
          }}
        </button>
      </template>
      <template v-else>
        <button
          class="w-full text-left px-3 py-2 text-sm hover:bg-neutral-100 dark:hover:bg-neutral-800 flex items-center gap-2 rounded-lg"
          @click="pick('new')"
        >
          <v-remixicon name="riFolderAddLine" class="size-4" />{{
            t('newFolder', 'New folder')
          }}
        </button>
      </template>
    </div>
  </Teleport>
</template>

<script setup>
import { computed, onMounted, onBeforeUnmount } from 'vue';
import { useTranslations } from '@/composable/useTranslations';

const props = defineProps({
  x: { type: Number, required: true },
  y: { type: Number, required: true },
  variant: { type: String, default: 'folder' },
  isArchived: { type: Boolean, default: false },
});

const emit = defineEmits(['select', 'close']);

const { translations } = useTranslations();
function t(key, fallback) {
  return translations.value?.card?.[key] || fallback;
}

const clampedX = computed(() =>
  Math.max(8, Math.min(props.x, window.innerWidth - 184)),
);
const clampedY = computed(() =>
  Math.max(8, Math.min(props.y, window.innerHeight - 220)),
);

function pick(action) {
  emit('select', action);
  emit('close');
}
function onKeydown(event) {
  if (event.key === 'Escape') emit('close');
}
function onWindowClick() {
  emit('close');
}
onMounted(() => {
  window.addEventListener('click', onWindowClick);
  window.addEventListener('keydown', onKeydown);
});
onBeforeUnmount(() => {
  window.removeEventListener('click', onWindowClick);
  window.removeEventListener('keydown', onKeydown);
});
</script>
