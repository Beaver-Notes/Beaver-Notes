import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from 'prosemirror-state';
import { Transform } from 'prosemirror-transform';
import { parseStrokes } from './ink/stroke-model';

const MIGRATION_MARK = 'paperStrokesMigration';

/**
 * Pre-rebuild notes persist their strokes under the old `linesV2`/`lines`
 * attr keys inside Yjs fragments — a path parseHTML never sees. This pure
 * transform folds those payloads into the canonical `strokes` attr and
 * clears the legacy keys so the Yjs payload shrinks on the next write.
 */
export function migratePaperStrokes(doc) {
  let changed = false;
  const replacements = [];

  doc.descendants((node, pos) => {
    if (node.type.name !== 'paper') return;
    const { strokes, linesV2, lines } = node.attrs;
    const legacy = linesV2 ?? lines;
    if (strokes?.length) {
      if (linesV2 != null || lines != null) {
        replacements.push({
          pos,
          attrs: { ...node.attrs, linesV2: null, lines: null },
        });
      }
      return;
    }
    if (legacy == null) return;
    const migrated = parseStrokes(legacy);
    if (!migrated.length) return;
    replacements.push({
      pos,
      attrs: {
        ...node.attrs,
        strokes: migrated,
        linesV2: null,
        lines: null,
      },
    });
  });

  if (!replacements.length) return { doc, changed };
  // Attr-only updates: positions stay valid across replacements.
  const tr = new Transform(doc);
  for (const { pos, attrs } of replacements) {
    tr.setNodeMarkup(tr.mapping.map(pos), null, attrs);
  }
  return { doc: tr.doc, changed: true };
}

/**
 * Load-time migration: every doc-changing transaction runs the pure fold
 * once and applies it as a single non-history transaction so collab peers
 * converge on the same rewrite.
 */
export const PaperStrokesMigration = Extension.create({
  name: 'paperStrokesMigration',

  addProseMirrorPlugins() {
    const key = new PluginKey(MIGRATION_MARK);
    return [
      new Plugin({
        key,
        state: {
          init: () => false,
          // The gate closes after the first scan: legacy attrs exist only in
          // old notes, so rescanning every keystroke/stroke-commit is pure cost.
          apply(tr, value) {
            return value || tr.getMeta(MIGRATION_MARK) != null;
          },
        },
        appendTransaction(transactions, oldState, newState) {
          if (!transactions.some((tr) => tr.docChanged)) return null;
          if (key.getState(oldState)) return null;
          if (transactions.some((tr) => tr.getMeta(MIGRATION_MARK))) {
            return null;
          }

          const { doc, changed } = migratePaperStrokes(newState.doc);
          const tr = newState.tr;
          tr.setMeta(MIGRATION_MARK, true);
          if (changed) {
            tr.replaceWith(0, newState.doc.content.size, doc.content);
            tr.setMeta('addToHistory', false);
          }
          return tr;
        },
      }),
    ];
  },
});
