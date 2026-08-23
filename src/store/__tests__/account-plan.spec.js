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
