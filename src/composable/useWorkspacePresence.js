import { watch, onBeforeUnmount } from 'vue';
import { useAccountStore } from '@/store/account';
import { getWsSync } from '@/lib/sync/ws-sync';
import { displayName } from '@/utils/displayName';
import { usePresence } from './usePresence';

/**
 * Workspace-scope presence: every member present in the active workspace's
 * meta room, as distinct from per-note cursors. The meta-room awareness is
 * owned by ws-sync (session-long) and lands or is swapped asynchronously, so
 * watch it and (re)bind rather than reading it once at setup.
 */
export function useWorkspacePresence() {
  const accountStore = useAccountStore();
  const metaAwareness = getWsSync().getMetaAwareness();
  const presence = usePresence(
    metaAwareness,
    () => accountStore.profile?.id || 'anonymous',
    () => displayName(accountStore.profile),
  );

  const unwatch = watch(
    metaAwareness,
    (awareness) => {
      presence.destroy();
      if (awareness) presence.init();
    },
    { immediate: true },
  );

  onBeforeUnmount(() => {
    unwatch();
    presence.destroy();
  });

  return {
    peers: presence.peers,
    destroy: () => presence.destroy(),
  };
}
