<template>
  <div
    class="pointer-events-none fixed inset-x-0 z-[80] flex flex-col items-center gap-2 bottom-[calc(var(--app-safe-area-bottom)+1.5rem)] px-4"
  >
    <transition-group name="ui-toast">
      <div
        v-for="toast in toastStore.toasts"
        :key="toast.id"
        role="status"
        :class="[
          'pointer-events-auto flex items-center gap-3 rounded-xl px-4 py-3 text-sm ring-1 backdrop-blur shadow-md',
          kinds[toast.kind] || kinds.info,
        ]"
      >
        <p>{{ toast.title }}</p>
        <button
          v-if="toast.undo"
          class="text-sm font-semibold text-primary whitespace-nowrap transition-colors hover:text-opacity-80"
          @click="handleUndo(toast)"
        >
          {{ translations.toast?.undo || 'Undo' }}
        </button>
      </div>
    </transition-group>
  </div>
</template>

<script>
import { useToastStore } from '@/store/ui-toast';
import { useTranslations } from '@/composable/useTranslations';

export default {
  name: 'ToastHost',
  setup() {
    const toastStore = useToastStore();
    const { translations } = useTranslations();

    function handleUndo(toast) {
      toast.undo?.();
      toastStore.dismiss(toast.id);
    }

    return {
      toastStore,
      translations,
      handleUndo,
      kinds: {
        info: 'bg-white/90 text-neutral-800 ring-neutral-200 dark:bg-neutral-900/90 dark:text-neutral-100 dark:ring-neutral-700',
        success:
          'bg-emerald-50/90 text-emerald-800 ring-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:ring-emerald-900',
        danger:
          'bg-red-50/80 text-red-700 ring-red-200 dark:bg-red-950/40 dark:text-red-300 dark:ring-red-800',
      },
    };
  },
};
</script>

<style scoped>
.ui-toast-enter-active,
.ui-toast-leave-active {
  transition:
    opacity var(--motion-base) var(--ease-standard),
    transform var(--motion-base) var(--ease-standard);
}
.ui-toast-enter-from,
.ui-toast-leave-to {
  opacity: 0;
  transform: translateY(8px);
}
.ui-toast-move {
  transition: transform var(--motion-base) var(--ease-standard);
}
@media (prefers-reduced-motion: reduce) {
  .ui-toast-enter-active,
  .ui-toast-leave-active,
  .ui-toast-move {
    transition-duration: 0.01ms !important;
  }
}
</style>
