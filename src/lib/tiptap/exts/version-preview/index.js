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
 * Ghost chip copy. The extension builds raw DOM and has no translations
 * access, so this English string carries the label.
 */
const LABEL_REMOVED = 'Removed';

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

function buildDecorations(state, preview, editor) {
  let rows = [];
  if (preview.snapshot) {
    try {
      const changes = computeVersionChanges(preview.snapshot, state.doc);
      rows = classifyChangeRows(preview.snapshot, state.doc, changes);
    } catch {
      rows = [];
    }
  }

  const decorations = [];

  if (preview.snapshot) {
    for (const row of rows) {
      // Added live side: a whole block-level base node starting at the row's
      // start gets a node decoration (green block tint); anything else inline.
      if (row.kind !== 'attr' && row.toB > row.fromB) {
        const anchor = state.doc.nodeAt(row.fromB);
        if (anchor?.isBlock && row.fromB + anchor.nodeSize <= row.toB) {
          decorations.push(
            Decoration.node(row.fromB, row.fromB + anchor.nodeSize, {
              class: 'version-preview-added-block',
            })
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
    }
  }

  decorations.sort((a, b) => a.from - b.from);
  return DecorationSet.create(state.doc, decorations);
}

const VersionPreview = Extension.create({
  name: 'versionPreview',

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
            return buildDecorations(state, preview, editor);
          },
        },
      }),
    ];
  },
});

export default VersionPreview;
