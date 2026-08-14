import { describe, it, expect, vi, beforeEach } from 'vitest';

const notif = vi.hoisted(() => ({
  isPermissionGranted: vi.fn(),
  requestPermission: vi.fn(),
  sendNotification: vi.fn(),
}));

vi.mock('@tauri-apps/plugin-notification', () => notif);

let notify;

describe('notify()', () => {
  beforeEach(async () => {
    notif.isPermissionGranted.mockReset();
    notif.requestPermission.mockReset();
    notif.sendNotification.mockReset();
    // notify() caches the permission decision in module state, so each test
    // needs a fresh module to exercise the permission flow independently.
    vi.resetModules();
    ({ notify } = await import('../app.js'));
  });

  it('requests permission once when not granted, then sends', async () => {
    notif.isPermissionGranted.mockResolvedValue(false);
    notif.requestPermission.mockResolvedValue('granted');
    const ok = await notify({ title: 'Sync', body: 'Synced' });
    expect(notif.requestPermission).toHaveBeenCalledTimes(1);
    expect(notif.sendNotification).toHaveBeenCalledWith({ title: 'Sync', body: 'Synced' });
    expect(ok).toBe(true);
  });

  it('does not send when permission is denied', async () => {
    notif.isPermissionGranted.mockResolvedValue(false);
    notif.requestPermission.mockResolvedValue('denied');
    const ok = await notify({ title: 'X', body: 'Y' });
    expect(notif.sendNotification).not.toHaveBeenCalled();
    expect(ok).toBe(false);
  });
});
