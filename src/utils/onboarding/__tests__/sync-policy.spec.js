import { describe, expect, it } from 'vitest';
import {
  getOnboardingSyncTransport,
  shouldUseCloudSyncByDefault,
} from '../sync-policy.js';

describe('onboarding sync policy', () => {
  it('uses remote sync for an authenticated paid account', () => {
    expect(shouldUseCloudSyncByDefault({ isAuthenticated: true, isPaidPlan: true })).toBe(true);
    expect(getOnboardingSyncTransport({ isAuthenticated: true, isPaidPlan: true })).toBe('remote');
  });

  it('keeps folder sync as the default for anonymous or free users', () => {
    expect(getOnboardingSyncTransport({ isAuthenticated: false, isPaidPlan: true })).toBe('folder');
    expect(getOnboardingSyncTransport({ isAuthenticated: true, isPaidPlan: false })).toBe('folder');
  });
});
