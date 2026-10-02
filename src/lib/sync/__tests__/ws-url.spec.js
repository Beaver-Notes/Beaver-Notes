import { test, expect, vi, beforeEach } from 'vitest';

// Mutable store stub so each case controls the user-entered server URL.
const storeStub = { token: 'sess-tok', status: 'authenticated', serverUrl: undefined };

// Mock the account store module used inside ws-sync
vi.mock('@/store/account', () => ({
  useAccountStore: () => storeStub,
}));

const { getWebSocketUrl } = await import('@/lib/sync/ws-sync.js');

beforeEach(() => {
  storeStub.serverUrl = undefined;
  import.meta.env.VITE_BEAVER_SYNC_API_URL = 'http://localhost:4000';
  import.meta.env.VITE_BEAVER_SYNC_WS_URL = 'ws://localhost:8080';
  import.meta.env.VITE_HOCUSPOCUS_URL = undefined;
});

test('getWebSocketUrl returns base URL without token (token passed via params)', () => {
  const url = getWebSocketUrl();
  expect(url).toBe('ws://localhost:8080');
  expect(url).not.toContain('token');
});

test('stock dev server keeps the explicit WS override', () => {
  storeStub.serverUrl = 'http://localhost:4000';
  expect(getWebSocketUrl()).toBe('ws://localhost:8080');
});

test('custom https server derives wss on the same origin', () => {
  storeStub.serverUrl = 'https://sync.example.com';
  expect(getWebSocketUrl()).toBe('wss://sync.example.com');
});

test('custom http server on dev API port maps to the relay port', () => {
  storeStub.serverUrl = 'http://192.168.1.236:4000';
  expect(getWebSocketUrl()).toBe('ws://192.168.1.236:8080');
});

test('custom server wins even when a WS env override is set', () => {
  storeStub.serverUrl = 'https://sync.example.com';
  import.meta.env.VITE_BEAVER_SYNC_WS_URL = 'ws://localhost:8080';
  expect(getWebSocketUrl()).toBe('wss://sync.example.com');
});
