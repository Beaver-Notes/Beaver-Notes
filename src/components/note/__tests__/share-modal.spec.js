import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { setActivePinia, createPinia } from 'pinia';

const state = vi.hoisted(() => ({
  collaborators: [],
  inviteLinks: [],
  inviteImpl: () => Promise.resolve({ userId: 'u9' }),
  removeImpl: () => Promise.resolve(),
  revokeImpl: () => Promise.resolve(),
  inviteCalls: [],
  removeCalls: [],
  revokeCalls: [],
  confirm: [],
  errorRef: null,
}));

vi.mock('@/lib/dialog', () => ({
  useDialog: () => ({
    confirm: (opts) => { state.confirm.push(opts); },
    alert: vi.fn(),
    prompt: vi.fn(),
  }),
}));

vi.mock('@/composable/useNoteSharing', async () => {
  const { ref } = await import('vue');
  const errorRef = ref('');
  state.errorRef = errorRef;
  return {
    useNoteSharing: () => ({
      collaborators: ref(state.collaborators),
      loading: ref(false),
      error: errorRef,
      invite: (...a) => { state.inviteCalls.push(a); return state.inviteImpl(...a); },
      remove: (...a) => { state.removeCalls.push(a); return state.removeImpl(...a); },
      fetchCollaborators: vi.fn(),
      inviteLinks: ref(state.inviteLinks),
      linkLoading: ref(false),
      fetchLinks: vi.fn(),
      generateLink: vi.fn(),
      revokeLink: (...a) => { state.revokeCalls.push(a); return state.revokeImpl(...a); },
      joinRequests: ref([]),
      fetchJoinRequests: vi.fn(),
      approveJoinRequest: vi.fn(),
      denyJoinRequest: vi.fn(),
    }),
  };
});

let mockIsAuthenticated = true;
let mockProfile = null;
vi.mock('@/store/account', () => ({
  useAccountStore: () => ({ isAuthenticated: mockIsAuthenticated, profile: mockProfile }),
}));

let mockIsMobile = true;
vi.mock('@/lib/tauri-bridge', () => ({
  backend: { isMobileRuntime: () => mockIsMobile },
}));

vi.mock('@/store/workspace', () => ({
  useWorkspaceStore: () => ({ activeId: 'ws-1' }),
}));

import ShareModal from '../ShareModal.vue';

describe('ShareModal', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    mockIsAuthenticated = true;
    mockIsMobile = true;
    mockProfile = null;
    state.collaborators = [];
    state.inviteLinks = [];
    state.inviteImpl = () => Promise.resolve({ userId: 'u9' });
    state.removeImpl = () => Promise.resolve();
    state.revokeImpl = () => Promise.resolve();
    state.inviteCalls.length = 0;
    state.removeCalls.length = 0;
    state.revokeCalls.length = 0;
    state.confirm.length = 0;
    if (state.errorRef) state.errorRef.value = '';
  });

  const mountModal = (shareActions = []) =>
    mount(ShareModal, {
      props: { modelValue: true, noteId: 'n1', shareActions },
      global: {
        stubs: {
          'ui-modal': { template: '<div><slot name="header" /><slot name="actions" /><slot /></div>' },
          'ui-input': true,
          'ui-select': true,
          'ui-button': {
            props: ['disabled'],
            template: '<button type="button" :disabled="disabled"><slot /></button>',
          },
          'ui-list': { template: '<div><slot /></div>' },
          'ui-list-item': { template: '<div><slot /></div>' },
          'ui-user-avatar': true,
          'ui-spinner': true,
          'v-remixicon': true,
        },
      },
    });

  it('renders a Done footer action (close path without the X)', () => {
    const wrapper = mountModal();
    expect(wrapper.text()).toContain('Done');
  });

  it('renders export tiles when shareActions provided', () => {
    const wrapper = mountModal([
      { name: 'bea', title: 'BEA', icon: 'riFileTextFill', handler: vi.fn() },
      { name: 'pdf', title: 'PDF', icon: 'riFile2Line', handler: vi.fn() },
    ]);
    expect(wrapper.text()).toContain('Export');
    expect(wrapper.text()).toContain('BEA');
    expect(wrapper.text()).toContain('PDF');
  });

  it('hides collaborate section and export grid when signed out', () => {
    mockIsAuthenticated = false;
    const wrapper = mountModal([
      { name: 'bea', title: 'BEA', icon: 'riFileTextFill', handler: vi.fn() },
    ]);
    expect(wrapper.text()).not.toContain('Invite');
    expect(wrapper.text()).toContain('Export');
  });

  it('omits export grid on desktop', () => {
    mockIsMobile = false;
    const wrapper = mountModal([
      { name: 'bea', title: 'BEA', icon: 'riFileTextFill', handler: vi.fn() },
    ]);
    expect(wrapper.text()).not.toContain('Export');
    expect(wrapper.text()).toContain('Collaborate');
  });

  it('keeps the invite-link action enabled when the account email is unverified', () => {
    mockProfile = { emailVerified: false };
    const wrapper = mountModal();
    const createLink = wrapper
      .findAll('button')
      .find((b) => b.text().includes('Create invite link'));
    expect(createLink).toBeTruthy();
    expect(createLink.attributes('disabled')).toBeUndefined();
  });

  it('confirms before removing a collaborator and names them', async () => {
    const collab = { userId: 'u2', username: 'alice', email: 'alice@example.com', role: 'editor' };
    state.collaborators = [collab];
    const wrapper = mountModal();
    await flushPromises();

    wrapper.vm.handleRemove(collab);

    expect(state.confirm).toHaveLength(1);
    expect(state.confirm[0].title).toContain('alice');
    expect(state.confirm[0].body).toMatch(/lose access|future/i);
    expect(state.removeCalls).toHaveLength(0);

    await state.confirm[0].onConfirm();
    expect(state.removeCalls).toHaveLength(1);
    expect(state.removeCalls[0]).toEqual(['n1', 'u2']);
  });

  it('confirms before revoking an invite link, then awaits and surfaces failure', async () => {
    state.inviteLinks = [{ id: 'l1', token: 'tok1', role: 'editor', expiresAt: null }];
    state.revokeImpl = () => Promise.reject(new Error('network down'));
    const wrapper = mountModal();
    await flushPromises();

    wrapper.vm.handleRevokeLink(state.inviteLinks[0]);
    expect(state.confirm).toHaveLength(1);
    expect(state.revokeCalls).toHaveLength(0);

    await state.confirm[0].onConfirm();
    await flushPromises();

    expect(state.revokeCalls).toEqual([['n1', 'l1']]);
    expect(wrapper.text()).toContain('network down');
  });

  it('invites with the active workspace id and shows no error on success', async () => {
    const wrapper = mountModal();
    wrapper.vm.inviteInput = 'tester@example.com';
    await wrapper.vm.handleInvite();
    await flushPromises();

    expect(state.inviteCalls).toHaveLength(1);
    expect(state.inviteCalls[0]).toEqual([
      'n1',
      'tester@example.com',
      'editor',
      { workspaceId: 'ws-1' },
    ]);
    expect(wrapper.text()).not.toContain('Only a member of the workspace');
  });

  it('humanizes a collaborator role instead of rendering the raw id', async () => {
    state.collaborators = [
      { userId: 'u2', username: 'alice', email: 'alice@example.com', role: 'editor' },
    ];
    const wrapper = mountModal();
    await flushPromises();
    expect(wrapper.text()).toContain('Editor');
    expect(wrapper.text()).not.toContain('editor');
  });

  it('surfaces alreadyInvited as a friendly no-op message', async () => {
    state.inviteImpl = () => Promise.resolve({ alreadyInvited: true });
    const wrapper = mountModal();
    wrapper.vm.inviteInput = 'tester@example.com';
    await wrapper.vm.handleInvite();
    await flushPromises();
    expect(wrapper.text()).toContain('Already a collaborator');
  });

  it('shows actionable workspace copy for an unconfirmed note, never the raw server string', async () => {
    const raw = 'Only the owner of the workspace that owns this note can claim it.';
    const friendly =
      "We couldn't confirm which workspace this note belongs to. Open Settings → Sync, then try again.";
    state.inviteImpl = () => {
      if (state.errorRef) state.errorRef.value = friendly;
      return Promise.reject(new Error(raw));
    };
    const wrapper = mountModal();
    wrapper.vm.inviteInput = 'tester@example.com';
    await wrapper.vm.handleInvite();
    await flushPromises();

    expect(wrapper.text()).toContain(friendly);
    expect(wrapper.text()).not.toContain(raw);
  });
});
