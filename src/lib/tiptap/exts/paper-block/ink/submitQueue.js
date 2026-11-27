/**
 * submitQueue.js — coalesces rapid stroke commits (REDESIGN phase D).
 *
 * Consecutive edits to the same stroke id merge into one transaction;
 * distinct ids flush FIFO in one transaction. Apple's undo granularity is
 * per stroke (one op per completed stroke, not per pointermove).
 * Owns fit-to-document bookkeeping: height growth folds into the same
 * transaction as the stroke that caused it — no flash.
 */

export class SubmitQueue {
  constructor() {
    this._entries = []; // { id, stroke }
    this._indexById = new Map(); // id -> index in _entries
    this._grow = null;
  }

  /** Queue a stroke commit; same-id edits replace (merge). */
  enqueueStroke(id, stroke) {
    const idx = this._indexById.get(id);
    if (idx != null) {
      this._entries[idx].stroke = stroke;
    } else {
      this._indexById.set(id, this._entries.length);
      this._entries.push({ id, stroke });
    }
  }

  /** Fold a height growth into the pending transaction. */
  enqueueGrow(height) {
    this._grow = height;
  }

  /** Flush all pending edits as one transaction. Returns { strokes, grow }. */
  flush() {
    const strokes = this._entries.map((e) => e.stroke);
    const grow = this._grow;
    this._entries = [];
    this._indexById.clear();
    this._grow = null;
    return { strokes, grow };
  }

  hasPending() {
    return this._entries.length > 0 || this._grow != null;
  }

  size() {
    return this._entries.length;
  }
}
