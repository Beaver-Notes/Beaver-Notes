import { computed, ref } from 'vue';
import { getSettingSync, setSetting } from '@/composable/settings';
import { useAccountStore } from '@/store/account';
import { SYNC_TRANSPORT } from '@/lib/api/types.js';
import { describeActiveTransport } from '@/utils/sync/transport.js';
import { forceSyncNow } from '@/utils/sync';

export function useSyncTransport() {
  const accountStore = useAccountStore();
  const transport = ref(
    getSettingSync('syncTransport') || SYNC_TRANSPORT.FOLDER
  );

  const description = computed(() => describeActiveTransport());

  const isFolder = computed(
    () =>
      transport.value === SYNC_TRANSPORT.FOLDER ||
      transport.value === SYNC_TRANSPORT.BOTH
  );
  const isRemote = computed(
    () =>
      (transport.value === SYNC_TRANSPORT.REMOTE ||
        transport.value === SYNC_TRANSPORT.BOTH) &&
      accountStore.isPaidPlan
  );

  async function setTransport(value) {
    if (
      value !== SYNC_TRANSPORT.FOLDER &&
      value !== SYNC_TRANSPORT.REMOTE &&
      value !== SYNC_TRANSPORT.BOTH
    ) {
      return;
    }
    transport.value = value;
    await setSetting('syncTransport', value);
    if (value === SYNC_TRANSPORT.REMOTE && accountStore.isAuthenticated) {
      forceSyncNow().catch(() => {});
    }
  }

  return {
    transport,
    isFolder,
    isRemote,
    description,
    setTransport,
  };
}
