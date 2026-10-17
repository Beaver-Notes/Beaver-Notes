import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import { Transform } from '@tiptap/pm/transform';
import { DOMParser as PMDOMParser, DOMSerializer } from '@tiptap/pm/model';
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

/**
 * The nodes between (read: overlapping) the given range that carry block
 * structure, so an equal-geometry row can be compared node-by-node.
 */
function blockNodesOverlapping(doc, from, to) {
  const blocks = [];
  doc.nodesBetween(from, to, (node) => {
    if (node.isBlock) blocks.push(node);
    return true;
  });
  return blocks;
}

function attrsDiffer(a, b) {
  if (a === b) return false;
  const aKeys = Object.keys(a);
  if (aKeys.length !== Object.keys(b).length) return true;
  return aKeys.some((key) => a[key] !== b[key]);
}

function marksDiffer(a, b) {
  if (a.length !== b.length) return true;
  return a.some((mark, i) => !mark.eq(b[i]));
}

function nodesDifferByFormat(a, b) {
  return a.type !== b.type || attrsDiffer(a.attrs, b.attrs) || marksDiffer(a.marks, b.marks);
}

/**
 * Classify raw ChangeSet rows into decoration kinds. `ChangeSet` never
 * surfaces attribute-only edits (their step maps are empty), so `attr` can
 * only be tagged over rows ChangeSet actually produced with equal geometry
 * where the overlapping nodes match text-for-text but differ in type, attrs
 * or marks (e.g. a paragraph re-formatted as a heading). Nothing is
 * synthesized for steps the library does not report.
 */
export function classifyChangeRows(snapshotDoc, currentDoc, changeRows) {
  return changeRows.map((change) => {
    if (change.toA === change.fromA) return { ...change, kind: 'add' };
    if (change.toB === change.fromB) return { ...change, kind: 'del' };
    const equalGeometry = change.toA - change.fromA === change.toB - change.fromB;
    if (equalGeometry) {
      const snapBlocks = blockNodesOverlapping(snapshotDoc, change.fromA, change.toA);
      const liveBlocks = blockNodesOverlapping(currentDoc, change.fromB, change.toB);
      if (
        snapBlocks.length === liveBlocks.length &&
        snapshotDoc.textBetween(change.fromA, change.toA, ' ') ===
          currentDoc.textBetween(change.fromB, change.toB, ' ') &&
        snapBlocks.some((node, i) => nodesDifferByFormat(node, liveBlocks[i]))
      ) {
        return { ...change, kind: 'attr' };
      }
    }
    return { ...change, kind: 'replace' };
  });
}

/**
 * Deleted-snapshot content that has no structure of its own (plain text) is
 * rendered as the compact struck-through inline widget; anything carrying
 * real DOM (images, whole blocks) becomes a non-editable ghost preview.
 */
function deletedSliceIsStructured(slice) {
  if (slice.content.childCount === 1 && slice.content.firstChild.isText) {
    return false;
  }
  return true;
}

/**
 * Blueprint legend/pill copy. The extension builds raw DOM and has no
 * translations access, so these English strings carry the labels; the banner
 * labels themselves still come in through `meta`.
 */
const LEGEND_ADDED = 'Added';
const LEGEND_REMOVED = 'Removed';
const LEGEND_FORMAT = 'Format changed';
const LABEL_ADDED = LEGEND_ADDED;
const LABEL_REMOVED = LEGEND_REMOVED;

/**
 * Zero-size relative anchor so a change-category chip can float at its
 * decoration position without taking layout space or shifting text.
 */
function createChangeLabel(text, className) {
  const anchor = document.createElement('span');
  anchor.className = 'version-preview-label-anchor';
  const chip = document.createElement('span');
  chip.className = className;
  chip.textContent = text;
  chip.contentEditable = 'false';
  chip.setAttribute('aria-hidden', 'true');
  anchor.append(chip);
  return anchor;
}

function createGhost(editor, slice) {
  const ghost = document.createElement('div');
  ghost.className = 'version-preview-ghost';
  ghost.contentEditable = 'false';
  const label = document.createElement('span');
  label.className = 'version-preview-ghost__label';
  label.textContent = LABEL_REMOVED;
  label.setAttribute('aria-hidden', 'true');
  ghost.append(
    label,
    DOMSerializer.fromSchema(editor.schema).serializeFragment(slice.content)
  );
  return ghost;
}

function createLegend() {
  const legend = document.createElement('div');
  legend.className = 'version-preview-legend';
  const items = [
    ['added', LEGEND_ADDED],
    ['removed', LEGEND_REMOVED],
    ['format', LEGEND_FORMAT],
  ];
  for (const [kind, text] of items) {
    const item = document.createElement('span');
    item.className = 'version-preview-legend__item';
    const swatch = document.createElement('span');
    swatch.className = `version-preview-legend__swatch version-preview-legend__swatch--${kind}`;
    if (kind === 'removed') swatch.textContent = 'abc';
    const label = document.createElement('span');
    label.textContent = text;
    item.append(swatch, label);
    legend.append(item);
  }
  return legend;
}

function createBanner(meta, options) {
  const banner = document.createElement('div');
  banner.className = 'version-preview-banner';
  banner.contentEditable = 'false';

  const label = document.createElement('span');
  label.className = 'version-preview-banner__label';
  label.textContent = meta?.label || 'Viewing an older version';
  banner.append(label);
  banner.append(createLegend());

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
  banner.append(createLegend());

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
  let rows = [];
  if (preview.snapshot) {
    try {
      const changes = computeVersionChanges(preview.snapshot, state.doc);
      rows = classifyChangeRows(preview.snapshot, state.doc, changes);
    } catch {
      rows = [];
    }
  }

  const decorations = [
    Decoration.widget(
      0,
      () =>
        isReview
          ? createReviewHeader(preview.meta, options, rows.length)
          : createBanner(preview.meta, options),
      // The key decides whether ProseMirror reuses the banner's DOM node. A
      // constant key froze the label at whatever version was opened first, so
      // the heading never updated when a different commit was selected. Fold
      // the rendered content into the key: same version keeps its node stable
      // across doc edits, a different version (or a new review change count)
      // remounts it.
      {
        side: -1,
        key: `version-banner:${isReview ? 'review' : 'preview'}:${
          preview.meta?.label || ''
        }:${isReview ? rows.length : 0}`,
      }
    ),
  ];

  if (preview.snapshot) {
    for (const row of rows) {
      // Added live side: a whole block-level base node starting at the row's
      // start gets a node decoration (its own pill); anything else inline.
      if (row.kind !== 'attr' && row.toB > row.fromB) {
        const anchor = state.doc.nodeAt(row.fromB);
        if (anchor?.isBlock && row.fromB + anchor.nodeSize <= row.toB) {
          decorations.push(
            Decoration.node(row.fromB, row.fromB + anchor.nodeSize, {
              class: 'version-preview-added-block',
            })
          );
          // Named category chip at the block start, so the mark is never
          // colour-only. Keyless like the other row widgets. side: 1 sorts
          // after same-position ghost widgets, so the chip stays attached to
          // its own block instead of an adjacent Removed ghost.
          decorations.push(
            Decoration.widget(
              row.fromB,
              () => createChangeLabel(LABEL_ADDED, 'version-preview-block-label'),
              { side: 1 }
            )
          );
        } else {
          decorations.push(
            Decoration.inline(row.fromB, row.toB, {
              class: 'version-preview-added',
            })
          );
        }
      } else if (row.kind === 'attr') {
        decorations.push(
          Decoration.inline(row.fromB, row.toB, {
            class: 'version-preview-attr',
          })
        );
        decorations.push(
          Decoration.widget(
            row.fromB,
            () =>
              createChangeLabel(LEGEND_FORMAT, 'version-preview-attr-label'),
            { side: 1 }
          )
        );
      }
      // Deleted snapshot side: plain text keeps the compact struck-through
      // widget; structured content gets a non-editable ghost preview.
      if (row.kind !== 'attr' && row.deleted.length) {
        const slice = preview.snapshot.slice(row.fromA, row.toA);
        if (deletedSliceIsStructured(slice)) {
          decorations.push(
            Decoration.widget(
              row.fromB,
              () => createGhost(editor, slice),
              { side: 1 }
            )
          );
        } else {
          const removed = preview.snapshot.textBetween(row.fromA, row.toA, ' ');
          if (removed) {
            decorations.push(
              Decoration.widget(
                row.fromB,
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
      }
      if (isReview) {
        decorations.push(
          Decoration.widget(
            row.toB,
            () => createChunkControls(editor, preview.snapshot, row, options),
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
