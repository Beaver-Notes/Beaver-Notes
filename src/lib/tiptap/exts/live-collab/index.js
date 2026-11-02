import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import { ySyncPluginKey } from '@tiptap/y-tiptap';
import * as Y from 'yjs';
import { getColorFromId, safePeerColor } from '@/composable/usePresence';
import { computeVersionChanges } from '../version-preview/index.js';

export const liveCollabKey = new PluginKey('liveCollab');

export const LIVE_COLLAB_FADE_MS = 4000;
export const LIVE_COLLAB_COALESCE_MS = 250;
export const LIVE_COLLAB_ACTIVITY_DEBOUNCE_MS = LIVE_COLLAB_COALESCE_MS;
export const LIVE_COLLAB_NEUTRAL_COLOR = '#9ca3af';
export const LIVE_COLLAB_FALLBACK_NAME = 'someone';
export const LIVE_COLLAB_DELETION_FALLBACK_NAME = 'a collaborator';
export const ACTIVITY_SUMMARY_MAX = 80;

export function isRemoteLiveOrigin(origin) {
  if (origin == null || typeof origin === 'string') return false;
  if (origin === ySyncPluginKey) return false;
  if (origin instanceof Y.UndoManager) return false;
  return true;
}

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
    // Non-secure context: fall through to a non-cryptographic id,
    // used only as a dedupe key/client-side marker.
  }
  return `act-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

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

export function resolveLiveAuthor(clientIds, awareness) {
  const states = awareness?.getStates?.();
  if (states) {
    for (const clientId of clientIds) {
      const user = states.get(clientId)?.user;
      if (!user) continue;
      return {
        id: user.id || null,
        name: user.name || LIVE_COLLAB_FALLBACK_NAME,
        // Remote-supplied: clamped to a strict hex format before it can reach
        // the decoration style attribute (SC-4-03). No id to hash → neutral.
        color:
          safePeerColor(user.color) ||
          (user.id ? getColorFromId(user.id) : LIVE_COLLAB_NEUTRAL_COLOR),
      };
    }
  }
  return neutralAuthor();
}

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
    color:
      safePeerColor(user.color) ||
      getColorFromId(user.id) ||
      LIVE_COLLAB_NEUTRAL_COLOR,
  };
}

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

function buildLiveDecorations(state) {
  const record = liveCollabKey.getState(state);
  if (!record?.changes?.length) return null;
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
          decorations: (state) => buildLiveDecorations(state),
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
            const origin = transaction?.origin;
            const before = lastDoc;
            lastDoc = view.state.doc;
            if (!view.isDestroyed) {
              recordActivity(origin, before, view.state.doc, transaction);
            }
            if (!isRemoteLiveOrigin(origin) || view.isDestroyed) return;
            if (awareness && awareness.liveCollabRoomReady === false) return;

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
