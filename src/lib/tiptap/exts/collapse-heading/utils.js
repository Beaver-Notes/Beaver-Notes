/**
 * Collect start positions of headings emptied by the given transactions.
 * Scans only the transactions' changedRange() (the original plugin traversed
 * the whole doc every transaction); returns absolute positions.
 */
export function collectEmptyHeadingPositions(doc, transactions) {
  const blocks = new Set();

  for (let i = 0; i < transactions.length; i++) {
    const tr = transactions[i];
    if (!tr.docChanged) continue;

    let range = tr.changedRange();
    if (!range) continue;

    // Map the range forward into the final doc when multiple transactions were
    // chained (changedRange reports positions in the transaction's own doc).
    for (let j = i + 1; j < transactions.length; j++) {
      const map = transactions[j].mapping;
      range = { from: map.map(range.from, 1), to: map.map(range.to, -1) };
    }

    if (range.from === range.to) {
      // Pure deletions collapse to a single point. Check the textblock
      // containing it and the block immediately before it.
      for (const p of [range.from, range.from - 1]) {
        const start = textblockStart(doc, p);
        if (start !== null) blocks.add(start);
      }
    } else {
      doc.nodesBetween(range.from, range.to, (node, pos) => {
        if (node.isTextblock) blocks.add(pos);
      });
    }
  }

  const positions = [];
  for (const start of blocks) {
    const node = doc.nodeAt(start);
    if (node && node.type.name === 'heading' && node.content.size === 0) {
      positions.push(start);
    }
  }
  return positions;
}

function textblockStart(doc, p) {
  if (p < 0 || p > doc.content.size) return null;
  const $pos = doc.resolve(p);
  if ($pos.depth === 0) return null;
  return $pos.before($pos.depth);
}
