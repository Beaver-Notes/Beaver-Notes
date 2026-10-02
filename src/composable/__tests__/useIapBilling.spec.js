import { describe, it, expect, vi } from 'vitest';

vi.mock('@/lib/tauri/runtime', () => ({
  isMobileRuntime: () => true,
  isIOSRuntime: () => false,
}));
vi.mock('@/composable/useAccountAuth', () => ({
  useAccountAuth: () => ({ refreshProfile: vi.fn(async () => null) }),
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
});
