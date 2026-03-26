<template>
  <div
    class="editor-actions-mobile-shell sticky z-[160] flex justify-center px-4 no-print transition-opacity duration-150"
  >
    <div
      class="flex w-full max-w-md items-center justify-between rounded-2xl border border-black/10 bg-white/90 p-1.5 shadow-lg backdrop-blur dark:border-white/10 dark:bg-neutral-900/85"
    >
      <button
        class="flex h-10 w-10 items-center justify-center rounded-xl text-neutral-600 transition-colors hover:bg-black/5 hover:text-neutral-900 dark:text-neutral-300 dark:hover:bg-white/10 dark:hover:text-white"
        @click="goBack"
      >
        <v-remixicon name="riArrowLeftLine" size="22" />
      </button>

      <div class="flex items-center gap-1">
        <button
          class="flex h-10 w-10 items-center justify-center rounded-xl text-neutral-600 transition-colors hover:bg-black/5 hover:text-neutral-900 dark:text-neutral-300 dark:hover:bg-white/10 dark:hover:text-white"
          @click="showShareDialog = true"
        >
          <v-remixicon name="riShare2Line" size="22" />
        </button>
        <button
          class="flex h-10 w-10 items-center justify-center rounded-xl transition-colors"
          :class="
            store.inReaderMode
              ? 'bg-primary/10 text-primary dark:bg-secondary/10 dark:text-secondary'
              : 'text-neutral-600 hover:bg-black/5 hover:text-neutral-900 dark:text-neutral-300 dark:hover:bg-white/10 dark:hover:text-white'
          "
          @click="toggleReaderMode"
        >
          <v-remixicon name="riArticleLine" size="22" />
        </button>
        <button
          class="flex h-10 w-10 items-center justify-center rounded-xl transition-colors"
          :class="
            showSearch
              ? 'bg-primary/10 text-primary dark:bg-secondary/10 dark:text-secondary'
              : 'text-neutral-600 hover:bg-black/5 hover:text-neutral-900 dark:text-neutral-300 dark:hover:bg-white/10 dark:hover:text-white'
          "
          @click="$emit('toggle-search')"
        >
          <v-remixicon name="riSearchLine" size="22" />
        </button>
      </div>

      <ui-modal v-model="showShareDialog" content-class="max-w-sm">
        <template #header>
          <h3 class="text-lg font-semibold">
            {{ translations.menu.share || 'Share' }}
          </h3>
        </template>

        <div class="grid gap-2 p-2">
          <button
            v-for="action in shareActions"
            :key="action.name"
            class="flex items-center gap-3 rounded-xl px-3 py-3 text-left text-neutral-700 transition-colors hover:bg-black/5 dark:text-neutral-100 dark:hover:bg-white/10"
            @click="runShareAction(action)"
          >
            <v-remixicon :name="action.icon" size="20" />
            <span class="text-sm font-medium">{{ action.title }}</span>
          </button>
        </div>
      </ui-modal>
    </div>
  </div>
</template>

<script>
import { ref } from 'vue';
import { useStore } from '@/store';
import { useTranslations } from '@/composable/useTranslations';
import { useToolbarConfig } from '@/composable/useToolbarConfig';
import { useNoteMenuActions } from '@/composable/useNoteMenuActions';
import { getStoredZoomLevel, setStoredZoomLevel } from '@/composable/zoom';

export default {
  props: {
    editor: { type: Object, required: true },
    id: { type: String, default: '' },
    note: { type: Object, required: true },
    goBack: { type: Function, required: true },
    showSearch: { type: Boolean, default: false },
  },
  emits: ['toggle-search'],
  setup(props) {
    const store = useStore();
    const { translations } = useTranslations();
    const showShareDialog = ref(false);
    useToolbarConfig();

    const { shareActions } = useNoteMenuActions({
      editor: props.editor,
      noteId: props.id,
      noteTitle: props.note.title,
      translations,
    });

    const toggleReaderMode = () => {
      setStoredZoomLevel(getStoredZoomLevel());
      store.inReaderMode = !store.inReaderMode;

      if (store.inReaderMode) {
        document.documentElement.requestFullscreen?.();
        props.editor.commands.focus();
        props.editor.setOptions({ editable: false });
        return;
      }

      document.exitFullscreen?.();
      props.editor.setOptions({ editable: true });
    };

    const runShareAction = (action) => {
      action.handler();
      showShareDialog.value = false;
    };

    return {
      store,
      translations,
      showShareDialog,
      shareActions,
      toggleReaderMode,
      runShareAction,
    };
  },
};
</script>

<style scoped>
.editor-actions-mobile-shell {
  top: calc(var(--app-safe-area-top) + 0.75rem);
  margin-bottom: 0.75rem;
}
</style>
