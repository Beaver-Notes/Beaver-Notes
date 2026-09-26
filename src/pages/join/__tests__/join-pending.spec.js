import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';

const joinViaInviteLink = vi.fn();
vi.mock('@/lib/api/collaboration', () => ({
  joinViaInviteLink: (...args) => joinViaInviteLink(...args),
}));

let authed = true;
vi.mock('@/store/account', () => ({
  useAccountStore: () => ({ serverUrl: 'https://api.test', isAuthenticated: authed }),
}));

const push = vi.fn();
vi.mock('vue-router', () => ({
  useRoute: () => ({ params: { token: 'tok-123' }, fullPath: '/join/tok-123' }),
  useRouter: () => ({ push }),
}));

import JoinPage from '../[token].vue';

function mountPage() {
  return mount(JoinPage, { global: { mocks: { $router: { push } } } });
}

function clickButtonByText(wrapper, text) {
  const btn = wrapper.findAll('button').find((b) => b.text().includes(text));
  expect(btn, `button "${text}"`).toBeTruthy();
  return btn.trigger('click');
}

describe('join page approval states', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authed = true;
  });

  it('shows awaiting approval instead of success when the server returns pending', async () => {
    joinViaInviteLink.mockResolvedValue({ pending: true, noteId: 'n1', role: 'viewer' });
    const wrapper = mountPage();
    await clickButtonByText(wrapper, 'Join Note');
    await flushPromises();

    expect(wrapper.text().toLowerCase()).toContain('awaiting approval');
    expect(wrapper.text()).not.toContain("You've joined");
    expect(wrapper.findAll('button').some((b) => b.text().includes('Open Note'))).toBe(false);
    expect(wrapper.findAll('button').some((b) => b.text().includes('Check again'))).toBe(true);
  });

  it('turns into success after approval is granted and the user refreshes', async () => {
    joinViaInviteLink.mockResolvedValueOnce({ pending: true, noteId: 'n1', role: 'viewer' });
    const wrapper = mountPage();
    await clickButtonByText(wrapper, 'Join Note');
    await flushPromises();
    expect(wrapper.text().toLowerCase()).toContain('awaiting approval');

    joinViaInviteLink.mockResolvedValueOnce({ success: true, noteId: 'n1', role: 'viewer' });
    await clickButtonByText(wrapper, 'Check again');
    await flushPromises();
    expect(wrapper.text()).toContain("You've joined");
    expect(wrapper.findAll('button').some((b) => b.text().includes('Open Note'))).toBe(true);
  });

  it('offers sign in with a return to the token when signed out', async () => {
    authed = false;
    const wrapper = mountPage();
    expect(wrapper.text()).toContain('Sign in to accept');
    expect(wrapper.findAll('button').some((b) => b.text().includes('Join Note'))).toBe(false);

    await clickButtonByText(wrapper, 'Sign in to accept');
    expect(push).toHaveBeenCalledWith({
      name: 'Settings-Account',
      query: { returnTo: '/join/tok-123' },
    });
    expect(joinViaInviteLink).not.toHaveBeenCalled();
  });
});
