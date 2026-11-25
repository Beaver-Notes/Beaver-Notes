import { test, expect, vi, beforeEach } from 'vitest';

// Mutable store stub so each case controls the user-entered server URL.
const storeStub = { token: 'sess-tok', status: 'authenticated', serverUrl: undefined };

// Mock the account store module used inside ws-sync
vi.mock('@/store/account', () => ({
  useAccountStore: () => storeStub,
}));

const { getWebSocketUrl, plaintextRelayAllowed } = await import('@/lib/sync/ws-sync.js');

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

// SC-1-07 / ISSUE-2: the loopback carve-out is an exact-host check. A DNS name
// that merely STARTS with `127.` (`127.0.0.1.evil.com`) is not loopback.
describe('plaintextRelayAllowed loopback validation', () => {
  test('exact loopback IPv4 quad is allowed', () => {
    expect(plaintextRelayAllowed('ws://127.0.0.1:8080')).toBe(true);
    expect(plaintextRelayAllowed('ws://127.8.16.32:8080')).toBe(true);
  });

  test('loopback names and IPv6 literals are allowed', () => {
    expect(plaintextRelayAllowed('ws://localhost:8080')).toBe(true);
    expect(plaintextRelayAllowed('ws://[::1]:8080')).toBe(true);
  });

  test('a lookalike DNS name with a 127. prefix is refused', () => {
    expect(plaintextRelayAllowed('ws://127.0.0.1.evil.com:8080')).toBe(false);
  });

  test('malformed quads and unparsable URLs are refused (fail closed)', () => {
    // Invalid IPv4 makes the URL parser throw; an unparsable relay URL is
    // never a verified loopback, so it is refused.
    expect(plaintextRelayAllowed('ws://127.0.0.256:8080')).toBe(false);
    expect(plaintextRelayAllowed('ws://127.0.0.0.1:8080')).toBe(false);
    expect(plaintextRelayAllowed('not a url')).toBe(false);
  });

  test('the URL parser canonicalizes short IPv4 forms into real quads', () => {
    // ws://127.0.0 normalizes to 127.0.0.0, ws://127.0.0.0x1 to 127.0.0.1 —
    // genuine loopback addresses, allowed after canonicalization.
    expect(plaintextRelayAllowed('ws://127.0.0:8080')).toBe(true);
    expect(plaintextRelayAllowed('ws://127.0.0.0x1:8080')).toBe(true);
  });

  test('non-loopback hosts are refused, encrypted transports always allowed', () => {
    expect(plaintextRelayAllowed('ws://192.168.1.236:8080')).toBe(false);
    expect(plaintextRelayAllowed('ws://sync.example.com')).toBe(false);
    expect(plaintextRelayAllowed('wss://sync.example.com')).toBe(true);
  });
});
