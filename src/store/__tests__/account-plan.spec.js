import { setActivePinia, createPinia } from 'pinia';
import { beforeEach, test, expect } from 'vitest';
import { useAccountStore } from '@/store/account';

beforeEach(() => setActivePinia(createPinia()));

test('canUseCloudSync true for paid org plan', () => {
  const store = useAccountStore();
  store.setStatus('authenticated');
  store.setToken('tok');
  store.accounts = [{
    id: 'a1',
    organizations: [
      { id: 'o1', subscription: { plan: 'team' }, workspaces: [{ id: 'w1' }] },
    ],
  }];
  store.activeAccountId = 'a1';
  store.activeOrgId = 'o1';
  expect(store.isPaidPlan).toBe(true);
  expect(store.canUseCloudSync).toBe(true);
});

test('fail-closed when subscription missing/undefined/error', () => {
  const store = useAccountStore();
  store.setStatus('authenticated');
  store.setToken('tok');
  store.accounts = [{ id: 'a1', organizations: [] }];
  store.activeAccountId = 'a1';
  store.subscription = null;
  expect(store.plan).toBe('free');
  expect(store.isPaidPlan).toBe(false);
  expect(store.canUseCloudSync).toBe(false);
  store.subscription = undefined;
  expect(store.isPaidPlan).toBe(false);
});

test('fail-closed shows locked UI when API unreachable (no subscription)', () => {
  const store = useAccountStore();
  // Simulates failed profile fetch: status stays anonymous or subscription null
  store.setStatus('authenticated');
  store.setToken('tok');
  store.accounts = [{ id: 'a1', organizations: [{ id: 'o1', subscription: null, workspaces: [] }] }];
  store.activeAccountId = 'a1';
  store.activeOrgId = 'o1';
  expect(store.isPaidPlan).toBe(false);
  expect(store.canUseCloudSync).toBe(false);
  // unauthenticated also locked
  store.setStatus('anonymous');
  expect(store.canUseCloudSync).toBe(false);
});
