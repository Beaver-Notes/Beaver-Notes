// tests/unit/store/label.spec.js
import { describe, it, expect } from 'vitest';
import { useLabelStore } from '@/store/label';

describe('label store', () => {
  it('starts with no labels', () => {
    const store = useLabelStore();
    expect(store.data).toEqual([]);
    expect(store.colors).toEqual({});
  });

  it('adds a label and appends it to data', async () => {
    const store = useLabelStore();
    const name = await store.add('Work');
    expect(name).toBe('Work');
    expect(store.data).toContain('Work');
  });
});
