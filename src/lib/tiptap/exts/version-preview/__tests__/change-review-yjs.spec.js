import { afterEach, describe, expect, it } from 'vitest';
import { Editor } from '@tiptap/core';
import Document from '@tiptap/extension-document';
import Paragraph from '@tiptap/extension-paragraph';
import Text from '@tiptap/extension-text';
import Collaboration from '@tiptap/extension-collaboration';
import * as Y from 'yjs';
import VersionPreview, {
  computeVersionChanges,
  revertReviewChange,
  versionPreviewKey,
} from '../index.js';
import { useChangeReview } from '@/composable/useChangeReview.js';

const liveEditors = [];

function makeEditor(ydoc) {
  const editor = new Editor({
    extensions: [
      Document,
      Paragraph,
      Text,
      Collaboration.configure({ document: ydoc, field: 'content' }),
      VersionPreview,
    ],
    enableCoreExtensions: { paste: false, textDirection: false },
  });
  liveEditors.push(editor);
  return editor;
}

afterEach(() => {
  while (liveEditors.length) liveEditors.pop().destroy();
});

function fragText(frag) {
  let text = '';
  const walk = (node) => {
    if (node instanceof Y.XmlText) text += node.toString();
    else if (typeof node.toArray === 'function') node.toArray().forEach(walk);
  };
  frag.toArray().forEach(walk);
  return text;
}

describe('review mode read-only', () => {
  it('makes the editor read-only during review and editable again after exit', () => {
    const ydoc = new Y.Doc();
    const editor = makeEditor(ydoc);
    editor.commands.setContent('<p>Hello</p>');
    expect(editor.isEditable).toBe(true);

    const review = useChangeReview();
    review.start(editor, { content: '<p>Hello world</p>' });
    expect(editor.isEditable).toBe(false);

    review.exit(editor);
    expect(editor.isEditable).toBe(true);
  });
});

describe('review rendering', () => {
  it('renders the review header and per-chunk Keep/Revert controls', () => {
    const ydoc = new Y.Doc();
    const editor = makeEditor(ydoc);
    editor.commands.setContent('<p>Hello</p>');

    editor.commands.setChangeReview('<p>Hello world</p>', { label: 'x' });
    const dom = editor.view.dom;

    expect(dom.querySelector('.version-review-banner')?.textContent).toContain(
      '1 change'
    );
    expect(
      dom.querySelector('.version-preview-chunk__revert')?.textContent
    ).toBe('Revert');
    expect(dom.querySelector('.version-preview-chunk__keep')?.textContent).toBe(
      'Keep'
    );
  });

  it('shows "No changes" and no chunk actions when the baseline equals the doc', () => {
    const ydoc = new Y.Doc();
    const editor = makeEditor(ydoc);
    editor.commands.setContent('<p>Hello</p>');

    editor.commands.setChangeReview('<p>Hello</p>');
    const dom = editor.view.dom;

    expect(dom.querySelector('.version-review-banner')?.textContent).toContain(
      'No changes'
    );
    expect(dom.querySelector('.version-preview-chunk')).toBeNull();
  });
});

describe('revert through Yjs', () => {
  it('applies the inverse edit to the Y.Doc and a second doc converges', () => {
    const ydoc = new Y.Doc();
    const editor = makeEditor(ydoc);
    editor.commands.setContent('<p>Hello</p>');

    editor.commands.setChangeReview('<p>Hello world</p>', { label: 'x' });
    const snapshot = versionPreviewKey.getState(editor.state).snapshot;
    const target = computeVersionChanges(snapshot, editor.state.doc).find(
      (c) => c.deleted.length
    );
    expect(target).toBeTruthy();

    expect(revertReviewChange(editor, snapshot, target)).toBe(true);
    expect(
      editor.state.doc.textBetween(0, editor.state.doc.content.size, ' ')
    ).toBe('Hello world');

    const peer = new Y.Doc();
    Y.applyUpdate(peer, Y.encodeStateAsUpdate(ydoc));
    expect(fragText(peer.getXmlFragment('content'))).toBe('Hello world');
  });
});
