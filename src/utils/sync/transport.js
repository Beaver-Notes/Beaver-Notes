import { getSettingSync } from '@/composable/settings';
import { useAccountStore } from '@/store/account';
import * as folder from './local-folder.js';
import * as remote from './remote.js';
import { SYNC_TRANSPORT, isPaidPlan } from '@/lib/api/types.js';

const FOLDER = {
  id: 'folder',
  ...folder,
};

const REMOTE = {
  id: 'remote',
  ...remote,
};

function readSyncTransportSetting() {
  const value = getSettingSync('syncTransport');
  if (value === SYNC_TRANSPORT.REMOTE || value === SYNC_TRANSPORT.BOTH) {
    return value;
  }
  return SYNC_TRANSPORT.FOLDER;
}

function isRemoteAllowed() {
  const accountStore = useAccountStore();
  if (accountStore.status !== 'authenticated') return false;
  if (!accountStore.serverUrl) return false;
  if (!isPaidPlan(accountStore.subscription?.plan)) return false;
  return true;
}

export async function resolveActiveTransports() {
  const setting = readSyncTransportSetting();
  const transports = [];

  const wantFolder =
    setting === SYNC_TRANSPORT.FOLDER || setting === SYNC_TRANSPORT.BOTH;
  const wantRemote =
    setting === SYNC_TRANSPORT.REMOTE || setting === SYNC_TRANSPORT.BOTH;

  if (wantFolder) {
    try {
      if (await folder.folderReady()) {
        transports.push(FOLDER);
      }
    } catch (err) {
      console.warn('[sync-transport] folder check failed:', err);
    }
  }

  if (wantRemote && isRemoteAllowed()) {
    try {
      if (await remote.remoteReady()) {
        transports.push(REMOTE);
      }
    } catch (err) {
      console.warn('[sync-transport] remote check failed:', err);
    }
  }

  return transports;
}

export function describeActiveTransport() {
  const setting = readSyncTransportSetting();
  const accountStore = useAccountStore();
  const remoteReady = isRemoteAllowed();
  const folderReady =
    setting === SYNC_TRANSPORT.FOLDER || setting === SYNC_TRANSPORT.BOTH;

  const active = [];
  if (setting === SYNC_TRANSPORT.FOLDER) {
    active.push('folder');
  } else if (setting === SYNC_TRANSPORT.REMOTE) {
    if (remoteReady) active.push('remote');
    else active.push('folder-fallback');
  } else if (setting === SYNC_TRANSPORT.BOTH) {
    if (remoteReady) active.push('remote');
    if (folderReady) active.push('folder');
  }
  return {
    setting,
    remoteReady,
    canUseRemote: remoteReady,
    active,
    plan: accountStore.subscription?.plan ?? null,
  };
}
