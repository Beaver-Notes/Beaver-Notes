import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount } from '@vue/test-utils';
import { setActivePinia, createPinia } from 'pinia';

vi.mock('@/composable/useNoteSharing', () => ({
  useNoteSharing: () => ({
    collaborators: { value: [] },
    loading: { value: false },
    error: { value: '' },
    invite: vi.fn(),
    remove: vi.fn(),
    fetchCollaborators: vi.fn(),
    inviteLinks: { value: [] },
    linkLoading: { value: false },
    fetchLinks: vi.fn(),
    generateLink: vi.fn(),
    revokeLink: vi.fn(),
  }),
}));

let mockIsAuthenticated = true;
vi.mock('@/store/account', () => ({
  useAccountStore: () => ({ isAuthenticated: mockIsAuthenticated }),
}));

let mockIsMobile = true;
vi.mock('@/lib/tauri-bridge', () => ({
  backend: { isMobileRuntime: () => mockIsMobile },
}));

import ShareModal from '../ShareModal.vue';

describe('ShareModal', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    mockIsAuthenticated = true;
    mockIsMobile = true;
  });

  const mountModal = (shareActions = []) =>
    mount(ShareModal, {
      props: { modelValue: true, noteId: 'n1', shareActions },
      global: {
        stubs: {
          'ui-modal': { template: '<div><slot name="header" /><slot name="actions" /><slot /></div>' },
          'ui-input': true,
          'ui-select': true,
          'ui-button': { template: '<button type="button"><slot /></button>' },
          'ui-list': true,
          'ui-list-item': true,
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
});
