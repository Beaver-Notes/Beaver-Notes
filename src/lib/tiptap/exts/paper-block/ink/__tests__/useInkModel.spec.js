import { describe, expect, it } from 'vitest';
import { actions, generateSnapshot, restoreSnapshot } from '../useInkModel.js';

describe('useInkModel', () => {
  it('exposes frozen actions and snapshots/restores ink state', () => {
    const strokes = [{ id: 'a' }];
    const bounds = [{ minX: 0, minY: 0, maxX: 1, maxY: 1 }];
    const snap = generateSnapshot({ strokes, strokesBounds: bounds }, ['a']);
    expect(actions).toEqual(['move', 'select', 'erase', 'pen', 'shape', 'zoom']);
    expect(Object.isFrozen(actions)).toBe(true);
    expect(snap).toEqual({ strokes: [{ id: 'a' }], bounds, selectionIds: ['a'] });
    expect(restoreSnapshot({ strokes: [{ id: 'a' }] }, ['a']).strokesBounds).toHaveLength(1);
    expect(strokes[0].id).toBe('a');
  });
});
