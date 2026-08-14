import { describe, expect, it } from 'vitest';
import {
  normalizeProfile,
  normalizeSyncTransport,
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
