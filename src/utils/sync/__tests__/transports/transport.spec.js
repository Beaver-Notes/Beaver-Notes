import { describe, expect, it } from 'vitest';
import { mergeCursorDelta } from '../../transports/transport.js';

describe('mergeCursorDelta', () => {
  it('higher ts wins', () => {
    const cursors = { 'yjs-deviceA': { ts: 100, seq: 0 } };
    const changed = mergeCursorDelta(cursors, { 'yjs-deviceA': { ts: 200, seq: 0 } });
    expect(changed).toBe(true);
    expect(cursors['yjs-deviceA']).toEqual({ ts: 200, seq: 0 });
  });

  it('equal ts: higher seq wins', () => {
    const cursors = { 'yjs-deviceA': { ts: 100, seq: 5 } };
    const changed = mergeCursorDelta(cursors, { 'yjs-deviceA': { ts: 100, seq: 10 } });
    expect(changed).toBe(true);
    expect(cursors['yjs-deviceA']).toEqual({ ts: 100, seq: 10 });
  });

  it('equal ts and seq: no change (idempotent)', () => {
    const cursors = { 'yjs-deviceA': { ts: 100, seq: 5 } };
    const changed = mergeCursorDelta(cursors, { 'yjs-deviceA': { ts: 100, seq: 5 } });
    expect(changed).toBe(false);
    expect(cursors['yjs-deviceA']).toEqual({ ts: 100, seq: 5 });
  });

  it('lower ts is ignored', () => {
    const cursors = { 'yjs-deviceA': { ts: 200, seq: 0 } };
    const changed = mergeCursorDelta(cursors, { 'yjs-deviceA': { ts: 100, seq: 0 } });
    expect(changed).toBe(false);
    expect(cursors['yjs-deviceA']).toEqual({ ts: 200, seq: 0 });
  });

  it('creates cursor entry when device is new', () => {
    const cursors = {};
    const changed = mergeCursorDelta(cursors, { 'yjs-deviceB': { ts: 50, seq: 0 } });
    expect(changed).toBe(true);
    expect(cursors['yjs-deviceB']).toEqual({ ts: 50, seq: 0 });
  });

  it('handles multiple devices in one delta', () => {
    const cursors = {};
    const changed = mergeCursorDelta(cursors, {
      'yjs-deviceA': { ts: 10, seq: 0 },
      'yjs-deviceB': { ts: 20, seq: 0 },
    });
    expect(changed).toBe(true);
    expect(cursors['yjs-deviceA']).toEqual({ ts: 10, seq: 0 });
    expect(cursors['yjs-deviceB']).toEqual({ ts: 20, seq: 0 });
  });

  it('returns false when no entry changes', () => {
    const cursors = { 'yjs-deviceA': { ts: 10, seq: 0 } };
    const changed = mergeCursorDelta(cursors, { 'yjs-deviceA': { ts: 10, seq: 0 } });
    expect(changed).toBe(false);
  });
});
