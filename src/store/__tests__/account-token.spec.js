import { setActivePinia, createPinia } from 'pinia';
import { beforeEach, test, expect } from 'vitest';
import { useAccountStore } from '@/store/account';

beforeEach(() => setActivePinia(createPinia()));

test('setToken stores the session token', () => {
  const store = useAccountStore();
  store.setToken('tok-abc');
  expect(store.token).toBe('tok-abc');
});

test('isAuthenticated getter reflects token presence via status', () => {
  const store = useAccountStore();
  store.setStatus('authenticated');
  store.setToken('tok-abc');
  expect(store.isAuthenticated).toBe(true);
  store.setToken(null);
  expect(store.isAuthenticated).toBe(false);
});
