import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ref } from 'vue';
import { mount, flushPromises } from '@vue/test-utils';

const ctl = vi.hoisted(() => ({
  confirm: vi.fn(),
  alert: vi.fn(),
  switchTo: vi.fn(async () => {}),
}));

vi.mock('@/lib/dialog', () => ({
  useDialog: () => ({ confirm: ctl.confirm, alert: ctl.alert }),
}));

vi.mock('vue-router', () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock('@/store/account', () => ({
  useAccountStore: () => ({
    isAuthenticated: true,
    isPaidPlan: true,
    serverUrl: 'https://api.test',
  }),
}));

vi.mock('@/store/workspace', () => ({
  useWorkspaceStore: () => ({
    workspaces: [
      { id: 'ws1', name: 'Alpha', role: 'owner' },
      { id: 'ws2', name: 'Beta', role: 'owner' },
    ],
    activeId: 'ws1',
    activeWorkspace: { id: 'ws1', name: 'Alpha' },
    retrieve: vi.fn(async () => {}),
    switchTo: ctl.switchTo,
    create: vi.fn(),
    rename: vi.fn(),
  }),
}));

vi.mock('@/composable/useCloudWorkspaces', () => ({
  useCloudWorkspaces: () => ({
    pendingRequests: ref([]),
    fetchMyPendingRequests: vi.fn(async () => []),
    joinWorkspace: vi.fn(),
  }),
}));

vi.mock('@/lib/api/plans', () => ({
  getPlans: vi.fn(async () => ({ flags: {} })),
}));

import WorkspaceSwitcher from '../WorkspaceSwitcher.vue';

const reload = vi.fn();

function mountSwitcher() {
  return mount(WorkspaceSwitcher, {
    global: {
      stubs: {
        'ui-popover': true,
        'ui-button': true,
        'ui-input': true,
        'v-remixicon': true,
        WorkspaceFormDialog: true,
      },
    },
  });
}

describe('workspace switching', () => {
  beforeEach(() => {
    ctl.confirm.mockReset();
    ctl.switchTo.mockClear();
    reload.mockReset();
    vi.stubGlobal('location', { ...window.location, reload });
  });

  it('warns before the reload and never clears global settings', async () => {
    const removeItem = vi.spyOn(Storage.prototype, 'removeItem');
    const w = mountSwitcher();
    await flushPromises();

    await w.vm.switchWorkspace('ws2');

    // Nothing happens until the user accepts the warning.
    expect(ctl.confirm).toHaveBeenCalledTimes(1);
    expect(ctl.switchTo).not.toHaveBeenCalled();
    const opts = ctl.confirm.mock.calls[0][0];
    expect(opts.title).toMatch(/Switch workspace/i);
    expect(opts.body).toMatch(/reload/i);

    await opts.onConfirm();
    expect(ctl.switchTo).toHaveBeenCalledWith('ws2');
    expect(reload).toHaveBeenCalledTimes(1);
    expect(removeItem).not.toHaveBeenCalled();
    removeItem.mockRestore();
  });
});
