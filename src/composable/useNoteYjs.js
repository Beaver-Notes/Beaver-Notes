import * as Y from 'yjs';
import { ref, shallowRef, onUnmounted } from 'vue';
import {
  appendUpdate,
  getUpdates,
  getSnapshot,
  compactUpdates,
} from '@/lib/native/yjs.js';
import { getCommitsDir } from '@/utils/sync/sync-repository.js';
import { queueSyncWrite } from '@/utils/sync/pending-writes.js';
import {
  getDeviceId,
  applyUpdatesToDoc,
  toUint8Array,
  ensureSchema,
} from '@/lib/yjs/helpers.js';
import { getWsSync, setRoomKey } from '@/lib/sync/ws-sync.js';
import { useNoteSharing } from './useNoteSharing.js';
import { useWorkspaceStore } from '@/store/workspace';
import { speed } from '@/utils/speed.js';

export { registerActiveDoc, applyRemote } from '@/lib/yjs/shared.js';
import { registerActiveDoc, unregisterActiveDoc } from '@/lib/yjs/shared.js';

const MAX_WRITE_RETRIES = 3;
const WRITE_RETRY_DELAY_MS = 200;

// Maps note-key resolution to the per-note "setting up on this device" UI
// flag. Pure + exported for unit testing without the lifecycle-bound composable.
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

async function seedFromTipJson(ydoc, contentJson) {
  const { prosemirrorJSONToYDoc } = await import('@tiptap/y-tiptap');
  const schema = await ensureSchema();
  const tempYdoc = prosemirrorJSONToYDoc(schema, contentJson, 'content');
  const update = Y.encodeStateAsUpdate(tempYdoc);
  Y.applyUpdate(ydoc, update);
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
    // Snapshot decode failed — repair the cached copy after replaying updates.
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
  if (snapshotWasCorrupt && newDoc.store) {
    try {
      const rebuilt = Y.encodeStateAsUpdate(newDoc);
      if (rebuilt.byteLength > 0) {
        await compactUpdates(noteId, rebuilt);
      }
    } catch (repairErr) {
      console.warn(`[yjs] could not repair snapshot for ${noteId}:`, repairErr);
    }
  }
  t?.end();
}

  // Persist a Yjs update to SQLite and optionally queue it for the sync folder.
async function persistUpdate(noteId, update) {
  if (!noteId || !update || update.byteLength === 0) return;
  try {
    await retryWrite(
      () => appendUpdate(noteId, update, getDeviceId()),
      `SQLite appendUpdate for ${noteId}`
    );
  } catch {
    //
  }
  try {
    const commitsDir = await getCommitsDir();
    if (commitsDir) {
      queueSyncWrite(commitsDir, noteId, update);
    }
  } catch {
    //
  }
}

const FLUSH_DELAY_MS = 300;

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

  let pendingUpdates = [];
  let flushTimer = null;
  let lastCompactAt = Date.now();
  let updatesSinceCompact = 0;

  function scheduleFlush() {
    if (flushTimer) clearTimeout(flushTimer);
    flushTimer = setTimeout(() => {
      flushTimer = null;
      flushPendingUpdates();
    }, FLUSH_DELAY_MS);
  }

  async function flushPendingUpdates() {
    if (pendingUpdates.length === 0) return;
    const updates = pendingUpdates.splice(0);
    updatesSinceCompact += updates.length;
    const merged = Y.mergeUpdates(updates);
    await persistUpdate(currentNoteId, merged);

    // Fold accumulated history into a single snapshot row when due.
    const due =
      Date.now() - lastCompactAt > COMPACT_INTERVAL_MS ||
      updatesSinceCompact >= COMPACT_UPDATE_THRESHOLD;
    if (due && currentDoc) {
      try {
        const snapshot = Y.encodeStateAsUpdate(currentDoc);
        if (snapshot.byteLength > 0) {
          await compactUpdates(currentNoteId, snapshot);
        }
        lastCompactAt = Date.now();
        updatesSinceCompact = 0;
      } catch (err) {
        console.warn('[yjs] periodic compact failed, retrying later:', err);
      }
    }
  }

  async function load(noteId, initialContent, initialTitle) {
    const t = speed('yjs_load_note');
    // Reset up front so a stale `true` from a previous note can't leak into
    // this one if key resolution throws before the result is applied.
    pendingSetup.value = false;

    // Flush pending updates for the *previous* note before switching.
    if (flushTimer) {
      clearTimeout(flushTimer);
      flushTimer = null;
    }
    await flushPendingUpdates();

    if (currentDoc && currentNoteId) {
      try {
        const snapshot = Y.encodeStateAsUpdate(currentDoc);
        if (snapshot.byteLength > 0) {
          // Don't block the switch on the old note's compact; snapshot is
          // captured before destroy and compaction runs off-thread in Rust.
          compactUpdates(currentNoteId, snapshot).catch(() => {
            // non-critical
          });
        }
      } catch {
        // non-critical
      }
      unregisterActiveDoc(currentNoteId);
      getWsSync().leaveNoteRoom(currentNoteId);
      currentDoc.destroy();
    }

    currentNoteId = noteId;
    const newDoc = new Y.Doc();

    await loadStateIntoDoc(newDoc, noteId);

    // Still empty after replay (fresh note or stale/corrupt snapshot) — seed
    // from store content.
    const frag = newDoc.getXmlFragment('content');
    if (frag.length === 0 && initialContent) {
      try {
        await seedFromTipJson(newDoc, initialContent);
        const snapshot = Y.encodeStateAsUpdate(newDoc);
        await compactUpdates(noteId, snapshot);
      } catch (e) {
        console.error('[yjs] seeding also failed:', e);
      }
    }

    // Yjs single-type-per-key: probe share before claiming the key as YText or XmlFragment.
    // Legacy docs store title as XmlFragment; new code uses YText. Claiming the wrong
    // type first corrupts the value (length mismatch) and throws on the second accessor.
    let ytext;
    const existing = newDoc.share.get('title');
    if (existing) {
      const start = existing._start;
      const content = start?.content;
      const isLegacyXml = content && content.constructor && content.constructor.name === 'ContentType';
      if (isLegacyXml) {
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
        try {
          ytext = newDoc.getText('title');
          if (seed) {
            newDoc.transact(() => ytext.insert(0, seed), 'migrate');
          }
        } catch (e) {
          console.warn('[yjs] failed to migrate legacy title to YText:', e);
          ytext = newDoc.getText('title');
        }
      } else {
        try {
          ytext = newDoc.getText('title');
        } catch (e) {
          console.warn('[yjs] failed to get YText title:', e);
          ytext = newDoc.getText('title');
        }
      }
    } else {
      ytext = newDoc.getText('title');
    }
    // seed if both empty
    if (ytext.length === 0 && initialTitle) {
      try {
        newDoc.transact(() => ytext.insert(0, initialTitle), 'load');
      } catch (e) {
        console.warn('[yjs] failed to seed title:', e);
      }
    }

    newDoc.on('update', (update, origin) => {
      if (origin === 'load' || origin === 'sync' || origin === 'ws-relay') return;
      pendingUpdates.push(update);
      scheduleFlush();
    });

      try {
        const workspaceStore = useWorkspaceStore();
        const sharing = useNoteSharing();
        const noteKeyHex = await sharing.ensureNoteKey(noteId);
        if (noteKeyHex && workspaceStore.activeId) {
          const roomName = `workspace:${workspaceStore.activeId}:note:${noteId}`;
          await setRoomKey(roomName, noteKeyHex);
        }
      } catch (err) {
        console.warn('[yjs] note-key provisioning skipped:', err);
      }
    // Register in the global active-docs map so that WS updates are applied.
    // Room join (with awareness) is owned by the page watcher (per-doc awareness guard).
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
    // Flush buffered updates before compacting.
    if (flushTimer) {
      clearTimeout(flushTimer);
      flushTimer = null;
    }
    await flushPendingUpdates();

    if (currentDoc && currentNoteId) {
      try {
        const snapshot = Y.encodeStateAsUpdate(currentDoc);
        if (snapshot.byteLength > 0) {
          compactUpdates(currentNoteId, snapshot).catch(() => {
            // non-critical
          });
        }
      } catch {
        // non-critical
      }
      unregisterActiveDoc(currentNoteId);
      getWsSync().leaveNoteRoom(currentNoteId);
      currentDoc.destroy();
    }
  });

  return { doc, ready, pendingSetup, load, getTitle, setTitle, observeTitle, applyTitleDelta };
}
