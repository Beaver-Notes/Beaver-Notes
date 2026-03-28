/**
 * ProseMirror / Tiptap document structure helpers.
 *
 * These utilities operate on raw JSON document fragments (the shape Tiptap
 * stores as note.content) and are kept out of the store to make them easy
 * to test in isolation.
 */

/**
 * Recursively collects all nodes of a given type from a document fragment.
 *
 * @param {Array|object} fragment - A ProseMirror node or array of nodes.
 * @param {string}       name     - The node type to search for.
 * @returns {Array}
 */
export function findAllNodesInRange(fragment, name) {
  if (!fragment) return [];
  if (!Array.isArray(fragment)) {
    return findAllNodesInRange(fragment.content, name);
  }
  const nodes = [];
  for (const n of fragment) {
    if (n.type === name) {
      nodes.push(n);
    } else {
      nodes.push(...findAllNodesInRange(n.content, name));
    }
  }
  return nodes;
}

/**
 * Reconciles a footnotes container node at the end of the document, ensuring
 * all referenced footnotes exist and appear in reference order.
 *
 * Mutates `note.content.content` in place.
 *
 * @param {object} note      - Note object with a `content` ProseMirror doc.
 * @param {Array}  footnotes - Additional footnote nodes to merge in.
 */
export function reconcileFootnotes(note, footnotes) {
  let lastNode = note.content.content.at(-1);
  if (lastNode.type !== 'footnotes') {
    lastNode = {
      type: 'footnotes',
      content: [],
      attrs: { class: 'footnotes' },
    };
    note.content.content.push(lastNode);
  }

  const footnoteMap = [...footnotes, ...lastNode.content].reduce(
    (acc, node) => ({ ...acc, [node.attrs['data-id']]: node }),
    {}
  );

  const references = findAllNodesInRange(
    note.content.content,
    'footnoteReference'
  );

  lastNode.content = references.map((ref, i) => {
    if (ref.attrs['data-id'] in footnoteMap) {
      return footnoteMap[ref.attrs['data-id']];
    }
    return {
      type: 'footnote',
      content: [{ type: 'paragraph', content: [] }],
      attrs: { 'data-id': ref.attrs['data-id'], id: `fn:${i + 1}` },
    };
  });
}

/**
 * Recursively un-collapses heading nodes, restoring their hidden child content
 * and collecting any footnote nodes that were stored inside the heading.
 *
 * @param {Array}  contents  - Array of ProseMirror nodes.
 * @param {Array}  footnotes - Accumulator for footnote nodes found in headings.
 * @returns {Array} Flat array of nodes with all collapsed content restored.
 */
export function uncollapseHeadings(contents, footnotes) {
  if (!contents.length) return contents;

  let result = [];
  for (const node of contents) {
    result.push(node);

    if (node.type !== 'heading') continue;

    const collapsedFootnotes = node.attrs.collapsedFootnotes ?? [];
    if (collapsedFootnotes.length > 0) {
      footnotes.push(...collapsedFootnotes);
    }

    let collapsedContent = node.attrs.collapsedContent ?? [];
    if (typeof collapsedContent === 'string') {
      collapsedContent = collapsedContent === '' ? [] : JSON.parse(collapsedContent);
    }

    node.attrs.open = true;
    node.attrs.collapsedContent = null;
    node.attrs.collapsedFootnotes = null;

    if (collapsedContent.length > 0) {
      result = [...result, ...uncollapseHeadings(collapsedContent, footnotes)];
    }
  }
  return result;
}
