import { computed } from 'vue';
import { useTranslations } from '@/composable/useTranslations';
import { useSyncProgressStore } from '@/store/sync-progress';
import { useAccountStore } from '@/store/account';
import { kickRustSync } from '@/utils/sync/rust-shim.js';
import { initAppSync } from '@/utils/sync/app-sync.js';
import { getWsSync, isIOSNetworkUnlocked, unlockIOSNetwork } from '@/lib/sync/ws-sync.js';
import { backend } from '@/lib/tauri-bridge';

export function useSyncControl() {
  const { translations } = useTranslations();
  const syncProgressStore = useSyncProgressStore();

  const lastSyncAt = computed(() => syncProgressStore.lastSyncAt);
  const lastSyncLabel = computed(() => {
    if (syncProgressStore.lastAttemptFailed)
      return (
        translations.value.settings?.lastAttemptFailed || 'Last attempt failed'
      );
    if (!lastSyncAt.value)
      return translations.value.settings?.neverSynced || 'Never synced yet';
    const secs = Math.floor((Date.now() - lastSyncAt.value) / 1000);
    if (secs < 60)
      return translations.value.settings?.syncedJustNow || 'Synced just now';
    if (secs < 3600) {
      const min = Math.floor(secs / 60);
      return `${translations.value.settings?.syncedMinAgo || 'Synced {n} min ago'}`.replace(
        '{n}',
        String(min),
      );
    }
    return new Date(lastSyncAt.value).toLocaleString();
  });

  async function syncNow() {
    if (syncProgressStore.isSyncing) return;
    const firstUnlock = backend.isIOSRuntime() && !isIOSNetworkUnlocked();
    try {
      getWsSync().start({ userInitiated: true });
    } catch {}
    await initAppSync({ userInitiated: true }).catch(() => {});
    if (firstUnlock) {
      unlockIOSNetwork();
      const accountStore = useAccountStore();
      if (accountStore.isAuthenticated) {
        const { useCloudWorkspaces } = await import('@/composable/useCloudWorkspaces');
        useCloudWorkspaces().fetchWorkspaces().catch(() => {});
      }
    }
    kickRustSync();
  }

  return { lastSyncAt, lastSyncLabel, syncNow };
}
