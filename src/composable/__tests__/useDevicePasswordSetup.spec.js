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

import { useDevicePasswordSetup } from '@/composable/useDevicePasswordSetup';
import {
  getSafeStorageBackendInfo,
  setDevicePassword,
} from '@/lib/native/security';

const DONE_KEY = 'devicePasswordSetupDone';

describe('useDevicePasswordSetup', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
    getSafeStorageBackendInfo.mockResolvedValue({});
  });

  function lastPrompt() {
    return promptMock.mock.calls[0][0];
  }

  it('does NOT prompt when a durable store is available, regardless of DONE_KEY', async () => {
    getSafeStorageBackendInfo.mockResolvedValue({
      available: true,
      devicePasswordRequired: false,
    });

    const { maybePrompt } = useDevicePasswordSetup();
    await maybePrompt();
    expect(promptMock).not.toHaveBeenCalled();

    localStorage.setItem(DONE_KEY, '1');
    await maybePrompt();
    expect(promptMock).not.toHaveBeenCalled();
  });

  it('fires the RE-ENTRY prompt when devicePasswordRequired, even with DONE_KEY set, and re-supplies the password on confirm', async () => {
    localStorage.setItem(DONE_KEY, '1');
    getSafeStorageBackendInfo.mockResolvedValue({
      available: false,
      devicePasswordRequired: true,
    });

    const { maybePrompt, setupState } = useDevicePasswordSetup();
    await maybePrompt();

    expect(promptMock).toHaveBeenCalledTimes(1);
    const opts = lastPrompt();
    expect(opts.title).toBe('Enter your device password');
    expect(opts.body).toBe('Enter your device password to unlock secure storage.');

    await opts.onConfirm('secret');
    expect(setDevicePassword).toHaveBeenCalledWith('secret');
    expect(localStorage.getItem(DONE_KEY)).toBeNull();
    expect(setupState.value).toBe('done');
  });

  it('fires the CREATE prompt on a fresh daemon-less box (available=false, not password-gated, no DONE_KEY), then sets the password and DONE_KEY on confirm', async () => {
    getSafeStorageBackendInfo.mockResolvedValue({
      available: false,
      devicePasswordRequired: false,
    });

    const { maybePrompt, setupState } = useDevicePasswordSetup();
    await maybePrompt();

    expect(promptMock).toHaveBeenCalledTimes(1);
    const opts = lastPrompt();
    expect(opts.title).toBe('Secure local storage');
    expect(opts.body).toContain('create a device password');

    await opts.onConfirm('secret');
    expect(setDevicePassword).toHaveBeenCalledWith('secret');
    expect(localStorage.getItem(DONE_KEY)).toBe('1');
    expect(setupState.value).toBe('done');
  });

  it('shows an alert and enters error state when creating the device password fails', async () => {
    getSafeStorageBackendInfo.mockResolvedValue({
      available: false,
      devicePasswordRequired: false,
    });
    setDevicePassword.mockRejectedValueOnce(new Error('boom'));

    const { maybePrompt, setupState } = useDevicePasswordSetup();
    await maybePrompt();
    await lastPrompt().onConfirm('secret');

    expect(alertMock).toHaveBeenCalledTimes(1);
    expect(alertMock.mock.calls[0][0]).toMatchObject({ title: 'Could not set device password' });
    expect(localStorage.getItem(DONE_KEY)).toBeNull();
    expect(setupState.value).toBe('error');
  });

  it('does NOT prompt when available=false, not password-gated, but DONE_KEY is already set', async () => {
    localStorage.setItem(DONE_KEY, '1');
    getSafeStorageBackendInfo.mockResolvedValue({
      available: false,
      devicePasswordRequired: false,
    });

    const { maybePrompt } = useDevicePasswordSetup();
    await maybePrompt();
    expect(promptMock).not.toHaveBeenCalled();
  });
});
