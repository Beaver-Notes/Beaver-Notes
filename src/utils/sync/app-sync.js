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
 * Build and start the app sync engine. The engine itself is always
 * initialized — callers (Settings "Sync now", autoSync toggles) may
 * forceSyncNow at any time and must not hit a null engine. Only the
 * initial pull and periodic sync are gated behind autoSync.
 */
export function initAppSync({ autoSync = false } = {}) {
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
      return ['local', 'cloud'];
    },
  });

  if (autoSync) {
    getSyncEngine()
      .forceSyncNow()
      .catch((err) => console.warn('[sync] initial sync failed:', err));
    getSyncEngine().setPeriodicSyncEnabled(true);
  }

  return getSyncEngine();
}
