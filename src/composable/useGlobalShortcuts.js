import { onMounted, onUnmounted } from 'vue';
import { bindGlobalShortcuts } from '@/utils/ui/globalShortcuts.js';

export function useGlobalShortcuts(shortcuts, options) {
  let removeGlobalShortcuts = () => {};

  onMounted(() => {
    const resolvedShortcuts =
      typeof shortcuts === 'function' ? shortcuts() : shortcuts;
    removeGlobalShortcuts = bindGlobalShortcuts(resolvedShortcuts, options);
  });

  onUnmounted(() => {
    removeGlobalShortcuts();
  });
}
