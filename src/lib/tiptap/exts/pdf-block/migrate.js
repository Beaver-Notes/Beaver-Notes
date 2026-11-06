import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from 'prosemirror-state';
import { Transform } from 'prosemirror-transform';

const MIGRATION_MARK = 'pdfEmbedMigration';

export function isPdfFileName(name) {
  return /\.pdf$/i.test(String(name || ''));
}

/** Map a fileEmbed's attrs onto pdfBlock attrs for manual conversion. */
export function buildPdfBlockAttrs(embedAttrs) {
  return {
    src: String(embedAttrs?.src || ''),
    fileName: embedAttrs?.fileName || null,
    markup: [],
  };
}

/**
 * A fileEmbed node represents a PDF if its fileName ends in .pdf or its src
 * is an inline data:application/pdf payload (share-import embeds store the
 * bytes inline and may carry any fileName).
 */
export function isPdfEmbed(node) {
  const { fileName, src } = node.attrs ?? {};
  return (
    isPdfFileName(fileName) ||
    String(src || '')
      .toLowerCase()
      .startsWith('data:application/pdf')
  );
}

/**
 * Pure document transform: every fileEmbed carrying a PDF becomes a pdfBlock
 * with the same src (+fileName) and an empty markup layer. Returns the input
 * doc unchanged when there is nothing to migrate.
 */
export function migrateFileEmbedPdfs(doc) {
  const pdfType = doc.type.schema.nodes.pdfBlock;
  if (!pdfType) return doc;

  const replacements = [];
  doc.descendants((node, pos) => {
    if (node.type.name === 'fileEmbed' && isPdfEmbed(node)) {
      replacements.push({
        pos,
        size: node.nodeSize,
        attrs: {
          src: node.attrs.src,
          fileName: node.attrs.fileName,
          markup: [],
        },
      });
    }
    return true;
  });
  if (replacements.length === 0) return doc;

  const tr = new Transform(doc);
  for (const { pos, size, attrs } of replacements) {
    tr.replaceWith(tr.mapping.map(pos), tr.mapping.map(pos + size), pdfType.create(attrs));
  }
  return tr.doc;
}

/**
 * Load-time migration: notes stored before pdfBlock existed keep their PDFs
 * as fileEmbed nodes inside the Yjs fragment. Every doc-changing transaction
 * runs the pure migration once; the result is applied as a single
 * non-history transaction (collab peers converge on the same swap).
 */
export const PdfEmbedMigration = Extension.create({
  name: 'pdfEmbedMigration',

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey(MIGRATION_MARK),
        appendTransaction(transactions, _oldState, newState) {
          if (!transactions.some((tr) => tr.docChanged)) return null;
          if (transactions.some((tr) => tr.getMeta(MIGRATION_MARK))) {
            return null;
          }

          const doc = migrateFileEmbedPdfs(newState.doc);
          if (doc === newState.doc) return null;

          const tr = newState.tr;
          tr.replaceWith(0, newState.doc.content.size, doc.content);
          tr.setMeta(MIGRATION_MARK, true);
          tr.setMeta('addToHistory', false);
          return tr;
        },
      }),
    ];
  },
});
