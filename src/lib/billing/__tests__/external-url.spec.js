import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const ctl = vi.hoisted(() => ({ openUrl: vi.fn() }));

vi.mock('@tauri-apps/plugin-opener', () => ({
  openUrl: (...args) => ctl.openUrl(...args),
}));

import { BILLING_HOSTS, isAllowedBillingUrl, openBillingUrl } from '../external-url.js';

const SERVER = 'https://api.test';

describe('isAllowedBillingUrl', () => {
  it('rejects non-https schemes and malformed urls', () => {
    expect(isAllowedBillingUrl('http://checkout.stripe.com/session', SERVER)).toBe(false);
    expect(isAllowedBillingUrl('javascript:alert(1)', SERVER)).toBe(false);
    expect(isAllowedBillingUrl('data:text/html,x', SERVER)).toBe(false);
    expect(isAllowedBillingUrl('not a url', SERVER)).toBe(false);
  });

  it('rejects an https host that is neither billing nor the sync server', () => {
    expect(isAllowedBillingUrl('https://evil.example.com/portal', SERVER)).toBe(false);
    expect(isAllowedBillingUrl('https://api.test-x.example.com/x', SERVER)).toBe(false);
  });

  it('allows the billing hosts and the sync server hostname', () => {
    expect([...BILLING_HOSTS].sort()).toEqual([
      'billing.stripe.com',
      'checkout.stripe.com',
      'js.stripe.com',
    ]);
    for (const host of BILLING_HOSTS) {
      expect(isAllowedBillingUrl(`https://${host}/x`, SERVER)).toBe(true);
    }
    expect(isAllowedBillingUrl('https://api.test/billing/portal', SERVER)).toBe(true);
  });
});

describe('openBillingUrl', () => {
  let windowOpen;

  beforeEach(() => {
    ctl.openUrl.mockReset();
    windowOpen = vi.spyOn(window, 'open').mockImplementation(() => null);
  });

  afterEach(() => {
    windowOpen.mockRestore();
  });

  it('refuses to open a rejected url', async () => {
    await expect(openBillingUrl('http://checkout.stripe.com/session', SERVER)).resolves.toBe(false);
    expect(ctl.openUrl).not.toHaveBeenCalled();
    expect(window.open).not.toHaveBeenCalled();
  });

  it('opens an allowed url through the tauri opener', async () => {
    await expect(openBillingUrl('https://checkout.stripe.com/session', SERVER)).resolves.toBe(true);
    expect(ctl.openUrl).toHaveBeenCalledWith('https://checkout.stripe.com/session');
    expect(window.open).not.toHaveBeenCalled();
  });

  it('falls back to window.open when the tauri opener is unavailable', async () => {
    ctl.openUrl.mockRejectedValueOnce(new Error('no tauri'));
    await expect(openBillingUrl('https://billing.stripe.com/portal', SERVER)).resolves.toBe(true);
    expect(window.open).toHaveBeenCalledWith(
      'https://billing.stripe.com/portal',
      '_blank',
      'noopener,noreferrer'
    );
  });
});