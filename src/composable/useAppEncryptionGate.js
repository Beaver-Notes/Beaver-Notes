import { reactive } from 'vue';
import { useRoute } from 'vue-router';
import {
  tryRestoreKeyFromSafeStorage,
  encryptionIsConfigured,
  isKeyLoaded,
} from '@/utils/crypto/encryption.js';
import { getSyncPath } from '@/utils/sync/path';

const ONBOARDING_ROUTE_NAME = 'Onboarding';

/**
 * Full-screen encryption gate: owns whether the lock screen is shown, tries to
 * auto-restore the key on startup, and runs the deferred workspace init once
 * the user unlocks.
 */
export function useAppEncryptionGate({ finishWorkspaceInit, onUnlockError }) {
  const route = useRoute();
  const appEncryptionGate = reactive({ show: false, deriving: false });

  const restoreEncryptionKeys = async () => {
    await getSyncPath();
    appEncryptionGate.deriving = true;
    try {
      await tryRestoreKeyFromSafeStorage();
    } finally {
      appEncryptionGate.deriving = false;
    }
    await refreshEncryptionGate();
  };

  const refreshEncryptionGate = async (configuredOverride) => {
    if (route.name === ONBOARDING_ROUTE_NAME) {
      appEncryptionGate.show = false;
      return;
    }
    const configured =
      configuredOverride !== undefined
        ? configuredOverride
        : await encryptionIsConfigured();
    appEncryptionGate.show = configured && !isKeyLoaded();
  };

  // Runs when the user unlocks the app via the encryption gate. The gate is
  // only reachable when a configured vault could not be auto-unlocked, so this
  // is the deferred remainder of initializeWorkspace().
  const handleEncryptionUnlocked = () => {
    appEncryptionGate.show = false;
    finishWorkspaceInit().catch((err) => {
      console.error('[app] workspace init after unlock failed:', err);
      onUnlockError?.();
    });
  };

  return {
    appEncryptionGate,
    restoreEncryptionKeys,
    handleEncryptionUnlocked,
  };
}
