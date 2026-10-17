import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';

const joinViaInviteLink = vi.fn();
vi.mock('@/lib/api/collaboration', () => ({
  joinViaInviteLink: (...args) => joinViaInviteLink(...args),
}));

const refreshSharedNotes = vi.fn();
vi.mock('@/composable/useSharedNotes', () => ({
  useSharedNotes: () => ({ refreshSharedNotes: () => refreshSharedNotes() }),
}));

const haptic = vi.fn();
vi.mock('@/lib/native/haptics', () => ({
  triggerInteractionHaptic: (...args) => haptic(...args),
}));

let authed = true;
vi.mock('@/store/account', () => ({
  useAccountStore: () => ({ serverUrl: 'https://api.test', isAuthenticated: authed }),
}));

const push = vi.fn();
vi.mock('vue-router', () => ({
  useRoute: () => ({ query: { join: 'tok-123' }, fullPath: '/?join=tok-123' }),
  useRouter: () => ({ push }),
}));

vi.mock('@/composable/useTranslations', () => ({
  useTranslations: () => ({ translations: { value: {} } }),
}));

import JoinInviteDialog from '../JoinInviteDialog.vue';

function mountDialog(token = 'tok-123') {
  return mount(JoinInviteDialog, {
    props: { show: true, token },
    global: {
      stubs: {
        'ui-modal': {
          template:
            '<div><slot name="header" /><slot name="actions" /><slot /></div>',
        },
        'ui-button': {
          props: ['loading', 'disabled'],
          emits: ['click'],
          template:
            '<button type="button" :disabled="loading || disabled" @click="$emit(\'click\')"><slot /></button>',
        },
        'v-remixicon': true,
      },
    },
  });
}

function clickButtonByText(wrapper, text) {
  const btn = wrapper.findAll('button').find((b) => b.text().includes(text));
  expect(btn, `button "${text}"`).toBeTruthy();
  return btn.trigger('click');
}

describe('JoinInviteDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authed = true;
  });

  it('invites an authenticated user and calls join with the account serverUrl', async () => {
    joinViaInviteLink.mockResolvedValue({ noteId: 'n1', role: 'editor' });
    const wrapper = mountDialog();

    await clickButtonByText(wrapper, 'Join Note');
    await flushPromises();

    expect(joinViaInviteLink).toHaveBeenCalledWith('tok-123', {
      baseUrl: 'https://api.test',
    });
    expect(haptic).toHaveBeenCalledWith('intro');
    expect(wrapper.text()).toContain('joined');
    expect(wrapper.text()).toContain('editor');
    expect(wrapper.findAll('button').some((b) => b.text().includes('Open Note'))).toBe(true);
  });

  it('never claims success on a pending (202) result and offers Check again', async () => {
    joinViaInviteLink.mockResolvedValue({ pending: true, noteId: 'n1', role: 'viewer' });
    const wrapper = mountDialog();

    await clickButtonByText(wrapper, 'Join Note');
    await flushPromises();

    expect(wrapper.text().toLowerCase()).toContain('awaiting approval');
    expect(wrapper.text()).not.toContain("You've joined");
    expect(wrapper.findAll('button').some((b) => b.text().includes('Open Note'))).toBe(false);
    expect(wrapper.findAll('button').some((b) => b.text().includes('Check again'))).toBe(true);
    expect(haptic).not.toHaveBeenCalled();
    expect(joinViaInviteLink).toHaveBeenCalledTimes(1);
  });

  it('reaches success through Check again after approval is granted', async () => {
    joinViaInviteLink
      .mockResolvedValueOnce({ pending: true, noteId: 'n1', role: 'viewer' })
      .mockResolvedValueOnce({ success: true, noteId: 'n1', role: 'editor' });
    const wrapper = mountDialog();

    await clickButtonByText(wrapper, 'Join Note');
    await flushPromises();
    expect(wrapper.text().toLowerCase()).toContain('awaiting approval');
    expect(haptic).not.toHaveBeenCalled();

    await clickButtonByText(wrapper, 'Check again');
    await flushPromises();

    expect(wrapper.text()).toContain("You've joined");
    expect(wrapper.text()).toContain('editor');
    expect(haptic).toHaveBeenCalledWith('intro');
  });

  it('updates the shared notes before routing to the note on Open Note', async () => {
    const order = [];
    refreshSharedNotes.mockImplementation(() => {
      order.push('refresh');
      return Promise.resolve();
    });
    push.mockImplementation(() => {
      order.push('push');
      return Promise.resolve();
    });
    joinViaInviteLink.mockResolvedValue({ noteId: 'n1', role: 'editor' });
    const wrapper = mountDialog();

    await clickButtonByText(wrapper, 'Join Note');
    await flushPromises();
    await clickButtonByText(wrapper, 'Open Note');
    await flushPromises();

    expect(refreshSharedNotes).toHaveBeenCalledTimes(1);
    expect(push).toHaveBeenCalledWith('/note/n1');
    expect(order).toEqual(['refresh', 'push']);
  });

  it('still routes to the note when refreshing shared notes fails', async () => {
    refreshSharedNotes.mockRejectedValue(new Error('sync down'));
    joinViaInviteLink.mockResolvedValue({ noteId: 'n1', role: 'editor' });
    const wrapper = mountDialog();

    await clickButtonByText(wrapper, 'Join Note');
    await flushPromises();
    await clickButtonByText(wrapper, 'Open Note');
    await flushPromises();

    expect(push).toHaveBeenCalledWith('/note/n1');
  });

  it('shows the server error inline when the join fails', async () => {
    joinViaInviteLink.mockRejectedValue({
      response: { data: { message: 'Link expired' } },
    });
    const wrapper = mountDialog();

    await clickButtonByText(wrapper, 'Join Note');
    await flushPromises();

    const alert = wrapper.find('[role="alert"]');
    expect(alert.exists()).toBe(true);
    expect(alert.text()).toContain('Link expired');
    expect(wrapper.text()).not.toContain("You've joined");
    expect(haptic).not.toHaveBeenCalled();
  });

  it('falls back to the default error copy when the server sends no message', async () => {
    joinViaInviteLink.mockRejectedValue(new Error('network'));
    const wrapper = mountDialog();

    await clickButtonByText(wrapper, 'Join Note');
    await flushPromises();

    expect(wrapper.find('[role="alert"]').text()).toContain(
      'Failed to join. The link may be invalid or expired.'
    );
    expect(push).not.toHaveBeenCalled();
  });

  it('offers a Go to home escape hatch on error that closes the dialog', async () => {
    joinViaInviteLink.mockRejectedValue({ response: { data: { message: 'Link expired' } } });
    const wrapper = mountDialog();

    await clickButtonByText(wrapper, 'Join Note');
    await flushPromises();
    await clickButtonByText(wrapper, 'Go to home');

    expect(wrapper.emitted('close')).toBeTruthy();
  });

  it('offers sign in with a returnTo carrying the token when signed out', async () => {
    authed = false;
    const wrapper = mountDialog();

    expect(wrapper.text()).toContain('Sign in to accept');
    expect(wrapper.findAll('button').some((b) => b.text().includes('Join Note'))).toBe(false);

    await clickButtonByText(wrapper, 'Sign in to accept');

    expect(push).toHaveBeenCalledWith({
      name: 'Settings-Account',
      query: { returnTo: '/?join=tok-123' },
    });
    expect(joinViaInviteLink).not.toHaveBeenCalled();
  });

  it('resets the state machine when reopened with a new token', async () => {
    joinViaInviteLink
      .mockResolvedValueOnce({ noteId: 'n1', role: 'editor' })
      .mockResolvedValueOnce({ noteId: 'n2', role: 'viewer' });
    const wrapper = mountDialog();

    await clickButtonByText(wrapper, 'Join Note');
    await flushPromises();
    expect(wrapper.text()).toContain("You've joined");

    await wrapper.setProps({ show: false });
    await wrapper.setProps({ show: true, token: 'tok-9' });

    expect(wrapper.text()).not.toContain("You've joined");
    expect(wrapper.text()).toContain('invited to collaborate');
  });
});
