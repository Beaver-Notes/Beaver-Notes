import { describe, expect, it } from 'vitest';
import {
  collectPoints,
  getCoalescedEvents,
  isDeliberateInput,
  isPalm,
  isPen,
  isStylusEraser,
  samplePressure,
} from '../pointer.js';

const pen = (over = {}) => ({ pointerType: 'pen', pressure: 0.83, ...over });
const touch = (over = {}) => ({ pointerType: 'touch', pressure: 0, ...over });

describe('pointer predicates', () => {
  it('isPen true only for pointerType pen', () => {
    expect(isPen(pen())).toBe(true);
    expect(isPen(touch())).toBe(false);
  });

  it('isPalm flags large touch contact (>60px) but never pen/mouse', () => {
    expect(isPalm(touch({ width: 100, height: 50 }))).toBe(true);
    expect(isPalm(touch({ width: 40, height: 40 }))).toBe(false);
    expect(isPalm(pen({ width: 100, height: 100 }))).toBe(false);
    expect(isPalm({ pointerType: 'mouse', width: 100, height: 100 })).toBe(false);
  });

  it('isDeliberateInput rejects palms, respects pen mode', () => {
    expect(isDeliberateInput(touch({ width: 100, height: 50 }))).toBe(false);
    expect(isDeliberateInput(touch({ width: 10, height: 10 }))).toBe(true);
    expect(isDeliberateInput(touch({ width: 10, height: 10 }), true)).toBe(false);
    expect(isDeliberateInput(pen(), true)).toBe(true);
  });

  it('isStylusEraser detects hardware eraser button 5', () => {
    expect(isStylusEraser({ button: 5 })).toBe(true);
    expect(isStylusEraser({ button: 0 })).toBe(false);
  });
});

describe('samplePressure', () => {
  it('uses native pressure for pen input', () => {
    expect(samplePressure(pen())).toBe(0.83);
  });

  it('falls back to the speed curve forWebKit finger (pressure 0)', () => {
    const last = { x: 0, y: 0, t: 0 };
    const slow = samplePressure(touch({ clientX: 1, clientY: 0 }), last);
    const fast = samplePressure(touch({ clientX: 100, clientY: 0 }), last);
    expect(slow).toBeGreaterThanOrEqual(0.5);
    expect(slow).toBeLessThanOrEqual(1);
    expect(slow).toBeGreaterThan(fast);
  });

  it('is monotonic: slower movement always presses harder', () => {
    const last = { x: 0, y: 0, t: 0 };
    let prev = 0;
    for (const dx of [0.5, 0.1, 0.02, 0]) {
      const p = samplePressure(touch({ clientX: dx, clientY: 0 }), last);
      expect(p).toBeGreaterThan(prev);
      prev = p;
    }
  });
});

describe('coalesced events', () => {
  it('drains sub-frame events in order, falling back to [event]', () => {
    const a = { clientX: 1 };
    const b = { clientX: 2 };
    expect(getCoalescedEvents({ getCoalescedEvents: () => [a, b] })).toEqual([a, b]);
    expect(getCoalescedEvents(a)).toEqual([a]);
  });

  it('collectPoints maps each coalesced event through toLocal, appending the event when WebKit already included it', () => {
    const tail = { pointerType: 'pen', pressure: 0.6, clientX: 10, clientY: 0 };
    const evs = [
      { pointerType: 'pen', pressure: 0.2, clientX: 0, clientY: 0 },
      { pointerType: 'pen', pressure: 0.4, clientX: 5, clientY: 0 },
      tail,
    ];
    const event = { ...tail, getCoalescedEvents: () => evs };
    Object.assign(tail, event); // WebKit includes the current event by reference
    evs[2] = event;
    const toLocal = (e) => [e.clientX / 2, e.clientY];
    expect(collectPoints(event, toLocal, null)).toEqual([
      [0, 0, 0.2],
      [2.5, 0, 0.4],
      [5, 0, 0.6],
    ]);
  });

  it('collectPoints appends the trailing event itself when coalesced list omits it', () => {
    const inner = { pointerType: 'pen', pressure: 0.2, clientX: 0, clientY: 0 };
    const event = { pointerType: 'pen', pressure: 0.6, clientX: 10, clientY: 0, getCoalescedEvents: () => [inner] };
    const toLocal = (e) => [e.clientX, e.clientY];
    const pts = collectPoints(event, toLocal, null);
    expect(pts).toEqual([
      [0, 0, 0.2],
      [10, 0, 0.6],
    ]);
  });
});
