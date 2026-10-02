import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ref } from 'vue';

const h = vi.hoisted(() => ({
  confirm: [],
  revokeDevice: null,
  revokeActiveSession: null,
  listSessions: null,
}));

vi.mock('@/store/account', () => ({
  useAccountStore: () => ({
    isAuthenticated: false,
    serverUrl: 'https://api.test',
    plan: 'free',
    profile: null,
    setError: vi.fn(),
    setProfile: vi.fn(),
  }),
}));

vi.mock('@/lib/api/types', () => ({
  PLAN_NAMES: { TEAM: 'team', ENTERPRISE: 'enterprise' },
}));

vi.mock('@/lib/settings', () => ({ setSetting: vi.fn(async () => {}) }));

vi.mock('@/lib/api/account', () => ({
  updateUsername: vi.fn(async () => {}),
  getAccountExport: vi.fn(async () => ({})),
}));

vi.mock('@/utils/notes/local-note-count.js', () => ({ localNoteCount: () => 0 }));

vi.mock('@/composable/useAccountAuth', () => ({
  useAccountAuth: () => {
    h.revokeDevice = vi.fn(async () => {});
    h.revokeActiveSession = vi.fn(async () => {});
    h.listSessions = vi.fn(async () => []);
    return {
      revokeDevice: h.revokeDevice,
      revokeActiveSession: h.revokeActiveSession,
      listActiveSessions: h.listSessions,
      refreshProfile: vi.fn(async () => {}),
      triggerSeed: vi.fn(),
      signOut: vi.fn(),
      signOutEverywhere: vi.fn(),
      deleteAccount: vi.fn(),
    };
  },
}));

import { useSettingsAccount } from '../useSettingsAccount.js';

function makeDialog() {
  return {
    confirm: (opts) => h.confirm.push(opts),
    alert: vi.fn(),
    prompt: vi.fn(),
  };
}

describe('useSettingsAccount revoke confirmations', () => {
  beforeEach(() => {
    h.confirm.length = 0;
  });

  it('confirms a device revoke and labels it with the device name', async () => {
    const account = useSettingsAccount({
      dialog: makeDialog(),
      translations: ref({ account: {}, dialog: { cancel: 'Cancel' } }),
    });

    account.handleRevokeDevice({ deviceId: 'dev-1', label: 'Work MacBook' });

    expect(h.confirm).toHaveLength(1);
    expect(h.confirm[0].title).toContain('Work MacBook');
    expect(h.revokeDevice).not.toHaveBeenCalled();

    await h.confirm[0].onConfirm();
    expect(h.revokeDevice).toHaveBeenCalledWith('dev-1');
  });

  it('confirms a session revoke and labels it with the device name', async () => {
    const account = useSettingsAccount({
      dialog: makeDialog(),
      translations: ref({ account: {}, dialog: { cancel: 'Cancel' } }),
    });

    account.revokeSession({ id: 'sess-1', deviceInfo: { label: 'iPhone' } });

    expect(h.confirm).toHaveLength(1);
    expect(h.confirm[0].title).toContain('iPhone');
    expect(h.revokeActiveSession).not.toHaveBeenCalled();

    await h.confirm[0].onConfirm();
    expect(h.revokeActiveSession).toHaveBeenCalledWith('sess-1');
    expect(h.listSessions).toHaveBeenCalled();
  });
});
