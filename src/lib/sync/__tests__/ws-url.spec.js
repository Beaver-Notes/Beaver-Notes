import { test, expect, vi } from 'vitest';

// Mock the account store module used inside ws-sync
vi.mock('@/store/account', () => ({
  useAccountStore: () => ({ token: 'sess-tok', status: 'authenticated' }),
}));

const { getWebSocketUrl } = await import('@/lib/sync/ws-sync.js');

test('getWebSocketUrl returns base URL without token (token passed via params)', () => {
  import.meta.env.VITE_BEAVER_SYNC_WS_URL = 'ws://localhost:8080';
  import.meta.env.VITE_HOCUSPOCUS_URL = undefined;
  const url = getWebSocketUrl();
  expect(url).toBe('ws://localhost:8080');
  expect(url).not.toContain('token');
});
