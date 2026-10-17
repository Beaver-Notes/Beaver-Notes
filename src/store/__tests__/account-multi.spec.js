import { setActivePinia, createPinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// The account index and the per-account credential slots both sit on the native
// secure-blob store, so keep a stateful stand-in rather than a no-op stub.
const { blobs } = vi.hoisted(() => ({ blobs: new Map() }));

vi.mock('@/lib/native/security', () => ({
  isEncryptionAvailable: vi.fn(async () => true),
  encryptString: vi.fn(async (s) => `cipher:${s}`),
  decryptString: vi.fn(async (s) => String(s).replace(/^cipher:/, '')),
  storeSecureBlob: vi.fn(async (key, value) => {
    blobs.set(key, value);
  }),
  fetchSecureBlob: vi.fn(async (key) => blobs.get(key) ?? null),
  clearSecureBlob: vi.fn(async (key) => {
    blobs.delete(key);
  }),
}));

import { useAccountStore } from '@/store/account';
import { saveSessionToken } from '@/lib/account-storage';
import { clearIndex, saveIndex } from '@/lib/accounts-index';

beforeEach(async () => {
  setActivePinia(createPinia());
  localStorage.clear();
  blobs.clear();
  vi.clearAllMocks();
  await clearIndex();
});

describe('account store: several accounts at once', () => {
  it('two accounts keep their own plan and switch in the store', async () => {
    const store = useAccountStore();
    await store.hydrateAccounts();
    await store.persistActiveAccount({
      id: 'p1',
      email: 'me@test.test',
      organizations: [{ id: 'o1', subscription: { plan: 'pro' } }],
      activeOrgId: 'o1',
      subscription: { plan: 'pro' },
      planLimits: { historyDays: 30 },
    });
    await store.persistActiveAccount({
      id: 't1',
      email: 'team@test.test',
      organizations: [{ id: 'o2', subscription: { plan: 'team' } }],
      activeOrgId: 'o2',
      subscription: { plan: 'team' },
      planLimits: { historyDays: 90 },
    });
    await store.activateAccount('p1');
    expect(store.plan).toBe('pro');
    expect(store.isPaidPlan).toBe(true);
    await store.activateAccount('t1');
    expect(store.plan).toBe('team');
    expect(store.historyDays).toBe(90);
  });

  it('forgetting the active account keeps the other one usable', async () => {
    const store = useAccountStore();
    await store.hydrateAccounts();
    await store.persistActiveAccount({ id: 'p1', email: 'me@test.test' });
    await store.persistActiveAccount({ id: 't1', email: 'team@test.test' });
    await store.forgetAccount('t1');
    expect(store.accounts.map((a) => a.id)).toEqual(['p1']);
    expect(store.activeAccountId).toBe('p1');
  });

  it('hydrateAccounts restores the active account with its own token and plan', async () => {
    await saveSessionToken('session-p1', 'p1');
    await saveIndex({
      accounts: [
        {
          id: 'p1',
          email: 'me@test.test',
          subscription: { plan: 'pro' },
          planLimits: { historyDays: 30 },
        },
        { id: 't1', email: 'team@test.test', subscription: { plan: 'team' } },
      ],
      activeAccountId: 'p1',
    });

    const store = useAccountStore();
    await store.hydrateAccounts();

    expect(store.accounts.map((a) => a.id)).toEqual(['p1', 't1']);
    expect(store.activeAccountId).toBe('p1');
    expect(store.token).toBe('session-p1');
    expect(store.status).toBe('authenticated');
    expect(store.plan).toBe('pro');
    expect(store.historyDays).toBe(30);
  });

  it('never parks a leaving account token in the store', async () => {
    const store = useAccountStore();
    await store.persistActiveAccount({ id: 'p1', email: 'me@test.test' });

    // A refresh can land after the user switched away; the token belongs to the
    // account that made the call, not to whichever one is active by then.
    store.setToken('leaving-account-token', 't1');
    expect(store.token).toBeNull();

    store.setToken('p1-token');
    expect(store.token).toBe('p1-token');
  });

  it('ignores an account id the index does not know', async () => {
    const store = useAccountStore();
    await store.persistActiveAccount({ id: 'p1', email: 'me@test.test' });

    await store.activateAccount('nope');

    expect(store.activeAccountId).toBe('p1');
    expect(store.accounts.map((a) => a.id)).toEqual(['p1']);
  });
});
