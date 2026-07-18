// tests/unit/store/undo.spec.js
import { describe, it, expect } from 'vitest';
import { useUndoStore } from '@/store/undo';

describe('undo store', () => {
  it('starts with an empty stack', () => {
    const store = useUndoStore();
    expect(store.stack).toEqual([]);
    expect(store.lastAction).toBeNull();
  });

  it('pushes an action onto the stack and tracks lastAction', () => {
    const store = useUndoStore();
    const action = { type: 'toggle-bookmark', notes: [{ id: 'n1', prev: false }] };
    store.push(action);
    expect(store.stack).toHaveLength(1);
    expect(store.lastAction).toStrictEqual(action);
  });
});
