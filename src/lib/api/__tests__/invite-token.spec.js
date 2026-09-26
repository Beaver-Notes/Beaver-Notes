import { describe, it, expect } from 'vitest';
import { normalizeInviteToken } from '../collaboration';

describe('normalizeInviteToken', () => {
  it('passes a bare token through unchanged', () => {
    expect(normalizeInviteToken('abc123')).toBe('abc123');
    expect(normalizeInviteToken('  abc123  ')).toBe('abc123');
  });

  it('extracts the token from a beaver-notes:// join link', () => {
    expect(normalizeInviteToken('beaver-notes://join/abc123')).toBe('abc123');
    expect(normalizeInviteToken('beaver-notes://join/abc123?utm=x#frag')).toBe('abc123');
  });

  it('extracts the token from an https join link', () => {
    expect(normalizeInviteToken('https://app.beavernotes.com/join/abc123')).toBe('abc123');
  });

  it('returns empty for blank or tokenless input', () => {
    expect(normalizeInviteToken('')).toBe('');
    expect(normalizeInviteToken('   ')).toBe('');
    expect(normalizeInviteToken('beaver-notes://join/')).toBe('');
  });
});
