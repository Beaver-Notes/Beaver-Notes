import { describe, expect, it } from 'vitest';
import { normalizeProfile } from '@/lib/api/types';

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
