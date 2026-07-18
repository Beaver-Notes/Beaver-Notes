// tests/unit/store/main.spec.js
import { describe, it, expect } from 'vitest';
import { useStore } from '@/store/index';

describe('main store', () => {
  it('initialises with no active note', () => {
    const store = useStore();
    expect(store.activeNoteId).toBe('');
  });

  it('retrieves child stores without throwing', async () => {
    const store = useStore();
    const result = await store.retrieve();
    expect(Array.isArray(result)).toBe(true);
    expect(store.activeNoteId).toBe('');
  });
});
