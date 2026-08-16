import { ref } from 'vue';
import { useDialog } from '@/lib/dialog';
import { getSafeStorageBackendInfo, setDevicePassword } from '@/lib/native/security';
import { useTranslations } from '@/composable/useTranslations';
import { isDesktopRuntime } from '@/lib/tauri/runtime';

const DONE_KEY = 'devicePasswordSetupDone';

export function useDevicePasswordSetup() {
  const dialog = useDialog();
  const { translations } = useTranslations();
  const setupState = ref('idle');

  function promptCreate() {
    setupState.value = 'prompting';
    dialog.prompt({
      title:
        translations.value.devicePassword?.secureLocalStorageTitle ||
        'Secure local storage',
      body:
        translations.value.devicePassword?.secureLocalStorageBody ||
        'Beaver Notes could not find an OS keychain. To keep your account data and passphrase safe on this device, create a device password that encrypts the on-disk key. You will only need it if the system keyring becomes unavailable.',
      icon: 'riShieldKeyholeLine',
      password: true,
      okText:
        translations.value.devicePassword?.createDevicePassword ||
        'Create password',
      cancelText:
        translations.value.devicePassword?.skip || 'Skip',
      onConfirm: async (password) => {
        if (!password) return;
        try {
          await setDevicePassword(password);
          localStorage.setItem(DONE_KEY, '1');
          setupState.value = 'done';
        } catch (err) {
          dialog.alert({
            title:
              translations.value.devicePassword?.setFailedTitle ||
              'Could not set device password',
            body: err?.message || String(err),
            okText: translations.value.dialog?.close || 'Close',
          });
          setupState.value = 'error';
        }
      },
      onCancel: () => {
        setupState.value = 'skipped';
      },
    });
  }

  function promptReentry() {
    setupState.value = 'prompting';
    dialog.prompt({
      title:
        translations.value.devicePassword?.reentryTitle ||
        'Enter your device password',
      body:
        translations.value.devicePassword?.reentryBody ||
        'Secure storage on this device is encrypted with a device password. Enter it to unlock your account data.',
      icon: 'riShieldKeyholeLine',
      password: true,
      okText:
        translations.value.devicePassword?.unlockDevicePassword ||
        'Unlock',
      cancelText:
        translations.value.devicePassword?.skip || 'Skip',
      onConfirm: async (password) => {
        if (!password) return;
        try {
          await setDevicePassword(password);
          localStorage.removeItem(DONE_KEY);
          setupState.value = 'done';
        } catch (err) {
          dialog.alert({
            title:
              translations.value.devicePassword?.setFailedTitle ||
              'Could not set device password',
            body: err?.message || String(err),
            okText: translations.value.dialog?.close || 'Close',
          });
          setupState.value = 'error';
        }
      },
      onCancel: () => {
        setupState.value = 'skipped';
      },
    });
  }

  async function maybePrompt() {
    if (!isDesktopRuntime()) return;
    let info = null;
    try {
      info = await getSafeStorageBackendInfo();
    } catch {
      return;
    }
    if (!info) return;

    // Re-entry: `master.key.enc` exists but the KEK has not been supplied this
    // session (e.g. after a reboot on a daemon-less box). This MUST ignore
    // DONE_KEY, otherwise there is no path to unlock secure storage again.
    if (info.devicePasswordRequired) {
      promptReentry();
      return;
    }

    // Create: no enc file yet and no keychain reachable. Gated on DONE_KEY so
    // the one-time setup prompt is not shown again once created or skipped.
    if (info.available) return;
    const done = localStorage.getItem(DONE_KEY);
    if (done) return;
    promptCreate();
  }

  return { setupState, maybePrompt };
}