/**
 * ProseMirror / Tiptap document structure helpers over raw JSON fragments
 * (the shape Tiptap stores as note.content); kept out of the store for testability.
 */

/**
 * Recursively collect all nodes of a given type from a document fragment.
 */
export function findAllNodesInRange(fragment, name) {
  if (!fragment) return [];
  if (!Array.isArray(fragment)) {
    return findAllNodesInRange(fragment.content, name);
  }
  const nodes = [];
  const stack = fragment.slice();
  while (stack.length > 0) {
    const n = stack.pop();
    if (n.type === name) {
      nodes.push(n);
    } else if (Array.isArray(n.content)) {
      for (let i = n.content.length - 1; i >= 0; i--) {
        stack.push(n.content[i]);
      }
    }
  }
  return nodes;
}

/**
 * Reconcile a footnotes container at the end of the doc so every referenced
 * footnote exists in reference order. Mutates `note.content.content` in place;
 * `footnotes` are additional nodes merged in.
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

  const footnoteMap = new Map();
  for (const node of footnotes) {
    footnoteMap.set(node.attrs['data-id'], node);
  }
  for (const node of lastNode.content) {
    if (!footnoteMap.has(node.attrs['data-id'])) {
      footnoteMap.set(node.attrs['data-id'], node);
    }
  }

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
 * Recursively un-collapse heading nodes, restoring hidden child content and
 * collecting footnote nodes stored inside headings into `footnotes`.
 */
export function uncollapseHeadings(contents, footnotes) {
  if (!contents.length) return contents;

  const result = [];
  for (const node of contents) {
    result.push(node);

    if (node.type !== 'heading') continue;

    const collapsedFootnotes = node.attrs.collapsedFootnotes ?? [];
    if (collapsedFootnotes.length > 0) {
      for (const fn of collapsedFootnotes) footnotes.push(fn);
    }

    let collapsedContent = node.attrs.collapsedContent ?? [];
    if (typeof collapsedContent === 'string') {
      collapsedContent =
        collapsedContent === '' ? [] : JSON.parse(collapsedContent);
    }

    node.attrs.open = true;
    node.attrs.collapsedContent = null;
    node.attrs.collapsedFootnotes = null;

    if (collapsedContent.length > 0) {
      uncollapseHeadings(collapsedContent, footnotes);
      for (const child of collapsedContent) result.push(child);
    }
  }
  return result;
}
