import { describe, expect, it } from 'vitest';
import { SubmitQueue } from '../submitQueue.js';

describe('SubmitQueue', () => {
  it('merges same-id strokes, preserves FIFO, and flushes grow', () => {
    const q = new SubmitQueue();
    q.enqueueStroke('a', { id: 'a', v: 1 });
    q.enqueueStroke('b', { id: 'b', v: 1 });
    q.enqueueStroke('a', { id: 'a', v: 2 });
    q.enqueueGrow(420);
    expect(q.flush()).toEqual({ strokes: [{ id: 'a', v: 2 }, { id: 'b', v: 1 }], grow: 420 });
    expect(q.flush()).toEqual({ strokes: [], grow: null });
  });
});
