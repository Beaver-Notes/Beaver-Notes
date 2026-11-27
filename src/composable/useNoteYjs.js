import * as Y from 'yjs';
import { ref, shallowRef, onUnmounted } from 'vue';
import {
  appendUpdate,
  getUpdates,
  getSnapshot,
  getStateVector,
  getContentVersion,
  compactUpdates,
  compactNote,
} from '@/lib/native/yjs.js';
import {
  loadChunksIntoDoc,
  planOpenPath,
  readManifest,
  rebuildChunkIndex,
  upgradeManifestVersion,
} from '@/lib/yjs/chunk-store.js';
import { shouldChunkDoc } from '@/lib/yjs/chunking.js';
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
import { resolveNoteWorkspaceId, syncSharedNote } from '@/utils/sync/shared-notes.js';
import { useNoteStore } from '@/store/note';
import { upsertSearchEntry } from '@/utils/note/search.js';
import { speed } from '@/utils/speed.js';

export { registerActiveDoc, applyRemote } from '@/lib/yjs/shared.js';
import { registerActiveDoc, unregisterActiveDoc, getActiveDoc } from '@/lib/yjs/shared.js';

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

/**
 * Flat plain text of a Yjs XML fragment, for the search index. Cheap string
 * walk — no ProseMirror conversion.
 */
function yFragmentPlainText(fragment) {
  const parts = [];
  const walk = (node) => {
    if (node instanceof Y.XmlText) {
      parts.push(node.toString());
    } else if (
      node instanceof Y.XmlElement ||
      node instanceof Y.XmlFragment
    ) {
      for (const child of node.toArray()) walk(child);
    }
  };
  walk(fragment);
  return parts.join(' ');
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

// Background jobs (compaction, key provisioning) must not start while a note is
// still loading: they take the SQLite write lock and the crypto/cloud IPC queue
// and turn a ~0.5s open into seconds. Run them once the UI is idle instead.
function whenIdle(fn, timeout = 2000) {
  if (typeof window !== 'undefined' && typeof window.requestIdleCallback === 'function') {
    return window.requestIdleCallback(fn, { timeout });
  }
  return setTimeout(fn, timeout);
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

// Load Yjs state: chunk fast path when the index is current, else snapshot
// first (O(1)), else replay updates. Returns the Y.Doc the caller should use
// — normally `newDoc`, but a fresh doc if applying a corrupt snapshot
// partially mutated it (the replay path needs a clean state).
async function loadStateIntoDoc(newDoc, noteId) {
  const t = speed('yjs_load_snapshot');
  // Fast path: a current chunk index serves content from parallel per-chunk
  // snapshot reads, skipping the multi-MB base snapshot decode. Any probe
  // failure or missing slot falls through to the legacy path below, which is
  // always correct (the base log remains the source of truth).
  try {
    const manifest = await readManifest(noteId);
    if (manifest) {
      // Read the cheap version first: it is captured before the state-vector
      // probe, so an append landing during the probe leaves the recorded
      // version behind the stored one (stale index, not a missing edit).
      const contentVersion = await getContentVersion(noteId);
      const legacy = typeof manifest.contentVersion !== 'number';
      const storedSv = legacy ? await getStateVector(noteId) : null;
      if (planOpenPath({ manifest, storedStateVector: storedSv, contentVersion }) === 'chunks') {
        if (legacy) void upgradeManifestVersion(noteId, manifest, contentVersion);
        // Load only the first chunk initially — enough for the visible viewport
        // with virtualization. Off-screen chunks load in the background after
        // first paint, and on-demand when placeholders materialize.
        const firstSlot = manifest.chunks[0]?.key;
        const loaded = firstSlot
          ? await loadChunksIntoDoc(noteId, manifest, newDoc, [firstSlot])
          : false;
        // Serve from chunks only when content actually arrived: an index can
        // be watermark-current yet describe an empty document (e.g. rebuilt
        // after a wipe); returning here would also skip the caller's
        // initialContent seed and permanently block content restoration.
        if (loaded && newDoc.getXmlFragment('content').length > 0) {
          const title = newDoc.getText('title');
          if (title.length === 0 && manifest.title) {
            // Origin 'load' keeps the mirror out of the persistence buffer —
            // the authoritative title already lives in the base log.
            newDoc.transact(() => title.insert(0, String(manifest.title)), 'load');
          }
          t?.end();
          // Background-load remaining chunks after first paint so the Y.Doc is
          // complete before the user scrolls far. Never blocks first render.
          void loadRemainingChunks(noteId, manifest, newDoc, firstSlot);
          return newDoc;
        }
      }
    }
  } catch (err) {
    console.warn('[yjs] chunk fast path unavailable, using full load:', err?.message);
  }
  let snapshotWasCorrupt = false;
  let activeDoc = newDoc;
  try {
    const snapshot = await getSnapshot(noteId);
    if (snapshot && snapshot.length > 0) {
      const bytes = toUint8Array(snapshot);
      try {
        Y.applyUpdate(activeDoc, bytes);
        t?.end();
        return activeDoc;
      } catch (err) {
        snapshotWasCorrupt = true;
        console.error(`[yjs] Failed to apply snapshot for ${noteId}:`, err);
        // applyUpdate may have partially mutated the doc; use a fresh doc for
        // the replay path below so updates are applied from a clean state.
        activeDoc.destroy();
        activeDoc = new Y.Doc();
      }
    }
  } catch (err) {
    // Snapshot decode failed: repair cached copy after replay.
    snapshotWasCorrupt = true;
    console.error(`[yjs] Failed to load snapshot for ${noteId}:`, err);
  }

  try {
    const updates = await getUpdates(noteId);
    applyUpdatesToDoc(activeDoc, updates);
  } catch (err) {
    console.error(`[yjs] Failed to load updates for ${noteId}:`, err);
  }

  // Repair a corrupt cached snapshot so the decode error doesn't re-trigger on
  // every open. Best-effort: failure just means falling back again next time.
  // Rust merges stored rows in place; no snapshot bytes cross IPC.
  if (snapshotWasCorrupt && activeDoc.store) {
    try {
      await compactNote(noteId);
    } catch (repairErr) {
      console.warn(`[yjs] could not repair snapshot for ${noteId}:`, repairErr);
    }
  }
  t?.end();
  return activeDoc;
}

// Background-load the remaining (off-screen) chunk slots after first paint.
// Never blocks first render: yields to the event loop, then fetches chunks
// that weren't included in the initial lazy load. Applied to the same Y.Doc
// so ProseMirror receives them as normal Yjs update events and materializes
// placeholders as they scroll into view.
//
// Chunks are applied in small batches with yields between batches so the
// main thread stays responsive: each Y.applyUpdate triggers a ProseMirror
// re-render, and applying all 14 chunks at once blocks the UI for seconds.
async function loadRemainingChunks(noteId, manifest, targetDoc, firstSlot) {
  const remainingSlots = manifest.chunks
    .map((c) => c.key)
    .filter((k) => k !== firstSlot);
  if (remainingSlots.length === 0) return;
  // Yield so first paint completes before contending for the SQLite lock and
  // the crypto/cloud IPC queue.
  await new Promise((resolve) => setTimeout(resolve, 0));
  try {
    await loadChunksIntoDoc(noteId, manifest, targetDoc, remainingSlots);
  } catch (err) {
    console.warn('[yjs] background chunk load failed:', err?.message);
  }
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
  // Set by onUnmounted. loadGeneration is per instance, so on its own an
  // unmounted instance could still resume its in-flight load and register an
  // orphan doc over the one a remounted page owns.
  let disposed = false;

  // Buffered deltas are keyed by note id, not by the currently displayed note:
  // a failed/queued flush from note A must never be persisted to note B after
  // a switch.
  const pendingByNote = new Map();
  let flushTimer = null;
  let retryTimer = null;
  let lastCompactAt = Date.now();
  let updatesSinceCompact = 0;

  // Chunk index rebuild (item 7): idle-refresh the derived chunk slots after
  // persistence settles so the NEXT open of a huge note takes the fast path.
  // Single-flight, note-switch aware, and skipped for small docs.
  let rebuildTimer = null;
  let rebuilding = false;

  function scheduleChunkRebuild() {
    if (rebuildTimer) {
      clearTimeout(rebuildTimer);
    }
    const run = () => {
      rebuildTimer = null;
      const noteId = currentNoteId;
      const docRef = currentDoc;
      if (disposed || !noteId || !docRef) return;
      void runChunkRebuild(noteId, docRef);
    };
    // Start on the next tick rather than waiting for an idle period, so the
    // chunk index is refreshed promptly after a save and is current by the next
    // open. The rebuild is incremental (yields between chunks) and skips when
    // the index is already current, so it never blocks the UI or does
    // redundant work.
    rebuildTimer = setTimeout(run, 0);
  }

  async function runChunkRebuild(noteId, docRef) {
    if (rebuilding) return;
    rebuilding = true;
    try {
      if (!shouldChunkDoc(docRef)) return;
      await new Promise((resolve) => setTimeout(resolve, 0)); // yield to the UI first
      const previous = await readManifest(noteId);
      if (previous) {
        // Index already reflects the stored state (no edits since the last
        // rebuild): redoing O(document) work would produce identical chunks.
        const contentVersion = await getContentVersion(noteId);
        const storedSv =
          typeof previous.contentVersion === 'number' ? null : await getStateVector(noteId);
        if (
          planOpenPath({ manifest: previous, storedStateVector: storedSv, contentVersion }) ===
          'chunks'
        ) {
          return;
        }
      }
      await rebuildChunkIndex(noteId, docRef, { previousManifest: previous });
    } catch (err) {
      console.warn('[yjs] chunk index rebuild failed:', err?.message);
    } finally {
      rebuilding = false;
    }
  }

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

      // Keep the search index in sync with the Yjs content — persistUpdate only
      // writes updates to storage; without this, content edits were invisible
      // to search (note.searchText stayed empty for Yjs-backed notes).
      if (id === currentNoteId && currentDoc) {
        try {
          const text = yFragmentPlainText(currentDoc.getXmlFragment('content'));
          const noteStore = useNoteStore();
          const note = noteStore.data?.[id];
          if (note && text !== note.searchText) {
            note.searchText = text;
            note.updatedAt = Date.now();
            upsertSearchEntry(note);
            const { syncNoteMeta } = await import('@/lib/yjs/workspace-doc.js');
            syncNoteMeta(note);
          }
        } catch (err) {
          console.warn('[yjs] search index update failed:', err);
        }
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
      // Persistence settled for the open note: queue an idle chunk-index
      // refresh so the next open skips the whole-doc decode (huge docs only;
      // the rebuild gate checks size itself).
      if (id === currentNoteId && currentDoc) scheduleChunkRebuild();
    }
  }

  const flushHandler = () => flushPendingUpdates();
  flushHandlers.add(flushHandler);

  // Unregister / leave the room / destroy the active doc. Idempotent.
  // `deferCompact` moves the Rust merge of the outgoing note out of a note
  // switch: it rewrites the whole content blob and would hold the DB while the
  // incoming note is still reading its chunks.
  function teardownActiveDoc({ deferCompact = false } = {}) {
    const oldDoc = currentDoc;
    const oldNoteId = currentNoteId;
    currentDoc = null;
    currentNoteId = null;
    if (!oldDoc) return;
    if (oldNoteId) {
      // Fire-and-forget Rust merge; pending was flushed before the switch.
      const compact = () =>
        compactNote(oldNoteId).catch(() => {
          // non-critical
        });
      if (deferCompact) whenIdle(compact);
      else compact();
      // Unmount awaits a flush, so a later mount of the same note can register
      // its doc while this instance is suspended. Only give up the shared entry
      // if it is still ours; otherwise the live editor would silently stop
      // receiving remote updates — and leaveNoteRoom destroys the room's
      // provider, which would kill the one the remounted page just joined.
      const active = getActiveDoc(oldNoteId);
      if (!active || active === oldDoc) {
        unregisterActiveDoc(oldNoteId);
        getWsSync().leaveNoteRoom(oldNoteId);
      }
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
    const isStale = () => disposed || generation !== loadGeneration;

    // Reset up front so a stale `true` from a previous note can't leak into
    // this one if key resolution throws before the result is applied.
    pendingSetup.value = false;
    ready.value = false;

    // Flush pending updates for the *previous* note before switching.
    if (flushTimer) {
      clearTimeout(flushTimer);
      flushTimer = null;
    }
    const tFlush = speed('yjs_load_note_flush');
    await flushPendingUpdates();
    tFlush?.end();
    if (isStale()) {
      t?.end();
      return;
    }

    const tTeardown = speed('yjs_load_note_teardown');
    teardownActiveDoc({ deferCompact: true });
    tTeardown?.end();

    const newDoc = new Y.Doc();

    const activeDoc = await loadStateIntoDoc(newDoc, noteId);
    if (isStale()) {
      activeDoc.destroy();
      t?.end();
      return;
    }

    // Still empty after replay (fresh or corrupt snapshot): seed from store.
    const frag = activeDoc.getXmlFragment('content');
    if (frag.length === 0 && initialContent) {
      try {
        await seedFromTipJson(activeDoc, initialContent, noteId);
        const snapshot = Y.encodeStateAsUpdate(activeDoc);
        await compactUpdates(noteId, snapshot);
      } catch (e) {
        console.error('[yjs] seeding also failed:', e);
      }
    }
    if (isStale()) {
      activeDoc.destroy();
      t?.end();
      return;
    }

    // Yjs single-type-per-key: probe share before claiming the key as YText or
    // XmlFragment. Legacy docs store title as XmlFragment; new code uses YText.
    // Claiming the wrong type first corrupts the value (length mismatch) and
    // throws on the second accessor.
    const existing = activeDoc.share.get('title');
    if (existing instanceof Y.XmlFragment) {
      let seed = '';
      try {
        const frag = activeDoc.getXmlFragment('title');
        seed = frag.toJSON() || '';
        if (!seed) {
          try { seed = frag.get(0)?.toString() || ''; } catch {}
        }
      } catch (e) {
        console.warn('[yjs] legacy title migration failed to extract seed:', e);
      }
      try {
        activeDoc.share.delete('title');
      } catch (e) {
        console.warn('[yjs] failed to delete legacy title key:', e);
      }
      if (seed) {
        try {
          // Authored under this doc's own clientID so a later title edit on
          // either device can delete it, same as any typed title.
          activeDoc.transact(() => activeDoc.getText('title').insert(0, seed), 'local');
        } catch (e) {
          console.warn('[yjs] failed to migrate legacy title to YText:', e);
        }
      }
    }
    // The store/meta title is NOT seeded into the collaborative Y.Text here.
    // The title is carried by the workspace meta doc; the first real edit goes
    // through applyTitleDelta, which authors it as a normal diff.

    activeDoc.on('update', (update, origin, _doc, transaction) => {
      if (origin === 'load' || origin === 'sync' || origin === 'ws-relay') return;
      // Remote transactions are already persisted in note_content by the native
      // pull path; re-appending them here echoes them back to the server.
      if (!transaction?.local) return;
      if (isStale()) return;
      // Never drop a local edit while the shared key is unresolved: the note is
      // editable under the items key and self-heals to the shared key when the
      // background recovery lands (L9 — no silent read-only lockout).
      enqueueUpdate(noteId, update);
      scheduleFlush();
    });

    // Activate the doc before key recovery: a durable snapshot that lands
    // while the key is still in flight must apply into the live doc (buffered
    // updates replay on register) instead of parking behind an empty editor
    // until the next open. Edits stay local meanwhile via pendingSetup.
    pendingSetup.value = true;
    if (isStale()) {
      activeDoc.destroy();
      t?.end();
      return;
    }
    currentNoteId = noteId;
    currentDoc = activeDoc;
    registerActiveDoc(noteId, activeDoc);
    doc.value = activeDoc;
    ready.value = true;
    // A read-only open never flushes, so without this the chunk index would
    // only ever build after an edit. The rebuild skips itself when the index
    // is already current (runChunkRebuild), keeping small docs untouched.
    scheduleChunkRebuild();

    let noteKeyHex = null;
    const refreshSharedContent = async () => {
      // Re-pull once the note key resolves, shared or not: a first-open pull
      // that ran before the key landed could not decrypt, and nothing else
      // knows that the key exists now.
      try {
        const { useAccountStore } = await import('@/store/account');
        const accountStore = useAccountStore();
        await syncSharedNote(noteId, {
          serverUrl: accountStore.serverUrl || '',
          token: accountStore.token || '',
        });
      } catch (err) {
        console.warn('[yjs] shared-note refresh after key skipped:', err?.message || err);
      }
    };
    // Server-bound provisioning (key distribution + shared re-pull) must not
    // hold the open hostage: crypto + sync:cloud-note Tauri IPC ran ~3s per
    // open, and it contends with the load for the DB and the IPC queue. It is
    // started on idle below. The onKeyResolved callback re-keys the room and
    // re-pulls once the key lands; pendingSetup stays advisory-only and never
    // gates editing.
    const workspaceStore = useWorkspaceStore();
    const sharing = useNoteSharing();
    const onKeyResolved = async (hex) => {
      if (!hex || isStale()) return;
      pendingSetup.value = false;
      const ownerId = resolveNoteWorkspaceId(noteId, workspaceStore.activeId);
      if (ownerId) {
        await setRoomKey(`workspace:${ownerId}:note:${noteId}`, hex);
      }
      await refreshSharedContent();
    };
    const tProvision = speed('yjs_load_note_provision');
    // Deferred like compaction: crypto + cloud IPC must not compete with the
    // load or the editor build. pendingSetup stays advisory-only either way.
    // Use setTimeout(0) so provisioning starts on the next tick instead of
    // waiting up to 2s for requestIdleCallback idle (actual work is only
    // ~20-80ms of crypto + IPC).
    setTimeout(() => {
      void sharing.ensureNoteKey(noteId, { backgroundRetry: true, onKeyResolved }).then((hex) => {
        noteKeyHex = hex;
        const ownerId = resolveNoteWorkspaceId(noteId, workspaceStore.activeId);
        if (noteKeyHex && ownerId) {
          void setRoomKey(`workspace:${ownerId}:note:${noteId}`, noteKeyHex);
        }
        if (noteKeyHex) {
          void refreshSharedContent();
        }
        tProvision?.end();
      }).catch((err) => {
        console.warn('[yjs] note-key provisioning skipped:', err);
        tProvision?.end();
      });
    }, 0);
    // Provisioning is fire-and-forget: it starts once the UI is idle and
    // continues in the background. The editor must not wait on it — a missing
    // key is advisory only, it never gates editing or persistence.
    pendingSetup.value = applyNoteKeyResult(noteKeyHex);
    if (isStale()) {
      if (currentDoc === activeDoc) teardownActiveDoc({ deferCompact: true });
      else activeDoc.destroy();
      t?.end();
      return;
    }

    // Room join (with awareness) is owned by the page watcher (per-doc awareness guard).
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
  // A Yjs seed under a fixed clientID is insert-only and can never converge, so
  // the title is only ever authored as a normal client-authored diff.
  // ponytail: exported for test
  function applyTitleDelta(next) {
    if (!currentDoc) return;
    const ytext = currentDoc.getText('title');
    const prev = ytext.toString();
    const n = next ?? '';
    if (prev === n) return;
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
    // Retire this instance before the flush await: a load still in flight must
    // not register an orphan doc once teardown returns.
    disposed = true;
    loadGeneration++;
    flushHandlers.delete(flushHandler);
    // Flush buffered updates before compacting.
    if (flushTimer) {
      clearTimeout(flushTimer);
      flushTimer = null;
    }
    if (rebuildTimer) {
      clearTimeout(rebuildTimer);
      rebuildTimer = null;
    }
    if (retryTimer) {
      clearTimeout(retryTimer);
      retryTimer = null;
    }
    removeLifecycleFlush?.();
    removeLifecycleFlush = null;
    // Retire the doc BEFORE the flush await. The flush retries, sleeps 200ms and
    // can compact; for that whole window this dying doc was still the registry's
    // answer for the note id, so remote updates were applied to a doc nobody can
    // see. `flushPendingUpdates` works off its own per-note buffer, not the doc,
    // so it stays correct after teardown.
    teardownActiveDoc();
    await flushPendingUpdates();
  });

  return { doc, ready, pendingSetup, load, getTitle, setTitle, observeTitle, applyTitleDelta };
}
