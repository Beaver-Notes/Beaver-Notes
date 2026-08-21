import { describe, it, expect } from 'vitest';
import { applyNoteKeyResult } from '@/composable/useNoteYjs';

// These tests target the pure derivation helper that `load()` (useNoteYjs)
// uses. It encodes the same logic the UI binds to without needing the
// lifecycle-bound composable instance.
describe('note pending setup state', () => {
  it('flags pendingSetup when ensureNoteKey returns null (key not yet distributed)', () => {
    expect(applyNoteKeyResult(null)).toBe(true);
  });

  it('clears pendingSetup when a note key is available', () => {
    expect(applyNoteKeyResult('deadbeef')).toBe(false);
  });
});
