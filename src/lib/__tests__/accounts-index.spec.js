import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('@/lib/native/security', () => ({
  isEncryptionAvailable: vi.fn(async () => true),
  encryptString: vi.fn(async (s) => `cipher:${s}`),
  decryptString: vi.fn(async (s) => s.replace(/^cipher:/, '')),
  storeSecureBlob: vi.fn(async () => {}),
  fetchSecureBlob: vi.fn(async () => null),
  clearSecureBlob: vi.fn(async () => {}),
}));

import {
  loadIndex,
  saveIndex,
  listAccounts,
  getAccount,
  upsertAccount,
  removeAccountRecord,
  getActiveAccountId,
  setActiveAccountId,
  clearIndex,
} from '@/lib/accounts-index';

describe('accounts index', () => {
  beforeEach(async () => {
    localStorage.clear();
    await clearIndex();
  });

  it('starts empty and never throws', async () => {
    const index = await loadIndex();
    expect(index).toEqual({ accounts: [], activeAccountId: null });
    expect(listAccounts()).toEqual([]);
    expect(getActiveAccountId()).toBeNull();
  });

  it('stores two accounts and keeps the active id', async () => {
    await upsertAccount({ id: 'a1', email: 'a@test.test' });
    await upsertAccount({ id: 'a2', email: 'b@test.test' });
    setActiveAccountId('a2');
    expect(listAccounts().map((a) => a.id)).toEqual(['a1', 'a2']);
    expect(getActiveAccountId()).toBe('a2');
    expect(getAccount('a1').email).toBe('a@test.test');
  });

  it('removing the active account falls back to the first remaining one', async () => {
    await upsertAccount({ id: 'a1', email: 'a@test.test' });
    await upsertAccount({ id: 'a2', email: 'b@test.test' });
    setActiveAccountId('a2');
    await removeAccountRecord('a2');
    expect(listAccounts().map((a) => a.id)).toEqual(['a1']);
    expect(getActiveAccountId()).toBe('a1');
  });

  it('removing the only account leaves no active id', async () => {
    await upsertAccount({ id: 'a1', email: 'a@test.test' });
    setActiveAccountId('a1');
    await removeAccountRecord('a1');
    expect(getActiveAccountId()).toBeNull();
  });

  it('persists the index as ciphertext, never plaintext', async () => {
    await upsertAccount({
      id: 'a1',
      email: 'me@test.test',
      workspaces: [{ id: 'w1', name: 'Acme Team' }],
    });
    const stored = localStorage.getItem('accountsIndex');
    expect(stored).toBeTruthy();
    expect(stored).not.toContain('me@test.test');
    expect(stored).not.toContain('Acme Team');
  });

  it('loads back from storage what was saved', async () => {
    await saveIndex({
      accounts: [{ id: 'p1', email: 'me@test.test' }],
      activeAccountId: 'p1',
    });
    const reloaded = await loadIndex();
    expect(reloaded.accounts.map((a) => a.id)).toEqual(['p1']);
    expect(reloaded.activeAccountId).toBe('p1');
  });
});
