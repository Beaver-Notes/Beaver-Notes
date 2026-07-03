<template>
  <transition name="undo-banner">
    <div
      v-show="visible"
      class="flex fixed bottom-0 mx-auto items-center w-full mobile:flex hidden"
      style="z-index: 51"
      :style="positionStyle"
    >
      <div class="flex items-center space-x-3 bg-neutral-50 dark:bg-neutral-800 rounded-lg py-3 px-4 max-w-md mx-auto shadow-md mb-4">
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
    </div>
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
          const noteCount = action.items?.filter((i) => i.type === 'note').length || 0;
          const folderCount = action.items?.filter((i) => i.type === 'folder').length || 0;
          const parts = [];
          if (noteCount) parts.push(`${noteCount} ${t?.card?.notes || 'notes'}`);
          if (folderCount) parts.push(`${folderCount} ${t?.card?.folders || 'folders'}`);
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
      }
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
  transition: all 0.3s ease;
}
.undo-banner-enter-from,
.undo-banner-leave-to {
  opacity: 0;
  transform: translateY(1rem);
}
</style>
