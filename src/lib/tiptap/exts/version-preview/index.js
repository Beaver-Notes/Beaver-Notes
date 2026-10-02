import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import { Transform } from '@tiptap/pm/transform';
import { DOMParser as PMDOMParser } from '@tiptap/pm/model';
import { ChangeSet } from '@tiptap/pm/changeset';

export const versionPreviewKey = new PluginKey('versionPreview');

function parseSnapshot(editor, html) {
  if (typeof html !== 'string' || !html) return null;
  try {
    const dom = new window.DOMParser().parseFromString(html, 'text/html').body;
    return PMDOMParser.fromSchema(editor.schema).parse(dom);
  } catch {
    return null;
  }
}

/**
 * Diff a snapshot against the live document. Returns the changed ranges with
 * `fromA`/`toA` in the snapshot and `fromB`/`toB` in the live doc, so a change
 * already present in the live doc can be decorated in place.
 */
export function computeVersionChanges(snapshotDoc, currentDoc) {
  const tr = new Transform(snapshotDoc);
  tr.replaceWith(0, snapshotDoc.content.size, currentDoc.content);
  return ChangeSet.create(snapshotDoc).addSteps(tr.doc, tr.mapping.maps, undefined)
    .changes;
}

/**
 * Find the change in `currentDoc` that corresponds to a previously rendered
 * `target`. Snapshot coordinates (`fromA`/`toA`) are immutable, so they are the
 * stable identity: after a revert shifts live positions, the same chunk is
 * re-located fresh instead of reusing stale `fromB`/`toB`.
 */
export function findReviewChange(snapshotDoc, currentDoc, target) {
  if (!snapshotDoc || !currentDoc || !target) return null;
  let changes = [];
  try {
    changes = computeVersionChanges(snapshotDoc, currentDoc);
  } catch {
    return null;
  }
  return changes.find((c) => c.fromA === target.fromA && c.toA === target.toA) || null;
}

/**
 * Apply the inverse of `target` as a normal edit on the live editor. The
 * transaction is dispatched through the view, so the Collaboration extension
 * writes it into the note's Y.Doc and every device converges. Returns false
 * (and touches nothing) when the change no longer matches — never a wrong edit.
 */
export function revertReviewChange(editor, snapshotDoc, target) {
  if (!editor?.state || !snapshotDoc || !target) return false;
  const change = findReviewChange(snapshotDoc, editor.state.doc, target);
  if (!change) return false;
  try {
    const tr = editor.state.tr;
    const slice = snapshotDoc.slice(change.fromA, change.toA);
    tr.replaceWith(change.fromB, change.toB, slice.content);
    editor.view.dispatch(tr);
    return true;
  } catch {
    return false;
  }
}

function createBanner(meta, options) {
  const banner = document.createElement('div');
  banner.className = 'version-preview-banner';
  banner.contentEditable = 'false';

  const label = document.createElement('span');
  label.className = 'version-preview-banner__label';
  label.textContent = meta?.label || 'Viewing an older version';
  banner.append(label);

  const restore = document.createElement('button');
  restore.type = 'button';
  restore.className = 'version-preview-banner__action';
  restore.textContent = 'Restore this version';
  restore.addEventListener('click', (event) => {
    event.preventDefault();
    options.onRestore?.(meta);
  });
  banner.append(restore);

  const exit = document.createElement('button');
  exit.type = 'button';
  exit.className = 'version-preview-banner__action version-preview-banner__exit';
  exit.textContent = 'Exit';
  exit.addEventListener('click', (event) => {
    event.preventDefault();
    options.onExit?.();
  });
  banner.append(exit);

  return banner;
}

function changeCountLabel(count) {
  if (count === 0) return 'No changes';
  return count === 1 ? '1 change' : `${count} changes`;
}

function createReviewHeader(meta, options, count) {
  const banner = document.createElement('div');
  banner.className = 'version-preview-banner version-review-banner';
  banner.contentEditable = 'false';

  const label = document.createElement('span');
  label.className = 'version-preview-banner__label';
  const heading = meta?.label || 'Reviewing changes';
  label.textContent = `${heading} · ${changeCountLabel(count)}`;
  banner.append(label);

  const done = document.createElement('button');
  done.type = 'button';
  done.className = 'version-preview-banner__action version-review-banner__done';
  done.textContent = 'Done';
  done.addEventListener('click', (event) => {
    event.preventDefault();
    options.onReviewExit?.();
  });
  banner.append(done);

  return banner;
}

function createChunkControls(editor, snapshot, change, options) {
  const wrap = document.createElement('span');
  wrap.className = 'version-preview-chunk';
  wrap.contentEditable = 'false';

  const keep = document.createElement('button');
  keep.type = 'button';
  keep.className = 'version-preview-chunk__btn version-preview-chunk__keep';
  keep.textContent = 'Keep';
  keep.addEventListener('mousedown', (event) => event.preventDefault());
  keep.addEventListener('click', (event) => {
    event.preventDefault();
    options.onReviewAction?.({ action: 'keep', change });
  });

  const revert = document.createElement('button');
  revert.type = 'button';
  revert.className = 'version-preview-chunk__btn version-preview-chunk__revert';
  revert.textContent = 'Revert';
  revert.addEventListener('mousedown', (event) => event.preventDefault());
  revert.addEventListener('click', (event) => {
    event.preventDefault();
    const ok = revertReviewChange(editor, snapshot, change);
    if (ok) {
      options.onReviewAction?.({ action: 'revert', change });
      return;
    }
    // Positions no longer match: apply nothing and point the user at the
    // refreshed diff instead of writing a wrong edit.
    wrap.dataset.stale = 'true';
    wrap.title = 'This change moved — review refreshed';
  });

  wrap.append(keep, revert);
  return wrap;
}

function buildDecorations(state, preview, options, editor) {
  const isReview = preview.mode === 'review';
  let changes = [];
  if (preview.snapshot) {
    try {
      changes = computeVersionChanges(preview.snapshot, state.doc);
    } catch {
      changes = [];
    }
  }

  const decorations = [
    Decoration.widget(
      0,
      () =>
        isReview
          ? createReviewHeader(preview.meta, options, changes.length)
          : createBanner(preview.meta, options),
      { side: -1, key: 'version-banner' }
    ),
  ];

  if (preview.snapshot) {
    for (const change of changes) {
      if (change.toB > change.fromB) {
        decorations.push(
          Decoration.inline(change.fromB, change.toB, {
            class: 'version-preview-added',
          })
        );
      }
      if (change.deleted.length) {
        const removed = preview.snapshot.textBetween(
          change.fromA,
          change.toA,
          ' '
        );
        if (removed) {
          decorations.push(
            Decoration.widget(
              change.fromB,
              () => {
                const el = document.createElement('del');
                el.className = 'version-preview-removed';
                el.textContent = removed;
                return el;
              },
              { side: 1 }
            )
          );
        }
      }
      if (isReview) {
        decorations.push(
          Decoration.widget(
            change.toB,
            () => createChunkControls(editor, preview.snapshot, change, options),
            { side: 1 }
          )
        );
      }
    }
  }

  decorations.sort((a, b) => a.from - b.from);
  return DecorationSet.create(state.doc, decorations);
}

const VersionPreview = Extension.create({
  name: 'versionPreview',

  addOptions() {
    return {
      onRestore: null,
      onExit: null,
      onReviewExit: null,
      onReviewAction: null,
    };
  },

  addStorage() {
    return { previousEditable: null };
  },

  addCommands() {
    const editor = this.editor;
    return {
      setVersionPreview:
        (html, meta = {}) =>
        ({ tr, dispatch }) => {
          const snapshot = parseSnapshot(editor, html);
          if (!snapshot) return false;
          if (dispatch) {
            tr.setMeta(versionPreviewKey, {
              type: 'set',
              snapshot,
              meta,
              mode: 'preview',
            });
          }
          return true;
        },
      setChangeReview:
        (html, meta = {}) =>
        ({ tr, dispatch }) => {
          const snapshot = parseSnapshot(editor, html);
          if (!snapshot) return false;
          if (dispatch) {
            tr.setMeta(versionPreviewKey, {
              type: 'set',
              snapshot,
              meta,
              mode: 'review',
            });
          }
          return true;
        },
      clearVersionPreview:
        () =>
        ({ tr, dispatch }) => {
          if (dispatch) {
            tr.setMeta(versionPreviewKey, { type: 'clear' });
          }
          return true;
        },
      clearChangeReview:
        () =>
        ({ tr, dispatch }) => {
          if (dispatch) {
            tr.setMeta(versionPreviewKey, { type: 'clear' });
          }
          return true;
        },
    };
  },

  addProseMirrorPlugins() {
    const options = this.options;
    const editor = this.editor;
    return [
      new Plugin({
        key: versionPreviewKey,
        state: {
          init: () => ({
            active: false,
            snapshot: null,
            meta: null,
            mode: 'preview',
          }),
          apply(tr, value) {
            const meta = tr.getMeta(versionPreviewKey);
            if (meta?.type === 'set') {
              return {
                active: true,
                snapshot: meta.snapshot,
                meta: meta.meta,
                mode: meta.mode || 'preview',
              };
            }
            if (meta?.type === 'clear') {
              return { active: false, snapshot: null, meta: null, mode: 'preview' };
            }
            return value;
          },
        },
        props: {
          editable: (state) =>
            versionPreviewKey.getState(state)?.active ? false : null,
          decorations: (state) => {
            const preview = versionPreviewKey.getState(state);
            if (!preview?.active) return null;
            return buildDecorations(state, preview, options, editor);
          },
        },
      }),
    ];
  },
});

export default VersionPreview;
