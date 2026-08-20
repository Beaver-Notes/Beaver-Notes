import { describe, it, expect } from 'vitest';
import { applyNoteKeyResult } from '@/composable/useNoteYjs';
import { computeIsDistributingKeys } from '@/composable/useAppShell';

// These tests target the pure derivation helpers that `load()` (useNoteYjs)
// and the app-shell banner use. They encode the same logic the UI binds to
// without needing the lifecycle-bound composable instances.
describe('note pending setup state', () => {
  it('flags pendingSetup when ensureNoteKey returns null (key not yet distributed)', () => {
    expect(applyNoteKeyResult(null)).toBe(true);
  });

  it('clears pendingSetup when a note key is available', () => {
    expect(applyNoteKeyResult('deadbeef')).toBe(false);
  });
});

describe('global key-distribution banner', () => {
  it('shows when there are pending distribution requests', () => {
    expect(
      computeIsDistributingKeys([
        { noteId: 'n1', userId: 'u1', targetDeviceId: 'dev-b' },
      ])
    ).toBe(true);
  });

  it('hides when there are no pending requests', () => {
    expect(computeIsDistributingKeys([])).toBe(false);
  });

  it('defaults to hidden for a non-array payload', () => {
    expect(computeIsDistributingKeys(undefined)).toBe(false);
  });
});
