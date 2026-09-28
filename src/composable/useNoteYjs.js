import * as Y from 'yjs';
import { ref, shallowRef, onUnmounted } from 'vue';
import {
  appendUpdate,
  getUpdates,
  getSnapshot,
  compactUpdates,
  compactNote,
} from '@/lib/native/yjs.js';
import { queueSyncWrite } from '@/utils/sync/pending-writes.js';
import {
  getDeviceId,
  applyUpdatesToDoc,
  toUint8Array,
  ensureSchema,
  seedDeterministically,
} from '@/lib/yjs/helpers.js';
import { getWsSync, setRoomKey } from '@/lib/sync/ws-sync.js';
import { useNoteSharing } from './useNoteSharing.js';
import { useWorkspaceStore } from '@/store/workspace';
import { resolveNoteWorkspaceId } from '@/utils/sync/shared-notes.js';
import { speed } from '@/utils/speed.js';

export { registerActiveDoc, applyRemote } from '@/lib/yjs/shared.js';
import { registerActiveDoc, unregisterActiveDoc } from '@/lib/yjs/shared.js';

const MAX_WRITE_RETRIES = 3;
const WRITE_RETRY_DELAY_MS = 200;

// Live useNoteYjs instances register their buffered-delta flusher here so a
// global teardown (sign-out) can persist every in-flight edit before the store
// and docs are cleared (L12). A dropped buffered delta is unrecoverable.
const flushHandlers = new Set();

export async function flushAllNoteYjsPending() {
  await Promise.all([...flushHandlers].map((fn) => fn()));
}

// Maps note-key resolution to the per-note "shared key pending" flag. Advisory
// only: it never gates editing or persistence. Pure + exported for unit testing.
export function applyNoteKeyResult(noteKeyHex) {
  return !noteKeyHex;
}

async function retryWrite(fn, label) {
  for (let attempt = 1; attempt <= MAX_WRITE_RETRIES; attempt++) {
    try {
      await fn();
      return;
    } catch (err) {
      if (attempt === MAX_WRITE_RETRIES) {
        console.error(`[yjs] ${label} failed after ${MAX_WRITE_RETRIES} attempts:`, err);
        throw err;
      }
      console.warn(`[yjs] ${label} attempt ${attempt} failed, retrying...`, err);
      await new Promise((r) => setTimeout(r, WRITE_RETRY_DELAY_MS));
    }
  }
}

async function seedFromTipJson(ydoc, contentJson, noteId) {
  const { prosemirrorJSONToYXmlFragment } = await import('@tiptap/y-tiptap');
  const schema = await ensureSchema();
  seedDeterministically(ydoc, `${noteId}:content`, (temp) => {
    prosemirrorJSONToYXmlFragment(
      schema,
      contentJson,
      temp.getXmlFragment('content'),
    );
  });
}

// Load Yjs state: snapshot first (O(1)), fall back to replaying updates.
async function loadStateIntoDoc(newDoc, noteId) {
  const t = speed('yjs_load_snapshot');
  let snapshotWasCorrupt = false;
  try {
    const snapshot = await getSnapshot(noteId);
    if (snapshot && snapshot.length > 0) {
      // Defensive decode: a corrupt/garbage snapshot (base64 string, JSON, or
      // half-decrypted blob from a bad cloud bootstrap) must be discarded here,
      // not allowed to mutate newDoc. Validate in an isolated probe doc first.
      const bytes = toUint8Array(snapshot);
      const probe = new Y.Doc();
      try {
        Y.applyUpdate(probe, bytes);
      } finally {
        probe.destroy();
      }
      Y.applyUpdate(newDoc, bytes);
      t?.end();
      return;
    }
  } catch (err) {
    // Snapshot decode failed: repair cached copy after replay.
    snapshotWasCorrupt = true;
    console.error(`[yjs] Failed to load snapshot for ${noteId}:`, err);
  }

  try {
    const updates = await getUpdates(noteId);
    applyUpdatesToDoc(newDoc, updates);
  } catch (err) {
    console.error(`[yjs] Failed to load updates for ${noteId}:`, err);
  }

  // Repair a corrupt cached snapshot so the decode error doesn't re-trigger on
  // every open. Best-effort: failure just means falling back again next time.
  // Rust merges stored rows in place; no snapshot bytes cross IPC.
  if (snapshotWasCorrupt && newDoc.store) {
    try {
      await compactNote(noteId);
    } catch (repairErr) {
      console.warn(`[yjs] could not repair snapshot for ${noteId}:`, repairErr);
    }
  }
  t?.end();
}

// Persist a Yjs update to SQLite (Rust reads `note_content`) and dirty-kick
// Rust. Returns false when the update could not be written: the caller keeps
// the merged delta buffered so a retry can still persist it.
async function persistUpdate(noteId, update) {
  if (!noteId || !update || update.byteLength === 0) return true;
  try {
    await retryWrite(
      () => appendUpdate(noteId, update, getDeviceId()),
      `SQLite appendUpdate for ${noteId}`
    );
  } catch (err) {
    console.error(
      `[yjs] persist failed for ${noteId}; keeping delta buffered for retry:`,
      err
    );
    return false;
  }
  queueSyncWrite(noteId);
  return true;
}

const FLUSH_DELAY_MS = 300;
// Failed persists stay buffered; retry on a slower cadence so a transient IPC
// failure recovers without a tight loop, and a persistent one keeps retrying.
const PERSIST_RETRY_DELAY_MS = 2000;

// note_content grows one row per flush; without periodic compaction a long
// editing session (or crash before note switch) forces full CRDT replay on
// next open.
const COMPACT_INTERVAL_MS = 5 * 60 * 1000;
const COMPACT_UPDATE_THRESHOLD = 100;

// Composable that manages Yjs documents across note switches on the page.
export function useNoteYjs() {
  const doc = shallowRef(null);
  const ready = ref(false);
  // True while this device awaits note-key distribution (late joiner).
  const pendingSetup = ref(false);
  let currentNoteId = null;
  let currentDoc = null;
  // Monotonic load id. An in-flight load whose id is stale may never install
  // its doc or buffer its updates under the current note id.
  let loadGeneration = 0;

  // Buffered deltas are keyed by note id, not by the currently displayed note:
  // a failed/queued flush from note A must never be persisted to note B after
  // a switch.
  const pendingByNote = new Map();
  let flushTimer = null;
  let retryTimer = null;
  let lastCompactAt = Date.now();
  let updatesSinceCompact = 0;

  function enqueueUpdate(noteId, update) {
    if (!noteId) return;
    let buffered = pendingByNote.get(noteId);
    if (!buffered) {
      buffered = [];
      pendingByNote.set(noteId, buffered);
    }
    buffered.push(update);
  }

  function scheduleFlush() {
    if (flushTimer) clearTimeout(flushTimer);
    flushTimer = setTimeout(() => {
      flushTimer = null;
      flushPendingUpdates();
    }, FLUSH_DELAY_MS);
  }

  function scheduleRetryFlush() {
    if (retryTimer) return;
    retryTimer = setTimeout(() => {
      retryTimer = null;
      flushPendingUpdates();
    }, PERSIST_RETRY_DELAY_MS);
  }

  // Flush buffered deltas. With no noteId, every buffered note is flushed (note
  // switch / teardown). A failed note stays buffered for a later retry.
  async function flushPendingUpdates(noteId) {
    const ids = noteId ? [noteId] : [...pendingByNote.keys()];
    for (const id of ids) {
      const buffered = pendingByNote.get(id);
      if (!buffered || buffered.length === 0) {
        pendingByNote.delete(id);
        continue;
      }
      const updates = buffered.splice(0);
      updatesSinceCompact += updates.length;
      const merged = Y.mergeUpdates(updates);
      const ok = await persistUpdate(id, merged);
      if (!ok) {
        const requeued = pendingByNote.get(id) || [];
        requeued.unshift(merged);
        pendingByNote.set(id, requeued);
        scheduleRetryFlush();
        continue;
      }

      // Fold accumulated history into a single row when due. Rust merges the
      // stored rows in place (sync_compact_note), so no JS encode and no
      // snapshot bytes cross IPC. Pending was just flushed, so rows hold it.
      const due =
        Date.now() - lastCompactAt > COMPACT_INTERVAL_MS ||
        updatesSinceCompact >= COMPACT_UPDATE_THRESHOLD;
      if (due) {
        try {
          await compactNote(id);
          lastCompactAt = Date.now();
          updatesSinceCompact = 0;
        } catch (err) {
          console.warn('[yjs] periodic compact failed, retrying later:', err);
        }
      }
    }
  }

  const flushHandler = () => flushPendingUpdates();
  flushHandlers.add(flushHandler);

  // Unregister / leave the room / destroy the active doc. Idempotent.
  function teardownActiveDoc() {
    const oldDoc = currentDoc;
    const oldNoteId = currentNoteId;
    currentDoc = null;
    currentNoteId = null;
    if (!oldDoc) return;
    if (oldNoteId) {
      // Fire-and-forget Rust merge; pending was flushed before the switch.
      compactNote(oldNoteId).catch(() => {
        // non-critical
      });
      unregisterActiveDoc(oldNoteId);
      getWsSync().leaveNoteRoom(oldNoteId);
    }
    oldDoc.destroy();
  }

  // Flush synchronously-scheduled work when the tab is hidden or closed: the
  // 300 ms debounce otherwise drops the last keystrokes on window close.
  function flushNow() {
    if (flushTimer) {
      clearTimeout(flushTimer);
      flushTimer = null;
    }
    flushPendingUpdates();
  }

  let removeLifecycleFlush = null;
  if (typeof window !== 'undefined') {
    const onPageHide = () => flushNow();
    const onVisibility = () => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
        flushNow();
      }
    };
    window.addEventListener('pagehide', onPageHide);
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', onVisibility);
    }
    removeLifecycleFlush = () => {
      window.removeEventListener('pagehide', onPageHide);
      if (typeof document !== 'undefined') {
        document.removeEventListener('visibilitychange', onVisibility);
      }
    };
  }

  async function load(noteId, initialContent) {
    const t = speed('yjs_load_note');
    // Every load owns a generation. A load that is superseded while awaiting
    // must never install its doc or buffer updates: rapid note switching would
    // otherwise leave currentNoteId pointing at one note while another note's
    // doc is displayed and persisted to the wrong rows.
    const generation = ++loadGeneration;
    const isStale = () => generation !== loadGeneration;

    // Reset up front so a stale `true` from a previous note can't leak into
    // this one if key resolution throws before the result is applied.
    pendingSetup.value = false;
    ready.value = false;

    // Flush pending updates for the *previous* note before switching.
    if (flushTimer) {
      clearTimeout(flushTimer);
      flushTimer = null;
    }
    await flushPendingUpdates();
    if (isStale()) {
      t?.end();
      return;
    }

    teardownActiveDoc();

    const newDoc = new Y.Doc();

    await loadStateIntoDoc(newDoc, noteId);
    if (isStale()) {
      newDoc.destroy();
      t?.end();
      return;
    }

    // Still empty after replay (fresh or corrupt snapshot): seed from store.
    const frag = newDoc.getXmlFragment('content');
    if (frag.length === 0 && initialContent) {
      try {
        await seedFromTipJson(newDoc, initialContent, noteId);
        const snapshot = Y.encodeStateAsUpdate(newDoc);
        await compactUpdates(noteId, snapshot);
      } catch (e) {
        console.error('[yjs] seeding also failed:', e);
      }
    }
    if (isStale()) {
      newDoc.destroy();
      t?.end();
      return;
    }

    // Yjs single-type-per-key: probe share before claiming the key as YText or
    // XmlFragment. Legacy docs store title as XmlFragment; new code uses YText.
    // Claiming the wrong type first corrupts the value (length mismatch) and
    // throws on the second accessor.
    const existing = newDoc.share.get('title');
    if (existing instanceof Y.XmlFragment) {
      let seed = '';
      try {
        const frag = newDoc.getXmlFragment('title');
        seed = frag.toJSON() || '';
        if (!seed) {
          try { seed = frag.get(0)?.toString() || ''; } catch {}
        }
      } catch (e) {
        console.warn('[yjs] legacy title migration failed to extract seed:', e);
      }
      try {
        newDoc.share.delete('title');
      } catch (e) {
        console.warn('[yjs] failed to delete legacy title key:', e);
      }
      if (seed) {
        try {
          // Deterministic author: two devices migrating the same legacy title
          // merge into one copy instead of concatenating it.
          seedDeterministically(newDoc, `${noteId}:legacy-title`, (temp) => {
            temp.getText('title').insert(0, seed);
          });
        } catch (e) {
          console.warn('[yjs] failed to migrate legacy title to YText:', e);
        }
      }
    }
    // The store/meta title is NOT seeded into the collaborative Y.Text here.
    // The title is carried by the workspace meta doc; applyTitleDelta seeds the
    // first real edit deterministically so two clients don't double it.

    newDoc.on('update', (update, origin) => {
      if (origin === 'load' || origin === 'sync' || origin === 'ws-relay') return;
      if (isStale()) return;
      // Never drop a local edit while the shared key is unresolved: the note is
      // editable under the items key and self-heals to the shared key when the
      // background recovery lands (L9 — no silent read-only lockout).
      enqueueUpdate(noteId, update);
      scheduleFlush();
    });

    let noteKeyHex = null;
    try {
      const workspaceStore = useWorkspaceStore();
      const sharing = useNoteSharing();
      // Fired by the background envelope recovery once the key actually lands:
      // clear the advisory flag and re-key the realtime room with the shared
      // key so subsequent updates seal under it (durable sealing is registered
      // by rememberAndProvision in the same path).
      const onKeyResolved = async (hex) => {
        if (!hex || isStale()) return;
        pendingSetup.value = false;
        // A shared-with-me note lives in its owning workspace's room, not the
        // active one (Google-Docs-style note presence).
        const ownerId = resolveNoteWorkspaceId(noteId, workspaceStore.activeId);
        if (ownerId) {
          await setRoomKey(`workspace:${ownerId}:note:${noteId}`, hex);
        }
      };
      noteKeyHex = await sharing.ensureNoteKey(noteId, { backgroundRetry: true, onKeyResolved });
      const ownerId = resolveNoteWorkspaceId(noteId, workspaceStore.activeId);
      if (noteKeyHex && ownerId) {
        await setRoomKey(`workspace:${ownerId}:note:${noteId}`, noteKeyHex);
      }
    } catch (err) {
      console.warn('[yjs] note-key provisioning skipped:', err);
    }
    // Advisory only: a missing key no longer gates editing or persistence, it
    // just records that this device hasn't been handed the shared key *yet*.
    pendingSetup.value = applyNoteKeyResult(noteKeyHex);
    if (isStale()) {
      newDoc.destroy();
      t?.end();
      return;
    }

    // Register in the global active-docs map so that WS updates are applied.
    // Room join (with awareness) is owned by the page watcher (per-doc awareness guard).
    currentNoteId = noteId;
    currentDoc = newDoc;
    registerActiveDoc(noteId, newDoc);

    doc.value = newDoc;
    ready.value = true;
    t?.end();
  }

  function titleDiff(prev, next) {
    let start = 0; const n = Math.min(prev.length, next.length);
    while (start < n && prev[start] === next[start]) start++;
    if (start === prev.length && start === next.length) return { pos: 0, del: 0, ins: '' };
    let endPrev = prev.length, endNext = next.length;
    while (endPrev > start && endNext > start && prev[endPrev - 1] === next[endNext - 1]) { endPrev--; endNext--; }
    return { pos: start, del: endPrev - start, ins: next.slice(start, endNext) };
  }
  // ponytail: exported for test
  function applyTitleDelta(next) {
    if (!currentDoc) return;
    const ytext = currentDoc.getText('title');
    const prev = ytext.toString();
    const n = next ?? '';
    if (prev === n) return;
    // Empty Y.Text but a non-empty title (meta-only title, Y.Text never seeded):
    // seed under a deterministic client id so two clients applying the same
    // title concurrently merge into one copy instead of concatenating it.
    // Origin 'local' (not 'load') so the seed is buffered and persisted.
    if (prev === '' && n) {
      seedDeterministically(
        currentDoc,
        `${currentNoteId || 'note'}:title`,
        (temp) => {
          temp.getText('title').insert(0, n);
        },
        'local'
      );
      return;
    }
    const { pos, del, ins } = titleDiff(prev, n);
    currentDoc.transact(() => {
      if (del) ytext.delete(pos, del);
      if (ins) ytext.insert(pos, ins);
    });
  }

  function getTitle() { return currentDoc ? currentDoc.getText('title').toString() : ''; }
  function setTitle(title) { applyTitleDelta(title ?? ''); }
  function observeTitle(cb) {
    if (!currentDoc) return () => {};
    const ytext = currentDoc.getText('title');
    const h = () => cb(ytext.toString());
    ytext.observe(h);
    return () => ytext.unobserve(h);
  }

  onUnmounted(async () => {
    flushHandlers.delete(flushHandler);
    // Flush buffered updates before compacting.
    if (flushTimer) {
      clearTimeout(flushTimer);
      flushTimer = null;
    }
    if (retryTimer) {
      clearTimeout(retryTimer);
      retryTimer = null;
    }
    removeLifecycleFlush?.();
    removeLifecycleFlush = null;
    await flushPendingUpdates();
    teardownActiveDoc();
  });

  return { doc, ready, pendingSetup, load, getTitle, setTitle, observeTitle, applyTitleDelta };
}
