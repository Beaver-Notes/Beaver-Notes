import { describe, expect, it } from 'vitest';
import { normalizeSubscription, normalizeAccountResponse, canUseCloudSync, isPaidPlan, PLAN_NAMES } from '@/lib/api/types';

describe('Task 04.2 fail-closed subscription default', () => {
  it('missing shape -> free/inactive locked', () => {
    expect(normalizeSubscription({})).toMatchObject({ plan: 'free', status: 'inactive' });
    expect(canUseCloudSync(normalizeSubscription({}))).toBe(false);
  });
  it('undefined/null/error shapes -> null locked', () => {
    expect(normalizeSubscription(undefined)).toBeNull();
    expect(normalizeSubscription(null)).toBeNull();
    expect(canUseCloudSync(null)).toBe(false);
    expect(canUseCloudSync(undefined)).toBe(false);
    expect(isPaidPlan(undefined)).toBe(false);
  });
  it('normalizeAccountResponse missing subscription locked', () => {
    const r = normalizeAccountResponse({ user: { id: 'u1' }, subscription: undefined });
    expect(r.subscription).toBeNull();
    expect(canUseCloudSync(r.subscription)).toBe(false);
  });
});
