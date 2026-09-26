import { computed } from 'vue';
import { useTranslations } from '@/composable/useTranslations';
import { useSyncProgressStore } from '@/store/sync-progress';
import { kickRustSync } from '@/utils/sync/rust-shim.js';

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

  function syncNow() {
    if (syncProgressStore.isSyncing) return;
    kickRustSync();
  }

  return { lastSyncAt, lastSyncLabel, syncNow };
}
