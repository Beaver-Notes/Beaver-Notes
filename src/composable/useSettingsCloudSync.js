import { useAccountStore } from '@/store/account';
import { useSyncTransport } from './useSyncTransport';
import { SYNC_TRANSPORT } from '@/lib/api/types.js';

const TRANSPORT_OPTIONS = [
  {
    value: SYNC_TRANSPORT.FOLDER,
    icon: 'riFolderLine',
    title: 'Folder only',
    description: 'Sync to a local folder you choose (iCloud, Dropbox, etc.).',
  },
  {
    value: SYNC_TRANSPORT.REMOTE,
    icon: 'riCloudLine',
    title: 'Cloud sync',
    description:
      'Sync through Beaver Sync (Basic plan and up). End-to-end encrypted.',
  },
  {
    value: SYNC_TRANSPORT.BOTH,
    icon: 'riShieldStarLine',
    title: 'Both',
    description:
      'Write to the local folder and to Beaver Sync at the same time.',
  },
];

export function useSettingsCloudSync() {
  const accountStore = useAccountStore();
  const transport = useSyncTransport();

  function selectTransport(value) {
    if (value === SYNC_TRANSPORT.REMOTE && !accountStore.isPaidPlan) {
      return false;
    }
    transport.setTransport(value);
    return true;
  }

  return {
    transport,
    canUseCloud: accountStore.canUseCloudSync,
    isAuthenticated: accountStore.isAuthenticated,
    isPaid: accountStore.isPaidPlan,
    plan: accountStore.subscription?.plan ?? null,
    get description() {
      return transport.description;
    },
    get options() {
      return TRANSPORT_OPTIONS;
    },
    selectTransport,
  };
}
