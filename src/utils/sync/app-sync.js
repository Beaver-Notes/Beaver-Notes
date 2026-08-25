import { initSyncEngine, getSyncEngine } from './engine.js';
import { useStorage } from '@/lib/storage';
import { getSettingSync } from '@/lib/settings';
import { useAccountStore } from '@/store/account';
import { useSyncProgressStore } from '@/store/sync-progress';
import { getSyncPath } from './path.js';
import { SYNC_TRANSPORT, normalizeSyncTransport } from '@/lib/api/types';
import { LocalFolderTransport } from './transports/local-folder.js';
import { CloudTransport } from './transports/cloud.js';

/**
 * Build and start the app sync engine. Autosync is always on: the engine is
 * initialized unconditionally so callers may forceSyncNow anytime without a
 * null engine; a cycle without a configured target is a no-op.
 */
export async function initAppSync() {
  const syncProgressStore = useSyncProgressStore();
  syncProgressStore.startListening();

  initSyncEngine({
    transports: {
      local: new LocalFolderTransport(),
      cloud: new CloudTransport(),
    },
    storage: useStorage(),
    getActiveTransports: () => {
      const transport = normalizeSyncTransport(getSettingSync('syncTransport'));
      if (transport === SYNC_TRANSPORT.FOLDER) return ['local'];
      return ['cloud'];
    },
  });

  const engine = getSyncEngine();

  // Nothing usable configured (no folder, no authenticated cloud account) —
  // stay inert: skip the initial pull and 30s timer; cycles trigger on demand
  // once a folder is chosen or cloud is enabled.
  const syncPath = await getSyncPath();
  const transport = normalizeSyncTransport(getSettingSync('syncTransport'));
  const wantsCloud = transport !== SYNC_TRANSPORT.FOLDER;
  const accountStore = useAccountStore();
  const hasSyncTarget =
    Boolean(syncPath) || (wantsCloud && accountStore.isAuthenticated);
  if (!hasSyncTarget) {
    return engine;
  }

  engine
    .forceSyncNow()
    .catch((err) => console.warn('[sync] initial sync failed:', err));

  engine.startPullTimer();

  return engine;
}
