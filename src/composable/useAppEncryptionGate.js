import { reactive } from 'vue';
import { useRoute } from 'vue-router';
import {
  tryRestoreKeyFromSafeStorage,
  encryptionIsConfigured,
  isKeyLoaded,
} from '@/utils/crypto/encryption.js';
import { getSyncPath } from '@/utils/sync/path';
import {
  isBiometricAvailable,
  authenticateWithBiometrics,
} from '@/lib/native/biometric.js';

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
      const first = await tryRestoreKeyFromSafeStorage();
      console.log('[gate] first restore:', first, 'isKeyLoaded:', isKeyLoaded());
      if (!isKeyLoaded()) {
        const configured = await encryptionIsConfigured().catch(() => false);
        console.log('[gate] encryptionIsConfigured:', configured);
        if (!configured) {
          console.log('[gate] skipping auto biometric — encryption not configured');
        } else {
          let biometricAvailable = false;
          try {
            biometricAvailable = await isBiometricAvailable();
          } catch (e) {
            console.warn('[gate] isBiometricAvailable error:', e);
          }
          console.log('[gate] biometricAvailable:', biometricAvailable);
          if (biometricAvailable) {
          try {
            console.log('[gate] auto-triggering biometrics...');
            // ponytail: 8s ceiling — FaceID prompt can hang on iOS if dismissed, must not block startup forever
            const timeout = (ms) =>
              new Promise((_, rej) => setTimeout(() => rej(new Error('biometric timeout')), ms));
            await Promise.race([
              authenticateWithBiometrics('Unlock Beaver Notes'),
              timeout(8000),
            ]);
            console.log('[gate] biometrics success, retrying restore');
            await tryRestoreKeyFromSafeStorage();
            console.log('[gate] second restore isKeyLoaded:', isKeyLoaded());
          } catch (e) {
            const msg = String(e?.message || e || '');
            const isCancel = /cancel/i.test(msg) || /userCancel/i.test(msg) || /timeout/i.test(msg);
            console.log('[gate] auto biometric failed/cancelled:', msg);
            if (!isCancel) console.warn('[gate] auto biometric failed:', e);
          }
        } else {
          console.log('[gate] skipping auto biometric — not available');
        }
        }
      }
    } finally {
      appEncryptionGate.deriving = false;
    }
    await refreshEncryptionGate();
    console.log('[gate] refresh done show:', appEncryptionGate.show, 'deriving:', appEncryptionGate.deriving);
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
    refreshEncryptionGate,
    handleEncryptionUnlocked,
  };
}
