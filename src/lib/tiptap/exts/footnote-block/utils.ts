import { EditorState, Transaction } from '@tiptap/pm/state';
import { Fragment, Node } from '@tiptap/pm/model';

let unCollapsedFootnotes = {} as any;

export function mergeCollapsedFootnotes(notes: any) {
  Object.assign(unCollapsedFootnotes, notes);
}

// update the reference number of all the footnote references in the document
export function updateFootnoteReferences(tr: Transaction) {
  let count = 1;

  const nodes: any[] = [];

  tr.doc.descendants((node, pos) => {
    if (node.type.name == 'footnoteReference') {
      tr.setNodeAttribute(pos, 'referenceNumber', `${count}`);

      nodes.push(node);
      count += 1;
    }
  });
  // return the updated footnote references (in the order that they appear in the document)
  return nodes;
}

function getFootnotes(tr: Transaction) {
  let footnotesRange: { from: number; to: number } | undefined;
  const footnotes: Node[] = [];
  tr.doc.descendants((node, pos) => {
    if (node.type.name == 'footnote') {
      footnotes.push(node);
    } else if (node.type.name == 'footnotes') {
      footnotesRange = { from: pos, to: pos + node.nodeSize };
    } else {
      return false;
    }
  });
  return { footnotesRange, footnotes };
}

// update the "footnotes" ordered list based on the footnote references in the document
export function updateFootnotesList(tr: Transaction, state: EditorState) {
  const footnoteReferences = updateFootnoteReferences(tr);

  const footnoteType = state.schema.nodes.footnote;
  const footnotesType = state.schema.nodes.footnotes;

  const emptyParagraph = state.schema.nodeFromJSON({
    type: 'paragraph',
    content: [],
  });

  const { footnotesRange, footnotes } = getFootnotes(tr);

  // a mapping of footnote id -> footnote node
  const footnoteIds = footnotes.reduce<{ [key: string]: Node }>(
    (obj, footnote) => {
      obj[footnote.attrs['data-id']] = footnote;
      return obj;
    },
    {}
  );

  const newFootnotes: Node[] = [];

  const footnoteRefIds = new Set(
    footnoteReferences.map((ref) => ref.attrs['data-id'])
  );
  const deleteFootnoteIds: Set<string> = new Set();
  for (const footnote of footnotes) {
    const id = footnote.attrs['data-id'];
    if (!footnoteRefIds.has(id) || deleteFootnoteIds.has(id)) {
      deleteFootnoteIds.add(id);
      // we traverse through this footnote's content because it may contain footnote references.
      // we want to delete the footnotes associated with these references, so we add them to the delete set.
      footnote.content.descendants((node) => {
        if (node.type.name == 'footnoteReference')
          deleteFootnoteIds.add(node.attrs['data-id']);
      });
    }
  }

  for (let i = 0; i < footnoteReferences.length; i++) {
    const refId = footnoteReferences[i].attrs['data-id'];

    if (deleteFootnoteIds.has(refId)) continue;
    // if there is a footnote w/ the same id as this `ref`, we preserve its content and update its id attribute
    if (refId in footnoteIds) {
      const footnote = footnoteIds[refId];
      newFootnotes.push(
        footnoteType.create(
          { ...footnote.attrs, id: `fn:${i + 1}` },
          footnote.content
        )
      );
    } else {
      let newNode = footnoteType.create(
        {
          'data-id': refId,
          id: `fn:${i + 1}`,
        },
        [emptyParagraph]
      );
      if (refId in unCollapsedFootnotes) {
        newNode = state.schema.nodeFromJSON(unCollapsedFootnotes[refId]);
      }
      newFootnotes.push(newNode);
    }
  }

  unCollapsedFootnotes = {};

  if (newFootnotes.length == 0) {
    // no footnotes in the doc, delete the "footnotes" node
    if (footnotesRange) {
      tr.delete(footnotesRange.from, footnotesRange.to);
    }
  } else if (!footnotesRange) {
    // there is no footnotes node present in the doc, add it
    tr.insert(
      tr.doc.content.size,
      footnotesType.create(undefined, Fragment.from(newFootnotes))
    );
  } else {
    tr.replaceWith(
      footnotesRange.from + 1,
      footnotesRange.to - 1,
      Fragment.from(newFootnotes)
    );
  }
}
