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

import ShareModal from '../ShareModal.vue';

describe('ShareModal', () => {
  beforeEach(() => setActivePinia(createPinia()));

  it('renders a Done footer action (close path without the X)', () => {
    const wrapper = mount(ShareModal, {
      props: { modelValue: true, noteId: 'n1' },
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
    expect(wrapper.text()).toContain('Done');
  });
});
