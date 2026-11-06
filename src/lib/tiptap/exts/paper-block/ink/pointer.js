/** Pointer pipeline: input predicates, native pressure sampling, coalesced-event draining. Pure. */

export function isPen(e) {
  return e.pointerType === 'pen';
}

/** Palm rejection: large-contact touch only; pen/mouse are never palms. */
export function isPalm(e) {
  if (e.pointerType === 'pen' || e.pointerType === 'mouse') return false;
  return (e.width ?? 0) > 60 || (e.height ?? 0) > 60;
}

/** Deliberate drawing input; when pen mode is active, pen only. */
export function isDeliberateInput(e, isPenMode = false) {
  if (isPalm(e)) return false;
  if (isPenMode && e.pointerType !== 'pen') return false;
  return (
    e.pointerType === 'pen' || e.pointerType === 'mouse' || e.pointerType === 'touch'
  );
}

/** Hardware eraser button on some styluses (button 5). */
export function isStylusEraser(e) {
  return e.button === 5;
}

/** High-Hz styluses fire sub-frame events; falls back to [e] where unsupported. */
export function getCoalescedEvents(e) {
  if (typeof e.getCoalescedEvents === 'function') {
    return e.getCoalescedEvents();
  }
  return [e];
}

/**
 * Pressure: native `event.pressure` for pen/stylus only; every other pointer
 * gets a constant 0.5 so strokes render at uniform width. `last` is accepted
 * for signature compatibility but unused since the speed fallback was dropped.
 */
export function samplePressure(e, last) {
  const native = e.pressure;
  if (e.pointerType === 'pen' && native > 0) {
    return native;
  }
  void last;
  return 0.5;
}

/**
 * Drains coalesced sub-frame events in order, mapping each through
 * `toLocal(event) -> [x, y]` and sampling pressure with a running last-sample.
 * Appends the event itself when the coalesced list omits it.
 */
export function collectPoints(event, toLocal, last) {
  const drained = getCoalescedEvents(event);
  const samples = drained.includes(event) ? drained : [...drained, event];
  let running = last;
  return samples.map((e) => {
    const [x, y] = toLocal(e);
    const p = samplePressure(e, running);
    running = { x: e.clientX, y: e.clientY, t: e.timeStamp ?? 0 };
    return [x, y, p];
  });
}
