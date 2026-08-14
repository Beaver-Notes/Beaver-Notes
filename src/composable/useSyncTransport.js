import { computed, ref } from 'vue';
import { getSettingSync, setSetting } from '@/lib/settings';
import { useAccountStore } from '@/store/account';
import { SYNC_TRANSPORT, normalizeSyncTransport } from '@/lib/api/types.js';
import { forceSyncNow } from '@/utils/sync';

export function useSyncTransport() {
  const accountStore = useAccountStore();
  const transport = ref(
    normalizeSyncTransport(getSettingSync('syncTransport'))
  );

  const isFolder = computed(() => transport.value === SYNC_TRANSPORT.FOLDER);
  const isRemote = computed(
    () =>
      transport.value === SYNC_TRANSPORT.REMOTE && accountStore.isPaidPlan
  );

  // Reflects the transports the *live* Yjs sync engine (utils/sync/index.js)
  // will actually use, derived from the same state it reads at sync time —
  // not a separate computation that can drift from reality.
  const description = computed(() => {
    const active = [];
    if (isFolder.value) active.push('folder');
    if (isRemote.value) active.push('remote');
    return {
      setting: transport.value,
      remoteReady: isRemote.value,
      canUseRemote: accountStore.isPaidPlan,
      active,
      plan: accountStore.subscription?.plan ?? null,
    };
  });

  const activeTransportNames = computed(() => {
    if (transport.value === SYNC_TRANSPORT.FOLDER) return ['local'];
    return ['cloud'];
  });

  async function setTransport(value) {
    if (
      value !== SYNC_TRANSPORT.FOLDER &&
      value !== SYNC_TRANSPORT.REMOTE
    ) {
      return;
    }
    transport.value = value;
    await setSetting('syncTransport', value);
    if (accountStore.isAuthenticated) {
      forceSyncNow().catch(() => {});
    }
  }

  return {
    transport,
    isFolder,
    isRemote,
    description,
    activeTransportNames,
    setTransport,
  };
}
