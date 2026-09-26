import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';

const ctl = vi.hoisted(() => ({
  addComment: vi.fn(),
  toggleResolve: vi.fn(),
  removeComment: vi.fn(),
}));

vi.mock('@/store/comment', () => ({
  useCommentStore: () => ({
    loading: false,
    unavailable: false,
    activeThreadId: null,
    unresolvedThreads: [],
    resolvedThreads: [],
    addComment: ctl.addComment,
    toggleResolve: ctl.toggleResolve,
    removeComment: ctl.removeComment,
    fetchThreads: vi.fn(),
  }),
}));

vi.mock('@/store/account', () => ({
  useAccountStore: () => ({
    profile: { id: 'u1', username: 'me' },
    serverUrl: 'https://api.test',
  }),
}));

vi.mock('@/composable/useTranslations', () => ({
  useTranslations: () => ({ translations: { value: {} } }),
}));

import CommentSidebar from '../CommentSidebar.vue';

function mountSidebar() {
  return mount(CommentSidebar, {
    props: { noteId: 'n1' },
    global: { stubs: { 'v-remixicon': true } },
  });
}

describe('CommentSidebar action failures stay visible', () => {
  beforeEach(() => {
    ctl.addComment.mockReset();
    ctl.toggleResolve.mockReset();
    ctl.removeComment.mockReset();
  });

  it('shows the failure inline when adding a comment fails', async () => {
    ctl.addComment.mockRejectedValue(new Error('offline'));
    const wrapper = mountSidebar();
    wrapper.vm.newComment = 'hello';
    await wrapper.vm.submitComment();
    await flushPromises();

    const alert = wrapper.find('[data-testid="comment-action-error"]');
    expect(alert.exists()).toBe(true);
    expect(alert.text()).toContain('offline');
  });

  it('clears the previous error on a later successful action', async () => {
    ctl.addComment.mockRejectedValueOnce(new Error('offline'));
    const wrapper = mountSidebar();
    wrapper.vm.newComment = 'hello';
    await wrapper.vm.submitComment();
    await flushPromises();
    expect(wrapper.find('[data-testid="comment-action-error"]').exists()).toBe(true);

    ctl.addComment.mockResolvedValueOnce(undefined);
    wrapper.vm.newComment = 'again';
    await wrapper.vm.submitComment();
    await flushPromises();
    expect(wrapper.find('[data-testid="comment-action-error"]').exists()).toBe(false);
  });
});
