import { computed, ref } from 'vue';
import { getSettingSync, setSetting } from '@/lib/settings';
import { useAccountStore } from '@/store/account';
import { SYNC_TRANSPORT, normalizeSyncTransport } from '@/lib/api/types.js';
import { kickRustSync } from '@/utils/sync/rust-shim.js';

export function useSyncTransport() {
  const accountStore = useAccountStore();
  const transport = ref(
    normalizeSyncTransport(getSettingSync('syncTransport'))
  );

  // Folder sync is the free/anonymous transport. A paid account syncs to the
  // cloud even if a folder path is still stored on this install, so a paid
  // workspace can never ingest a folder that belongs to a free one.
  const isFolder = computed(
    () => transport.value === SYNC_TRANSPORT.FOLDER && !accountStore.isPaidPlan
  );
  const isRemote = computed(() => accountStore.isPaidPlan);

  // Reflects live Yjs engine transports, derived from same state at sync time: never drifts.
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
    if (isFolder.value) return ['local'];
    return ['cloud'];
  });

  async function setTransport(value) {
    if (
      value !== SYNC_TRANSPORT.FOLDER &&
      value !== SYNC_TRANSPORT.REMOTE
    ) {
      return;
    }
    if (value === SYNC_TRANSPORT.FOLDER && accountStore.isPaidPlan) return;
    transport.value = value;
    await setSetting('syncTransport', value);
    if (accountStore.isAuthenticated) {
      kickRustSync();
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
