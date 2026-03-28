<template>
  <div
    ref="shellRef"
    class="editor-actions-mobile-shell sticky z-[160] no-print transition-opacity duration-150 w-full bg-neutral-50 dark:bg-neutral-900"
    :style="shellStyle"
  >
    <div class="flex w-full items-center justify-between p-1.5">
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
          <span class="min-w-0 flex-1">
            <span class="block text-sm font-medium">{{ action.title }}</span>
            <span
              class="block text-[11px] text-neutral-500 dark:text-neutral-400"
            >
              {{ action.support.label }}
            </span>
          </span>
          <span
            class="rounded-full px-2 py-0.5 text-[11px] font-semibold"
            :class="
              action.support.level === 'best'
                ? 'bg-emerald-500/10 text-emerald-700 dark:bg-emerald-400/15 dark:text-emerald-300'
                : 'bg-amber-500/10 text-amber-700 dark:bg-amber-400/15 dark:text-amber-300'
            "
          >
            {{ action.support.label }}
          </span>
        </button>
      </div>
    </ui-modal>
  </div>
</template>

<script>
import { computed, onMounted, onUnmounted, ref } from 'vue';
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
    const shellRef = ref(null);
    const showShareDialog = ref(false);
    const isStuck = ref(false);
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

    const shellStyle = computed(() => ({
      paddingTop: isStuck.value ? 'calc(var(--app-safe-area-top))' : undefined,
      borderBottom: isStuck.value ? 'solid' : undefined,
    }));

    const syncStickyState = () => {
      if (typeof window === 'undefined' || !shellRef.value) return;

      const { top } = shellRef.value.getBoundingClientRect();
      isStuck.value = top <= 0;
    };

    onMounted(() => {
      syncStickyState();
      window.addEventListener('scroll', syncStickyState, { passive: true });
      window.addEventListener('resize', syncStickyState, { passive: true });
    });

    onUnmounted(() => {
      window.removeEventListener('scroll', syncStickyState);
      window.removeEventListener('resize', syncStickyState);
    });

    return {
      shellRef,
      shellStyle,
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
  top: 0;
  margin-bottom: 1rem;
  transition: padding-top 180ms ease, box-shadow 180ms ease,
    background-color 180ms ease;
}
</style>
