/**
 * Collect start positions of headings emptied by the given transactions.
 *
 * Scans the edges of every transaction step instead of the transactions'
 * changedRange(): a block move's changed range spans everything between the
 * two ends, so walking it visits the whole document (O(doc) per move — 114 ms
 * on a 3000-block note). A heading can only survive a removal while becoming
 * empty at the edges of the removed range, so the scan stays proportional to
 * the edit. Returns absolute positions.
 */
export function collectEmptyHeadingPositions(doc, transactions) {
  const blocks = new Set();

  for (let i = 0; i < transactions.length; i++) {
    const tr = transactions[i];
    if (!tr.docChanged) continue;

    tr.steps.forEach((step, stepIndex) => {
      if (typeof step.from !== 'number' || typeof step.to !== 'number') return;

      // Map the step's edges into the final doc: through the rest of this
      // transaction, then through every transaction chained after it.
      const map = (pos, assoc) => {
        let mapped = tr.mapping.slice(stepIndex + 1).map(pos, assoc);
        for (let j = i + 1; j < transactions.length; j++) {
          mapped = transactions[j].mapping.map(mapped, assoc);
        }
        return mapped;
      };

      const from = map(step.from, 1);
      const to = map(step.to, -1);
      for (const p of [from, from - 1, to, to - 1]) {
        const start = textblockStart(doc, p);
        if (start !== null) blocks.add(start);
      }
    });
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
