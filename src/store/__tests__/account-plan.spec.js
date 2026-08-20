import { setActivePinia, createPinia } from 'pinia';
import { beforeEach, test, expect } from 'vitest';
import { useAccountStore } from '@/store/account';

beforeEach(() => setActivePinia(createPinia()));

test('canUseCloudSync true for paid org plan', () => {
  const store = useAccountStore();
  store.setStatus('authenticated');
  store.setToken('tok');
  store.addAccount({
    id: 'a1',
    organizations: [
      { id: 'o1', subscription: { plan: 'team' }, workspaces: [{ id: 'w1' }] },
    ],
  });
  store.switchOrg('o1');
  expect(store.isPaidPlan).toBe(true);
  expect(store.canUseCloudSync).toBe(true);
});
