<template>
  <transition name="undo-banner">
    <ui-pill v-show="visible" :style="positionStyle">
      <div class="flex items-center gap-1.5 py-1 pl-1.5 pr-1.5">
        <v-remixicon name="riArrowGoBackLine" class="text-lg text-primary" />

        <p class="flex-grow text-sm text-gray-800 dark:text-gray-100">
          {{ message }}
        </p>

        <button
          class="text-sm font-semibold text-primary hover:text-opacity-80 transition-colors whitespace-nowrap"
          @click="handleUndo"
        >
          {{ t?.card?.undo || 'Undo' }}
        </button>
      </div>
    </ui-pill>
  </transition>
</template>

<script>
import { ref, watch, onUnmounted } from 'vue';
import { useUndoStore } from '@/store/undo';
import { useTranslations } from '@/composable/useTranslations';

export default {
  name: 'UndoBanner',
  props: {
    positionStyle: { type: Object, default: () => ({}) },
  },
  setup() {
    const undoStore = useUndoStore();
    const { translations } = useTranslations();
    const t = translations.value;

    const visible = ref(false);
    const message = ref('');
    let timer = null;

    function actionMessage(action) {
      if (!action) return '';
      switch (action.type) {
        case 'bulk-delete': {
          const noteCount =
            action.items?.filter((i) => i.type === 'note').length || 0;
          const folderCount =
            action.items?.filter((i) => i.type === 'folder').length || 0;
          const parts = [];
          if (noteCount)
            parts.push(`${noteCount} ${t?.card?.notes || 'notes'}`);
          if (folderCount)
            parts.push(`${folderCount} ${t?.card?.folders || 'folders'}`);
          return `${parts.join(' & ')} ${t?.card?.deleted || 'deleted'}`;
        }
        case 'toggle-archive':
          return t?.card?.archived || 'Archived';
        case 'toggle-bookmark':
          return t?.card?.bookmarked || 'Bookmarked';
        case 'move':
          return t?.card?.moved || 'Moved';
        default:
          return t?.card?.actionUndone || 'Action undone';
      }
    }

    function show(action) {
      if (timer) clearTimeout(timer);
      message.value = actionMessage(action);
      visible.value = true;
      timer = setTimeout(() => {
        visible.value = false;
      }, 4000);
    }

    function handleUndo() {
      visible.value = false;
      if (timer) clearTimeout(timer);
      undoStore.undo();
    }

    watch(
      () => undoStore.lastAction,
      (action) => {
        if (action) show(action);
      },
    );

    onUnmounted(() => {
      if (timer) clearTimeout(timer);
    });

    return { visible, message, handleUndo, t };
  },
};
</script>

<style scoped>
.undo-banner-enter-active,
.undo-banner-leave-active {
  transition:
    opacity 0.16s ease-out,
    transform 0.16s ease-out;
}
.undo-banner-enter-from,
.undo-banner-leave-to {
  opacity: 0;
  transform: translateY(8px);
}
@media (prefers-reduced-motion: reduce) {
  .undo-banner-enter-active,
  .undo-banner-leave-active {
    transition-duration: 0.01ms;
  }
}
</style>
