/**
 * Always-on performance recorder.
 *
 * Answers "what made the app jank?" without writing a measurement harness per
 * feature: a long-task PerformanceObserver (where WebKit supports it), a
 * universal requestAnimationFrame gap detector for everything the observer
 * misses, and a cheap per-transaction attribution log so every stall records
 * what the editor did just before it. Entries live in a fixed-size ring
 * buffer; `window.__beaverPerf.summary()` aggregates them for dumping through
 * the e2e bridge (`POST /eval { code: "return __beaverPerf.summary()" }`) —
 * or a user's bug report can include the same dump.
 */

const RING_SIZE = 800;
const STALL_GAP_MS = 50; // a frame gap this big is a missed deadline at 60fps
const BUCKETS = [50, 100, 200, 500, 1000, Infinity];

const entries = [];
let txLog = []; // recent editor transactions, for stall attribution
let lastEditor = null; // live editor handle, so generic sweeps can reach it
let rafLast = 0;
let observer = null;
let started = false;

function push(entry) {
  entries.push(entry);
  if (entries.length > RING_SIZE) entries.splice(0, entries.length - RING_SIZE);
}

function bucketOf(ms) {
  for (const b of BUCKETS) if (ms <= b) return b === Infinity ? '1000+' : `${b}`;
  return '1000+';
}

export function perfMark(label) {
  const entry = { t: Date.now(), kind: 'mark', label };
  push(entry);
  try {
    performance.mark(`beaver:${label}`);
  } catch {
    /* performance.mark unavailable */
  }
  return entry;
}

/** Named phase timing (e.g. from the speed() timers) — not a jank event. */
export function perfSpan(label, ms) {
  return push({ t: Date.now(), kind: 'span', label, ms });
}

export function perfMeasure(label, sinceMark) {
  const name = `beaver:${label}:${Date.now()}`;
  try {
    performance.measure(name, sinceMark ? `beaver:${sinceMark}` : undefined);
    const m = performance.getEntriesByName(name).pop();
    const ms = m ? Math.round(m.duration * 100) / 100 : -1;
    performance.clearMeasures(name);
    if (sinceMark) performance.clearMarks(`beaver:${sinceMark}`);
    push({ t: Date.now(), kind: 'measure', label, ms });
    return ms;
  } catch {
    push({ t: Date.now(), kind: 'measure', label, ms: -1 });
    return -1;
  }
}

/** Called from the editor's onTransaction hook — one cheap object per transaction. */
export function recordEditorTransaction(transaction, editor) {
  if (!transaction) return;
  lastEditor = editor || lastEditor;
  txLog.push({
    t: Date.now(),
    doc: transaction.docChanged,
    sel: transaction.selectionSet,
    steps: transaction.steps?.length || 0,
    meta: transaction.getMeta?.('y-sync$') !== undefined ? 'y' : undefined,
  });
  if (txLog.length > 120) txLog.splice(0, txLog.length - 120);
}

function lastTransactionsBefore(t, withinMs = 1500) {
  const recent = txLog.filter((e) => t - e.t <= withinMs);
  if (!recent.length) return undefined;
  return {
    count: recent.length,
    doc: recent.filter((e) => e.doc).length,
    last: recent[recent.length - 1],
  };
}

function startRafGapDetector() {
  const loop = (now) => {
    if (rafLast) {
      const gap = now - rafLast;
      if (gap >= STALL_GAP_MS) {
        push({
          t: Date.now(),
          kind: 'stall',
          ms: Math.round(gap),
          tx: lastTransactionsBefore(Date.now()),
        });
      }
    }
    rafLast = now;
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
}

function startLongTaskObserver() {
  if (
    typeof PerformanceObserver === 'undefined' ||
    !PerformanceObserver.supportedEntryTypes?.includes('longtask')
  ) {
    return; // rAF gap detector still covers jank on older WebKit
  }
  observer = new PerformanceObserver((list) => {
    for (const e of list.getEntries()) {
      push({
        t: Date.now(),
        kind: 'longtask',
        ms: Math.round(e.duration),
        attribution: e.attribution?.[0]?.name,
        tx: lastTransactionsBefore(Date.now()),
      });
    }
  });
  try {
    observer.observe({ entryTypes: ['longtask'] });
  } catch {
    observer = null;
  }
}

export function initPerfRecorder() {
  if (started) return;
  started = true;
  startLongTaskObserver();
  startRafGapDetector();

  const api = {
    mark: perfMark,
    measure: perfMeasure,
    span: perfSpan,
    tx: recordEditorTransaction,
    editor: () => (lastEditor && !lastEditor.isDestroyed ? lastEditor : null),
    events: entries,
    clear() {
      entries.length = 0;
      txLog = [];
    },
    summary(sinceMs = 0) {
      const cutoff = sinceMs ? Date.now() - sinceMs : 0;
      const visible = entries.filter((e) => e.t >= cutoff);
      const stalls = visible.filter(
        (e) => e.kind !== 'mark' && e.kind !== 'measure' && e.kind !== 'span',
      );
      const byBucket = {};
      for (const s of stalls) {
        const b = bucketOf(s.ms);
        byBucket[b] = (byBucket[b] || 0) + 1;
      }
      const worst = [...stalls].sort((a, b) => b.ms - a.ms).slice(0, 12);
      const spans = visible.filter((e) => e.kind === 'span');
      return {
        observer: observer ? 'longtask+raf' : 'raf-only',
        total: stalls.length,
        byBucket,
        worst,
        spans,
        marks: visible.filter((e) => e.kind === 'mark').length,
      };
    },
  };

  window.__beaverPerf = api;
  return api;
}
