import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import { ySyncPluginKey } from '@tiptap/y-tiptap';
import * as Y from 'yjs';
import { getColorFromId } from '@/composable/usePresence';
import {
  computeVersionChanges,
  revertReviewChange,
} from '../version-preview/index.js';

export const liveCollabKey = new PluginKey('liveCollab');

// How long a remote highlight stays before it fades out. Long enough to notice
// a peer's edit while your own typing continues, short enough that the page
// does not accumulate stale tints (Google Docs tints persist only while the
// edit is fresh).
export const LIVE_COLLAB_FADE_MS = 4000;
// Typing burst window: remote edits within this gap extend the same highlight
// (one baseline, one chip) instead of replacing it.
export const LIVE_COLLAB_COALESCE_MS = 250;
// Activity entries coalesce on the same window as the tint, so one typing burst
// becomes one durable log row instead of one per keystroke.
export const LIVE_COLLAB_ACTIVITY_DEBOUNCE_MS = LIVE_COLLAB_COALESCE_MS;
export const LIVE_COLLAB_NEUTRAL_COLOR = '#9ca3af';
export const LIVE_COLLAB_FALLBACK_NAME = 'someone';
// A deletion with no single attributable actor is honestly "a collaborator",
// never a guess at which peer did it.
export const LIVE_COLLAB_DELETION_FALLBACK_NAME = 'a collaborator';
// `summary`/`anchorHint` stay a clipped snippet: the log is a human-readable
// breadcrumb, never a copy of the document body.
export const ACTIVITY_SUMMARY_MAX = 80;

// The only object transaction origins in the app are the local y-sync plugin
// key and the WebsocketProvider instance. Everything else object-shaped is a
// live relay; strings ('load' | 'sync' | 'ws-relay' | 'local' | 'seed') and
// null/undefined are local or the async/banner path.
export function isRemoteLiveOrigin(origin) {
  if (origin == null || typeof origin === 'string') return false;
  if (origin === ySyncPluginKey) return false;
  if (origin instanceof Y.UndoManager) return false;
  return true;
}

// Activity logging follows the same origin split as the tint, except bootstrap
// and offline catch-up replays must never be logged as user edits: strings carry
// no author and would flood the log with the note's whole history on open.
export function shouldRecordActivityOrigin(origin) {
  return typeof origin !== 'string' && origin != null;
}

export function classifyActivityKind(changes) {
  let inserted = false;
  let deleted = false;
  for (const change of changes) {
    if (change.toB > change.fromB) inserted = true;
    if (change.deleted?.length) deleted = true;
  }
  if (inserted && deleted) return 'replace';
  if (deleted) return 'delete';
  return 'insert';
}

export function clipActivitySummary(text) {
  const clean = String(text || '').replace(/\s+/g, ' ').trim();
  return clean.length > ACTIVITY_SUMMARY_MAX
    ? `${clean.slice(0, ACTIVITY_SUMMARY_MAX)}…`
    : clean;
}

// Union of the burst's changed ranges; deletions name the removed text (from
// the baseline), everything else names the new text.
export function activitySummary(kind, changes, baselineDoc, currentDoc) {
  if (!changes.length) return '';
  if (kind === 'delete') {
    const from = Math.min(...changes.map((c) => c.fromA));
    const to = Math.max(...changes.map((c) => c.toA));
    return clipActivitySummary(baselineDoc.textBetween(from, to, ' '));
  }
  const from = Math.min(...changes.map((c) => c.fromB));
  const to = Math.max(...changes.map((c) => c.toB));
  return clipActivitySummary(currentDoc.textBetween(from, to, ' '));
}

function makeActivityId() {
  try {
    if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  } catch {
    // Non-secure context: fall through to a non-cryptographic id, which is
    // only ever used as a dedupe key/client-side marker, never for auth.
  }
  return `act-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

// Insertions are exact: a client whose clock advanced in this transaction
// authored the new structs. A pure deletion leaves afterState unchanged, so
// this returns nothing for it — callers must NOT fall back to the deleted
// structs' clients, which are the deleted text's authors, not the deleter.
export function collectChangedClientIds(transaction) {
  const ids = new Set();
  const after = transaction?.afterState;
  if (after) {
    const before = transaction.beforeState;
    after.forEach((clock, client) => {
      if (clock > (before?.get(client) || 0)) ids.add(client);
    });
  }
  return ids;
}

function neutralAuthor() {
  return {
    id: null,
    name: LIVE_COLLAB_FALLBACK_NAME,
    color: LIVE_COLLAB_NEUTRAL_COLOR,
  };
}

// Same colour source as the cursor and avatar: awareness `user.color`, falling
// back to the id-derived colour. Unresolvable author → neutral + "someone".
export function resolveLiveAuthor(clientIds, awareness) {
  const states = awareness?.getStates?.();
  if (states) {
    for (const clientId of clientIds) {
      const user = states.get(clientId)?.user;
      if (!user) continue;
      return {
        id: user.id || null,
        name: user.name || LIVE_COLLAB_FALLBACK_NAME,
        color: user.color || getColorFromId(user.id) || LIVE_COLLAB_NEUTRAL_COLOR,
      };
    }
  }
  return neutralAuthor();
}

// Local edits are authored by the cursor's own awareness state (set by
// CollaborationCursor from the account profile).
export function resolveLocalAuthor(awareness) {
  const user = awareness?.getLocalState?.()?.user;
  if (!user) {
    return {
      id: null,
      name: 'You',
      color: getColorFromId('local') || LIVE_COLLAB_NEUTRAL_COLOR,
    };
  }
  return {
    id: user.id || null,
    name: user.name || 'You',
    color: user.color || getColorFromId(user.id) || LIVE_COLLAB_NEUTRAL_COLOR,
  };
}

// Yjs records no deleter: the transaction's changed structs belong to the
// deleted text, so mapping them would blame the deleted author. The only live
// signal left is presence — with exactly one remote peer in the room they must
// be the actor; with several (or none) the actor is genuinely unknown, so the
// label is the honest "a collaborator" rather than a wrong name.
// ponytail: presence heuristic; swap for a per-message peer id if the relay
// ever carries one.
function resolveLiveDeletionActor(awareness) {
  const states = awareness?.getStates?.();
  const remoteIds = new Set();
  if (states) {
    const localId = awareness?.clientID;
    states.forEach((state, clientId) => {
      if (clientId === localId) return;
      if (state?.user) remoteIds.add(clientId);
    });
  }
  if (remoteIds.size !== 1) {
    return {
      id: null,
      name: LIVE_COLLAB_DELETION_FALLBACK_NAME,
      color: LIVE_COLLAB_NEUTRAL_COLOR,
    };
  }
  return resolveLiveAuthor(remoteIds, awareness);
}

function createLiveChip(editor, record) {
  const wrap = document.createElement('span');
  wrap.className = 'live-collab-chip';
  wrap.contentEditable = 'false';
  wrap.style.setProperty('--live-collab-color', record.color);

  const label = document.createElement('span');
  label.className = 'live-collab-chip__label';
  label.textContent = `${record.name} edited this`;
  wrap.append(label);

  const undo = document.createElement('button');
  undo.type = 'button';
  undo.className = 'live-collab-chip__undo';
  undo.textContent = 'Undo';
  undo.addEventListener('mousedown', (event) => event.preventDefault());
  undo.addEventListener('click', (event) => {
    event.preventDefault();
    try {
      // Fail safe: revertReviewChange returns false and touches nothing when the
      // change no longer matches; the chip is removed either way.
      revertReviewChange(editor, record.baseline, record.target);
    } finally {
      editor.commands.clearLiveCollab?.();
    }
  });

  wrap.append(undo);
  return wrap;
}

function buildLiveDecorations(state, editor) {
  const record = liveCollabKey.getState(state);
  if (!record?.changes?.length || !record.target) return null;
  const decorations = [];
  for (const change of record.changes) {
    if (change.toB > change.fromB) {
      decorations.push(
        Decoration.inline(change.fromB, change.toB, {
          class: 'live-collab-added',
          style: `--live-collab-color:${record.color}`,
        })
      );
    }
  }
  decorations.push(
    Decoration.widget(
      record.target.fromB,
      () => createLiveChip(editor, record),
      { side: -1, key: 'live-collab-chip' }
    )
  );
  return DecorationSet.create(state.doc, decorations);
}

const LiveCollab = Extension.create({
  name: 'liveCollab',

  addOptions() {
    return { awareness: null, noteId: '', onActivity: null };
  },

  addCommands() {
    return {
      setLiveCollab:
        (record) =>
        ({ tr, dispatch }) => {
          if (dispatch) tr.setMeta(liveCollabKey, { type: 'set', record });
          return true;
        },
      clearLiveCollab:
        () =>
        ({ tr, dispatch }) => {
          if (dispatch) tr.setMeta(liveCollabKey, { type: 'clear' });
          return true;
        },
    };
  },

  addProseMirrorPlugins() {
    const editor = this.editor;
    const awareness = this.options.awareness;
    return [
      new Plugin({
        key: liveCollabKey,
        state: {
          init: () => null,
          apply(tr, value) {
            const meta = tr.getMeta(liveCollabKey);
            if (meta?.type === 'clear') return null;
            if (meta?.type === 'set') return meta.record;
            // A real user/programmatic edit (not the y-sync echo) clears the
            // highlight immediately; the echo carries isChangeOrigin.
            if (
              tr.docChanged &&
              !tr.getMeta(ySyncPluginKey)?.isChangeOrigin
            ) {
              return null;
            }
            return value;
          },
        },
        props: {
          decorations: (state) => buildLiveDecorations(state, editor),
        },
        view: (view) => {
          const sync = ySyncPluginKey.getState(view.state);
          const ydoc = sync?.doc;
          if (!ydoc) return {};
          const options = this.options;

          let lastDoc = view.state.doc;
          let fadeTimer = null;
          let activityBatch = null;
          let activityTimer = null;
          let activityArmed = false;
          // The first transaction after the view mounts is the Y.Doc → editor
          // hydration of the note's existing content, not a user edit. Arm
          // recording on the next macrotask so opening a note never logs it.
          const armTimer = setTimeout(() => {
            activityArmed = true;
          }, 0);

          const clearFadeTimer = () => {
            if (fadeTimer) {
              clearTimeout(fadeTimer);
              fadeTimer = null;
            }
          };

          const clearActivityTimer = () => {
            if (activityTimer) {
              clearTimeout(activityTimer);
              activityTimer = null;
            }
          };

          const flushActivity = () => {
            activityTimer = null;
            const batch = activityBatch;
            activityBatch = null;
            if (!batch || typeof options.onActivity !== 'function') return;
            try {
              const changes = computeVersionChanges(batch.baseline, batch.doc);
              if (!changes.length) return;
              const kind = classifyActivityKind(changes);
              const summary = activitySummary(
                kind,
                changes,
                batch.baseline,
                batch.doc
              );
              options.onActivity({
                entry: {
                  id: makeActivityId(),
                  noteId: options.noteId || '',
                  actorId: batch.author.id,
                  actorLabel: batch.author.name,
                  kind,
                  summary,
                  at: batch.at,
                  anchorHint: summary,
                },
                baseline: batch.baseline,
                target: changes[0],
              });
            } catch {
              // Logging must never break editing.
            }
          };

          const recordActivity = (origin, before, after, transaction) => {
            if (!activityArmed || typeof options.onActivity !== 'function') {
              return;
            }
            if (!shouldRecordActivityOrigin(origin)) return;
            // A Y transaction that added neither structs nor delete-set entries
            // is a sync echo, not an edit: recording it would overwrite the
            // real author of the burst with the local user.
            const inserted = collectChangedClientIds(transaction);
            const removed = transaction?.deleteSet?.clients?.size > 0;
            if (!inserted.size && !removed) return;
            let author;
            if (isRemoteLiveOrigin(origin)) {
              author = inserted.size
                ? resolveLiveAuthor(inserted, awareness)
                : resolveLiveDeletionActor(awareness);
            } else {
              author = resolveLocalAuthor(awareness);
            }
            const now = Date.now();
            const sameBatch =
              activityBatch != null &&
              now - activityBatch.at <= LIVE_COLLAB_COALESCE_MS;
            const baseline = sameBatch ? activityBatch.baseline : before;
            activityBatch = { baseline, doc: after, at: now, author };
            clearActivityTimer();
            activityTimer = setTimeout(
              flushActivity,
              LIVE_COLLAB_ACTIVITY_DEBOUNCE_MS
            );
          };

          const scheduleFade = () => {
            clearFadeTimer();
            fadeTimer = setTimeout(() => {
              fadeTimer = null;
              if (!view.isDestroyed) {
                view.dispatch(
                  view.state.tr.setMeta(liveCollabKey, { type: 'clear' })
                );
              }
            }, LIVE_COLLAB_FADE_MS);
          };

          const onAfterTransaction = (transaction) => {
            // Yjs emits afterTransaction with (transaction, doc); the transaction
            // origin is the authoritative local/remote signal.
            const origin = transaction?.origin;
            const before = lastDoc;
            lastDoc = view.state.doc;
            if (!view.isDestroyed) {
              recordActivity(origin, before, view.state.doc, transaction);
            }
            if (!isRemoteLiveOrigin(origin) || view.isDestroyed) return;
            // The room's opening catch-up is not a live edit: skip remote
            // transactions until the provider's first sync lands, otherwise
            // applying the note's existing content flashes a highlight.
            // undefined (no provider / tests) is treated as ready.
            if (awareness && awareness.liveCollabRoomReady === false) return;

            // Insertions name the item author; a pure deletion carries no actor,
            // so resolve it from presence instead of the deleted text's author.
            const inserted = collectChangedClientIds(transaction);
            let author;
            if (inserted.size) {
              author = resolveLiveAuthor(inserted, awareness);
            } else if (transaction?.deleteSet?.clients?.size) {
              author = resolveLiveDeletionActor(awareness);
            } else {
              return;
            }
            const now = Date.now();
            const prev = liveCollabKey.getState(view.state);
            const sameBatch =
              prev != null && now - prev.at <= LIVE_COLLAB_COALESCE_MS;
            // Keep the earliest baseline of the burst so the diff covers the
            // union; a later distinct edit starts a fresh baseline.
            const baseline = sameBatch ? prev.baseline : before;

            let changes = [];
            try {
              changes = computeVersionChanges(baseline, view.state.doc);
            } catch {
              changes = [];
            }
            if (!changes.length) return;

            view.dispatch(
              view.state.tr.setMeta(liveCollabKey, {
                type: 'set',
                record: {
                  baseline,
                  name: author.name,
                  color: author.color,
                  changes,
                  target: changes[0],
                  at: now,
                  batchStartedAt: sameBatch ? prev.batchStartedAt : now,
                },
              })
            );
            scheduleFade();
          };

          ydoc.on('afterTransaction', onAfterTransaction);

          return {
            destroy() {
              clearFadeTimer();
              clearActivityTimer();
              clearTimeout(armTimer);
              ydoc.off('afterTransaction', onAfterTransaction);
            },
          };
        },
      }),
    ];
  },
});

export default LiveCollab;
