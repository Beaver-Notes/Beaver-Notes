import { useAccountStore } from '@/store/account';
import { useSyncTransport } from '@/composable/useSyncTransport';
import { PLAN_NAMES, SYNC_TRANSPORT, planLabel } from '@/lib/api/types.js';

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
    description: `Sync through Beaver Sync (${planLabel(PLAN_NAMES.STARTER)} plan and up). End-to-end encrypted.`,
  },
];

// A disabled transport option must say what is missing so the user is not left
// staring at a greyed-out row. Returns null when the option is selectable.
export function transportRequirement(opt, { isPaid, hasSyncPath } = {}) {
  const disabled =
    (opt.value !== SYNC_TRANSPORT.FOLDER && !isPaid) ||
    (opt.value !== SYNC_TRANSPORT.REMOTE && !hasSyncPath);
  if (!disabled) return null;
  if (opt.value !== SYNC_TRANSPORT.FOLDER) {
    return {
      kind: 'plan',
      text: `Requires the ${planLabel(PLAN_NAMES.STARTER)} plan`,
      action: 'Upgrade',
    };
  }
  return { kind: 'folder', text: 'Requires a folder', action: 'Browse' };
}

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
    get canUseCloud() { return accountStore.canUseCloudSync; },
    get isAuthenticated() { return accountStore.isAuthenticated; },
    get isPaid() { return accountStore.isPaidPlan; },
    get plan() { return accountStore.subscription?.plan ?? null; },
    get description() { return transport.description; },
    get options() { return TRANSPORT_OPTIONS; },
    selectTransport,
  };
}
