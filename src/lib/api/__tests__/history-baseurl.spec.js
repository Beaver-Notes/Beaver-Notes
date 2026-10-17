import { describe, test, expect, vi, beforeEach } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';

vi.mock('@/utils/sync/sync-repository', () => ({
  getSyncDeviceId: () => 'test-device-001',
}));

vi.mock('@/utils/sync/crypto.js', () => ({
  encryptJSON: async () => 'sealed-items-key-envelope',
}));

vi.mock('@/lib/account-storage', () => ({
  loadSessionToken: () => 'secret-bearer-token',
  clearSessionToken: vi.fn(),
}));

import { useAccountStore } from '@/store/account';
import { resetApiClient } from '@/lib/api/client';
import { listCommits, getCommitSnapshot, createCommit } from '@/lib/api/history';

const CONFIGURED = 'https://sync.example.com';
const VENDOR_DEFAULT = 'https://api.beavernotes.com';

function stubFetch(body) {
  const calls = [];
  vi.stubGlobal('fetch', async (url, init) => {
    calls.push({ url, headers: init.headers });
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  });
  return calls;
}

describe('history API targets the configured sync server', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    resetApiClient();
    vi.unstubAllGlobals();
    // The snapshot path warns when it cannot open the envelope; the URL is the
    // subject here, not the decryption.
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  test('listCommits never sends the bearer token to the vendor default origin', async () => {
    useAccountStore().serverUrl = CONFIGURED;
    const calls = stubFetch({ commits: [] });

    await listCommits('n1');

    expect(calls).toHaveLength(1);
    expect(new URL(calls[0].url).origin).toBe(CONFIGURED);
    expect(calls[0].headers.Authorization).toBe('Bearer secret-bearer-token');
    expect(calls[0].url.startsWith(VENDOR_DEFAULT)).toBe(false);
  });

  test('getCommitSnapshot never sends the bearer token to the vendor default origin', async () => {
    useAccountStore().serverUrl = CONFIGURED;
    const calls = stubFetch({ data: 'v5-envelope' });

    await getCommitSnapshot('commit-1');

    expect(calls).toHaveLength(1);
    expect(new URL(calls[0].url).origin).toBe(CONFIGURED);
    expect(calls[0].headers.Authorization).toBe('Bearer secret-bearer-token');
    expect(calls[0].url.startsWith(VENDOR_DEFAULT)).toBe(false);
  });

  test('createCommit never sends the bearer token to the vendor default origin', async () => {
    useAccountStore().serverUrl = CONFIGURED;
    const calls = stubFetch({ commitId: 'commit-1' });

    await createCommit('n1', { content: '<p>hi</p>', title: 'Note' });

    expect(calls).toHaveLength(1);
    expect(new URL(calls[0].url).origin).toBe(CONFIGURED);
    expect(calls[0].headers.Authorization).toBe('Bearer secret-bearer-token');
    expect(calls[0].url.startsWith(VENDOR_DEFAULT)).toBe(false);
  });
});
