import { beforeEach, describe, expect, it, vi } from 'vitest';

const { blobs } = vi.hoisted(() => ({ blobs: new Map() }));

vi.mock('@/lib/native/security', () => ({
  isEncryptionAvailable: vi.fn(async () => true),
  encryptString: vi.fn(async (s) => `cipher:${s}`),
  decryptString: vi.fn(async (s) => s.replace(/^cipher:/, '')),
  storeSecureBlob: vi.fn(async (key, value) => {
    blobs.set(key, value);
  }),
  fetchSecureBlob: vi.fn(async (key) => blobs.get(key) ?? null),
  clearSecureBlob: vi.fn(async (key) => {
    blobs.delete(key);
  }),
}));

import { migrateSingleAccountToIndex } from '@/lib/accounts-migrate';
import { clearIndex, getActiveAccountId, listAccounts } from '@/lib/accounts-index';
import {
  loadRefreshToken,
  loadSessionToken,
  saveCachedProfile,
  saveRefreshToken,
  saveSessionToken,
} from '@/lib/account-storage';
import { fetchSecureBlob, storeSecureBlob } from '@/lib/native/security';

describe('migrateSingleAccountToIndex', () => {
  beforeEach(async () => {
    localStorage.clear();
    blobs.clear();
    vi.clearAllMocks();
    await clearIndex();
  });

  it('adopts a single-account install as accounts[0]', async () => {
    await saveSessionToken('legacy-token');
    await saveRefreshToken('legacy-refresh');
    await saveCachedProfile({ id: 'u1', email: 'me@test.test' });
    await storeSecureBlob('e2eIdentityKeypair', 'keypair-json');

    const result = await migrateSingleAccountToIndex();

    expect(result.migrated).toBe(true);
    expect(result.accountId).toBe('u1');
    expect(getActiveAccountId()).toBe('u1');
    expect(await loadSessionToken('u1')).toBe('legacy-token');
    expect(await loadRefreshToken('u1')).toBe('legacy-refresh');
    expect(listAccounts()[0]).toMatchObject({ id: 'u1', email: 'me@test.test' });
    // The identity must follow the account, or the device key no longer matches
    // the keypair the server has on file for it (see identity.js).
    expect(await fetchSecureBlob('e2eIdentityKeypair:u1')).toBe('keypair-json');
  });

  it('is idempotent and leaves the legacy slots alone', async () => {
    await saveSessionToken('legacy-token');
    await saveRefreshToken('legacy-refresh');
    await saveCachedProfile({ id: 'u1', email: 'me@test.test' });

    const first = await migrateSingleAccountToIndex();
    const second = await migrateSingleAccountToIndex();

    expect(first.migrated).toBe(true);
    expect(second).toEqual({ migrated: false, accountId: 'u1' });
    expect(listAccounts()).toHaveLength(1);
    // Copy, never move: a downgrade to a build that only knows the legacy keys
    // must still find the session.
    expect(await fetchSecureBlob('beaverAccountSession')).toBeTruthy();
    expect(await fetchSecureBlob('accountRefreshTokenBlob')).toBeTruthy();
  });

  it('does nothing on a fresh install', async () => {
    const result = await migrateSingleAccountToIndex();

    expect(result).toEqual({ migrated: false, accountId: null });
    expect(listAccounts()).toEqual([]);
    expect(getActiveAccountId()).toBeNull();
  });
});
