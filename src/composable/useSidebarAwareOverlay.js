import { computed } from 'vue';
import { useSidebar } from '@/composable/useSidebar';
import { useUiState } from '@/composable/useUiState';
import { backend } from '@/lib/tauri-bridge';
import { foldState } from '@/lib/foldable';

export function useSidebarAwareOverlay() {
  const { expanded: sidebarExpanded } = useSidebar();
  const uiState = useUiState();
  const isMobile = backend.isMobileRuntime();

  const boundsStyle = computed(() => ({
    left:
      isMobile || uiState.inReaderMode
        ? '0.5rem'
        : sidebarExpanded.value
          ? 'calc(16rem + 0.5rem)'
          : 'calc(4rem + 0.5rem)',
    right: foldState.isFoldable
      ? 'calc(var(--app-rail-width) + 0.5rem)'
      : '0.5rem',
  }));

  return { boundsStyle };
}
