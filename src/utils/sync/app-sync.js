import { initSyncEngine, getSyncEngine } from './engine.js';
import { useStorage } from '@/composable/storage';
import { getSettingSync } from '@/composable/settings';
import { useAccountStore } from '@/store/account';
import { SYNC_TRANSPORT } from '@/lib/api/types';
import { LocalFolderTransport } from './transports/local-folder.js';
import { CloudTransport } from './transports/cloud.js';

function passphraseProvider() {
  return import('@/utils/crypto/safeStorageBlob.js').then((m) =>
    m.loadSecureBlob('encryptionPassphraseBlob')
  ).catch(() => null);
}

/**
 * Build and start the app sync engine. Autosync is always on: the engine is
 * initialized unconditionally so callers (Settings "Sync now", transport
 * changes) may forceSyncNow at any time without hitting a null engine, and
 * the initial pull plus periodic sync always run. Without a configured sync
 * folder a sync cycle is a no-op.
 */
export function initAppSync() {
  initSyncEngine({
    transports: {
      local: new LocalFolderTransport({ passphraseProvider }),
      cloud: new CloudTransport({
        passphraseProvider,
        getTransportSetting: () => getSettingSync('syncTransport'),
        getAccountState: () => {
          const accountStore = useAccountStore();
          return {
            isAuth: accountStore.isAuthenticated,
            plan: accountStore.subscription?.plan,
          };
        },
      }),
    },
    storage: useStorage(),
    getActiveTransports: () => {
      const transport = getSettingSync('syncTransport') || SYNC_TRANSPORT.FOLDER;
      if (transport === SYNC_TRANSPORT.FOLDER) return ['local'];
      if (transport === SYNC_TRANSPORT.REMOTE) return ['cloud'];
      return ['local', 'cloud'];
    },
  });

  getSyncEngine()
    .forceSyncNow()
    .catch((err) => console.warn('[sync] initial sync failed:', err));
  getSyncEngine().setPeriodicSyncEnabled(true);

  return getSyncEngine();
}
