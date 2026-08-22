import { test, expect, vi } from 'vitest';

// Mock the account store module used inside hocuspocus-sync
vi.mock('@/store/account', () => ({
  useAccountStore: () => ({ token: 'sess-tok', status: 'authenticated' }),
}));

const { getWebSocketUrl } = await import('@/lib/sync/hocuspocus-sync.js');

test('uses VITE_BEAVER_SYNC_WS_URL on root path with token', () => {
  import.meta.env.VITE_BEAVER_SYNC_WS_URL = 'ws://localhost:8080';
  import.meta.env.VITE_HOCUSPOCUS_URL = undefined;
  const url = getWebSocketUrl();
  expect(url.startsWith('ws://localhost:8080/')).toBe(true);
  expect(url).toContain('token=sess-tok');
  expect(url).not.toContain('/hocuspocus');
});
