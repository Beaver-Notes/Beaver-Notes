import { getSyncPath } from './path.js';
import { path } from '@/lib/tauri-bridge';
import { ensureDir, writeFile, readData, pathExists } from '@/lib/native/fs';
import { getSettingSync } from '@/composable/settings';
import { useAccountStore } from '@/store/account';
import { SYNC_TRANSPORT, canUseCloudSync } from '@/lib/api/types';
import { pushUpdates, pullUpdates, fetchUpdate } from './remote-yjs.js';

export const RESERVED_KEY_PARAMS_KEY = '__key_params__.json';
const KEY_PARAMS_SUBDIR = 'BeaverNotesSync';

function keyParamsPath(syncPath) {
  return path.join(syncPath, KEY_PARAMS_SUBDIR, 'keyParams.json');
}

export function cloudKeyParamsReachable({ force = false } = {}) {
  const accountStore = useAccountStore();
  const transport = getSettingSync('syncTransport') || SYNC_TRANSPORT.FOLDER;
  const wantsCloud =
    transport === SYNC_TRANSPORT.REMOTE || transport === SYNC_TRANSPORT.BOTH;
  return Boolean(
    accountStore.isAuthenticated &&
      canUseCloudSync(accountStore.subscription) &&
      (force || wantsCloud)
  );
}

export async function publishCloudKeyParams() {
  const syncPath = await getSyncPath();
  if (!syncPath || !cloudKeyParamsReachable()) return false;
  const p = keyParamsPath(syncPath);
  const exists = await pathExists(p).catch(() => false);
  if (!exists) return false;
  const b64 = await readData(p).catch(() => null);
  if (!b64) return false;
  await pushUpdates([{ key: RESERVED_KEY_PARAMS_KEY, data: b64 }]);
  return true;
}

export async function fetchCloudKeyParams({ force = false } = {}) {
  const syncPath = await getSyncPath();
  if (!syncPath || !cloudKeyParamsReachable({ force })) return null;

  let raw = null;
  try {
    raw = await fetchUpdate(RESERVED_KEY_PARAMS_KEY);
  } catch (e) {
    console.warn('[vault-key-params] GET failed, scanning pull:', e);
  }
  if (!raw) {
    try {
      const updates = await pullUpdates({});
      raw = updates.find((u) => u.key === RESERVED_KEY_PARAMS_KEY)?.data ?? null;
    } catch (e) {
      console.warn('[vault-key-params] pull scan failed:', e);
    }
  }
  if (!raw) return null;

  await ensureDir(path.join(syncPath, KEY_PARAMS_SUBDIR)).catch(() => {});
  await writeFile(keyParamsPath(syncPath), atob(raw));
  return true;
}
