import { describe, expect, it } from 'vitest';
import {
  normalizeProfile,
  normalizeSubscription,
  normalizeAccountResponse,
  normalizeSyncTransport,
  canUseCloudSync,
  isPaidPlan,
  PLAN_NAMES,
  SYNC_TRANSPORT,
} from '@/lib/api/types';

describe('normalizeProfile', () => {
  it('preserves kemPublicKey when present in the source payload', () => {
    const profile = normalizeProfile({
      id: 'u_123',
      username: 'daniel',
      emailHash: 'hash',
      email: 'daniel@example.com',
      createdAt: '2026-01-01T00:00:00Z',
      kemPublicKey: 'abc',
    });
    expect(profile.kemPublicKey).toBe('abc');
  });

  it('defaults kemPublicKey to null when absent', () => {
    const profile = normalizeProfile({ id: 'u_123' });
    expect(profile.kemPublicKey).toBeNull();
  });
});

describe('normalizeSyncTransport', () => {
  it('keeps folder and remote as-is', () => {
    expect(normalizeSyncTransport(SYNC_TRANSPORT.FOLDER)).toBe(SYNC_TRANSPORT.FOLDER);
    expect(normalizeSyncTransport(SYNC_TRANSPORT.REMOTE)).toBe(SYNC_TRANSPORT.REMOTE);
  });

  it('maps the removed "both" option to remote for legacy installs', () => {
    expect(normalizeSyncTransport('both')).toBe(SYNC_TRANSPORT.REMOTE);
  });

  it('falls back to folder for unknown or empty values', () => {
    expect(normalizeSyncTransport(null)).toBe(SYNC_TRANSPORT.FOLDER);
    expect(normalizeSyncTransport('')).toBe(SYNC_TRANSPORT.FOLDER);
    expect(normalizeSyncTransport('nonsense')).toBe(SYNC_TRANSPORT.FOLDER);
    expect(normalizeSyncTransport(undefined)).toBe(SYNC_TRANSPORT.FOLDER);
  });

  it('the BOTH constant is gone from the enum', () => {
    expect(SYNC_TRANSPORT).not.toHaveProperty('BOTH');
  });
});

describe('normalizeSubscription fail-closed', () => {
  it('defaults missing/empty object to free/inactive', () => {
    expect(normalizeSubscription({})).toMatchObject({ plan: PLAN_NAMES.FREE, status: 'inactive' });
    expect(normalizeSubscription({ plan: '', status: '' })).toMatchObject({ plan: PLAN_NAMES.FREE, status: 'inactive' });
  });

  it('returns null for non-object shapes (undefined/null/error)', () => {
    expect(normalizeSubscription(null)).toBeNull();
    expect(normalizeSubscription(undefined)).toBeNull();
    expect(normalizeSubscription('error')).toBeNull();
    expect(normalizeSubscription(42)).toBeNull();
  });

  it('preserves explicit paid plan but defaults missing status to inactive', () => {
    expect(normalizeSubscription({ plan: 'pro' })).toMatchObject({ plan: 'pro', status: 'inactive' });
    expect(normalizeSubscription({ plan: 'team', status: 'active' })).toMatchObject({ plan: 'team', status: 'active' });
  });

  it('canUseCloudSync false for missing/error/undefined shapes', () => {
    expect(canUseCloudSync(null)).toBe(false);
    expect(canUseCloudSync(undefined)).toBe(false);
    expect(canUseCloudSync(normalizeSubscription({}))).toBe(false);
    expect(canUseCloudSync(normalizeSubscription(null))).toBe(false);
    expect(canUseCloudSync({ plan: 'free', status: 'inactive' })).toBe(false);
    expect(isPaidPlan('free')).toBe(false);
    expect(isPaidPlan(undefined)).toBe(false);
    expect(isPaidPlan(null)).toBe(false);
  });

  it('canUseCloudSync true only for paid plan', () => {
    expect(canUseCloudSync({ plan: 'pro', status: 'active' })).toBe(true);
    expect(canUseCloudSync({ plan: 'team', status: 'active' })).toBe(true);
  });

  it('normalizeAccountResponse with missing subscription is fail-closed', () => {
    const res = normalizeAccountResponse({ user: { id: 'u1' }, subscription: undefined, devices: [] });
    expect(res.subscription).toBeNull();
    expect(canUseCloudSync(res.subscription)).toBe(false);
    const res2 = normalizeAccountResponse({ user: { id: 'u1' }, subscription: {}, devices: [] });
    expect(res2.subscription.plan).toBe(PLAN_NAMES.FREE);
    expect(canUseCloudSync(res2.subscription)).toBe(false);
  });
});
