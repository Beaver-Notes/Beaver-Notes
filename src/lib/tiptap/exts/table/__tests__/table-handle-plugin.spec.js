import { describe, expect, it } from 'vitest';
import { isTableHandleStateFresh } from '../table-handle-plugin.js';

describe('isTableHandleStateFresh', () => {
  it('is fresh for same table/cell, stale after node/pos change', () => {
    const block = { attrs: { id: 'table-1' } };
    const state = { show: true, block, blockPos: 42, rowIndex: 1, colIndex: 2 };
    expect(isTableHandleStateFresh(state, 'table-1', { node: block, pos: 42 }, 1, 2)).toBe(true);
    expect(isTableHandleStateFresh(state, 'table-1', { node: { attrs: { id: 'table-1' } }, pos: 42 }, 1, 2)).toBe(false);
    expect(isTableHandleStateFresh(state, 'table-1', { node: block, pos: 99 }, 1, 2)).toBe(false);
  });
});
