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

  async function maybePrompt() {
    if (!isDesktopRuntime()) return;
    const done = localStorage.getItem(DONE_KEY);
    if (done) return;
    let info = null;
    try {
      info = await getSafeStorageBackendInfo();
    } catch {
      return;
    }
    if (!info || info.available) return;
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

  return { setupState, maybePrompt };
}
