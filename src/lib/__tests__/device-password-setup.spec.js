import { describe, expect, it, vi, beforeEach } from 'vitest';

const { promptMock, alertMock } = vi.hoisted(() => ({
  promptMock: vi.fn(),
  alertMock: vi.fn(),
}));

vi.mock('@/lib/native/security', () => ({
  getSafeStorageBackendInfo: vi.fn(),
  setDevicePassword: vi.fn(async () => {}),
}));

vi.mock('@/lib/dialog', () => ({
  useDialog: () => ({
    prompt: promptMock,
    alert: alertMock,
  }),
}));

vi.mock('@/lib/tauri/runtime', () => ({
  isDesktopRuntime: () => true,
}));

vi.mock('@/composable/useTranslations', () => ({
  useTranslations: () => ({ translations: { value: {} } }),
}));

import { useDevicePasswordSetup } from '@/lib/device-password-setup';
import {
  getSafeStorageBackendInfo,
  setDevicePassword,
} from '@/lib/native/security';

const DONE_KEY = 'devicePasswordSetupDone';

// Secure storage is silent. The app never asks the user to invent a device
// password: an OS keychain is used without UI, and when none exists the vault
// key is requested at launch by the encryption gate instead of being persisted.
describe('useDevicePasswordSetup', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
    getSafeStorageBackendInfo.mockResolvedValue({});
  });

  it('never prompts when a keychain is available (Rust stores the key silently)', async () => {
    getSafeStorageBackendInfo.mockResolvedValue({
      available: true,
      devicePasswordRequired: false,
    });

    const { maybePrompt } = useDevicePasswordSetup();
    await maybePrompt();

    expect(promptMock).not.toHaveBeenCalled();
    expect(setDevicePassword).not.toHaveBeenCalled();
    expect(localStorage.getItem(DONE_KEY)).toBeNull();
  });

  it('never prompts on a keychain-less box and persists nothing (vault key asked at launch)', async () => {
    getSafeStorageBackendInfo.mockResolvedValue({
      available: false,
      devicePasswordRequired: false,
    });

    const { maybePrompt } = useDevicePasswordSetup();
    await maybePrompt();

    expect(promptMock).not.toHaveBeenCalled();
    expect(alertMock).not.toHaveBeenCalled();
    expect(setDevicePassword).not.toHaveBeenCalled();
    expect(localStorage.getItem(DONE_KEY)).toBeNull();
  });

  it('never fires a re-entry prompt when the only key copy is the encrypted file', async () => {
    localStorage.setItem(DONE_KEY, '1');
    getSafeStorageBackendInfo.mockResolvedValue({
      available: false,
      devicePasswordRequired: true,
    });

    const { maybePrompt } = useDevicePasswordSetup();
    await maybePrompt();

    expect(promptMock).not.toHaveBeenCalled();
    expect(setDevicePassword).not.toHaveBeenCalled();
    expect(alertMock).not.toHaveBeenCalled();
  });
});
