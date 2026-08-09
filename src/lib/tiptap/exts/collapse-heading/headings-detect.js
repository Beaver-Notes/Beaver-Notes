/**
 * Returns true when the given ProseMirror transaction touched any heading node.
 *
 * Used to avoid re-scanning the full editor DOM on every keystroke: the
 * headings rail only needs rebuilding when a heading's content or structure
 * actually changed. Both the pre-transaction doc (a heading may have been
 * deleted) and the post-transaction doc (a heading may have been created or
 * edited) are inspected.
 */
export function transactionAffectsHeadings(transaction) {
  if (!transaction || !transaction.docChanged) return false;

  const range = transaction.changedRange();
  if (!range) return false;

  if (containsHeading(transaction.doc, range.from, range.to)) return true;

  const inverted = transaction.mapping.invert();
  const oldFrom = Math.min(
    inverted.map(range.from, 1),
    inverted.map(range.to, -1)
  );
  const oldTo = Math.max(
    inverted.map(range.from, 1),
    inverted.map(range.to, -1)
  );
  return containsHeading(transaction.before, oldFrom, oldTo);
}

function containsHeading(doc, from, to) {
  let found = false;
  doc.nodesBetween(from, to, (node) => {
    if (node.type.name === 'heading') {
      found = true;
      return false;
    }
  });
  return found;
}
