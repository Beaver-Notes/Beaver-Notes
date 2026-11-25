import { describe, it, expect, vi } from 'vitest';

const ctl = vi.hoisted(() => ({ refreshProfile: async () => null }));

vi.mock('@/lib/tauri/runtime', () => ({
  isMobileRuntime: () => true,
  isIOSRuntime: () => false,
}));
vi.mock('@/composable/useAccountAuth', () => ({
  useAccountAuth: () => ({ refreshProfile: (...a) => ctl.refreshProfile(...a) }),
}));
vi.mock('@choochmeque/tauri-plugin-iap-api', () => ({
  purchase: vi.fn(async () => ({ purchaseToken: 'tok' })),
  acknowledgePurchase: vi.fn(async () => {}),
}));

import { IAP_PRODUCT_IDS, planFromProductId, MOBILE_PLANS, useIapBilling } from '../useIapBilling.js';

describe('IAP product map', () => {
  it('maps the four store IDs', () => {
    expect(IAP_PRODUCT_IDS['starter-monthly']).toBe('com.beavernotes.starter.monthly');
    expect(IAP_PRODUCT_IDS['pro-yearly']).toBe('com.beavernotes.pro.yearly');
  });
  it('reverse-maps product id to plan+interval', () => {
    expect(planFromProductId('com.beavernotes.pro.monthly')).toEqual({ plan: 'pro', interval: 'monthly' });
    expect(planFromProductId('unknown')).toBeNull();
  });
  it('excludes team on mobile', () => {
    expect(MOBILE_PLANS.every((p) => p.plan !== 'team')).toBe(true);
    expect(MOBILE_PLANS).toHaveLength(4);
  });
  it('requires sign-in before purchase', async () => {
    const billing = useIapBilling({ accountStore: {} });
    await expect(billing.buy('starter', 'monthly')).rejects.toThrow('Sign in required before purchase');
  });

  it('gives up after 60s of unprovisioned purchase and reports null', async () => {
    // Finding 24: the provision poll must time out (20 tries x 3s) instead of
    // waiting forever when the backend never flips the plan.
    vi.useFakeTimers();
    try {
      const refreshProfile = vi.fn(async () => null);
      ctl.refreshProfile = refreshProfile;
      const billing = useIapBilling({ accountStore: { profile: { id: 'u1' } } });
      const pending = billing.buy('pro', 'monthly');
      // Let the purchase chain reach the polling loop.
      await vi.advanceTimersByTimeAsync(0);
      await vi.advanceTimersByTimeAsync(60_000);
      await expect(pending).resolves.toBeNull();
      expect(refreshProfile).toHaveBeenCalledTimes(20);
    } finally {
      vi.useRealTimers();
    }
  });
});
