import { afterEach, describe, expect, it, vi } from 'vitest';
import { Editor } from '@tiptap/core';
import Document from '@tiptap/extension-document';
import Paragraph from '@tiptap/extension-paragraph';
import Text from '@tiptap/extension-text';
import BulletList from '@tiptap/extension-bullet-list';
import ListItem from '@tiptap/extension-list-item';
import Heading from '@tiptap/extension-heading';
import TaskList from '@tiptap/extension-task-list';
import TaskItem from '@tiptap/extension-task-item';
import Image from '@/lib/tiptap/exts/image';
import VersionPreview, {
  classifyChangeRows,
  computeVersionChanges,
} from '../version-preview/index.js';

const editors = [];

function makeEditor(extraExts = []) {
  const editor = new Editor({
    extensions: [
      Document,
      Paragraph,
      Text,
      BulletList,
      ListItem,
      Image,
      ...extraExts,
    ],
    enableCoreExtensions: { paste: false, textDirection: false },
  });
  editors.push(editor);
  return editor;
}

afterEach(() => {
  while (editors.length) editors.pop().destroy();
});

describe('version-preview block-aware decorations', () => {
  it('ghosts a deleted image as its real DOM and marks an added list block', () => {
    const editor = makeEditor([VersionPreview.configure({ onRestore: vi.fn() })]);
    editor.commands.setContent('<p>Hello</p><ul><li>new item</li></ul>');

    const snapshotHtml = '<p>Hello</p><p><img src="x.png" alt="pic"></p>';
    editor.commands.setVersionPreview(snapshotHtml, { label: 'v1' });

    const dom = editor.view.dom;

    // (a) deleted image renders as a ghost widget carrying its real DOM
    const ghosts = [...dom.querySelectorAll('.version-preview-ghost')];
    expect(ghosts).toHaveLength(1);
    expect(ghosts[0].getAttribute('contenteditable')).toBe('false');
    const img = ghosts[0].querySelector('img');
    expect(img?.getAttribute('src')).toBe('x.png');
    expect(img?.getAttribute('alt')).toBe('pic');

    // (b) the added list renders as a node-decoration block pill
    expect(dom.querySelector('.version-preview-added-block')).toBeTruthy();

    // (c) banner widget exists at doc start with the meta label
    expect(
      dom.querySelector('.version-preview-banner')?.textContent
    ).toContain('v1');

    // inline added text is scenario-dependent: here the added side is a whole
    // block (the list), so nothing else needs an inline mark.

    // (d) clear removes every decoration the mode added
    editor.commands.clearVersionPreview();
    expect(dom.querySelector('.version-preview-ghost')).toBeNull();
    expect(dom.querySelector('.version-preview-added-block')).toBeNull();
    expect(dom.querySelector('.version-preview-banner')).toBeNull();
  });

  it('renders review chunk controls and fires onReviewExit from the done pill', () => {
    const onReviewExit = vi.fn();
    const onReviewAction = vi.fn();
    const editor = makeEditor([
      VersionPreview.configure({ onReviewExit, onReviewAction }),
    ]);
    editor.commands.setContent('<p>Hello there</p>');
    editor.commands.setChangeReview('<p>Hello</p>', { label: 'x' });

    const dom = editor.view.dom;
    expect(dom.querySelector('.version-preview-chunk')).toBeTruthy();
    expect(dom.querySelector('.version-preview-chunk__keep')?.textContent).toBe(
      'Keep'
    );
    // plain added text stays an inline mark (no block pill, no ghost)
    expect(dom.querySelector('.version-preview-added')).toBeTruthy();
    expect(dom.querySelector('.version-preview-ghost')).toBeNull();

    dom.querySelector('.version-preview-chunk__keep').click();
    expect(onReviewAction).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'keep' })
    );

    dom.querySelector('.version-review-banner__done').click();
    expect(onReviewExit).toHaveBeenCalledTimes(1);
  });
});

describe('classifyChangeRows kinds', () => {
  it('classifies a pure insertion and a plain text replacement', () => {
    const editor = makeEditor();
    const schema = editor.state.schema;
    const snapDoc = schema.nodes.doc.create(null, [
      schema.nodes.paragraph.create(null, schema.text('Alpha')),
    ]);
    const liveDoc = schema.nodes.doc.create(null, [
      schema.nodes.paragraph.create(null, schema.text('Alpha Beta')),
    ]);
    const rows = classifyChangeRows(
      snapDoc,
      liveDoc,
      computeVersionChanges(snapDoc, liveDoc)
    );
    expect(rows.length).toBeGreaterThanOrEqual(1);
    expect(rows[0].kind).toBe('add');
  });

  it('tags equal-geometry type re-formats (block identity) as attr rows', () => {
    const editor = makeEditor([Heading]);
    const schema = editor.state.schema;
    const snapDoc = schema.nodes.doc.create(null, [
      schema.nodes.paragraph.create(null, schema.text('Hello')),
    ]);
    const liveDoc = schema.nodes.doc.create(null, [
      schema.nodes.heading.create({ level: 2 }, schema.text('Hello')),
    ]);
    const rows = classifyChangeRows(
      snapDoc,
      liveDoc,
      computeVersionChanges(snapDoc, liveDoc)
    );
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((row) => row.kind === 'attr')).toBe(true);
  });
});

// Honest fidelity: ChangeSet.addSteps obtains its replaced ranges from the
// steps' own maps. Attribute-only steps (setNodeMarkup: heading level,
// taskCheck checked) carry an EMPTY step map, so they surface as zero rows.
// The dashed attr pill therefore does NOT fire for plain attribute toggles
// and must never be faked into existence (spec decision #4).
describe('attribute-only changes are not fabricated', () => {
  it('produces no change rows for a pure heading-level change', () => {
    const editor = makeEditor([Heading]);
    const schema = editor.state.schema;
    const h1 = schema.nodes.doc.create(null, [
      schema.nodes.heading.create({ level: 1 }, schema.text('Title')),
    ]);
    const h2 = schema.nodes.doc.create(null, [
      schema.nodes.heading.create({ level: 2 }, schema.text('Title')),
    ]);
    expect(computeVersionChanges(h1, h2)).toEqual([]);
  });

  it('produces no change rows for a pure taskCheck toggle', () => {
    const editor = makeEditor([BulletList, TaskList, TaskItem]);
    const schema = editor.state.schema;
    const on = schema.nodes.doc.create(null, [
      schema.nodes.bulletList.create(null, [
        schema.nodes.taskItem.create(
          { checked: true },
          schema.nodes.paragraph.create(null, schema.text('todo'))
        ),
      ]),
    ]);
    const off = schema.nodes.doc.create(null, [
      schema.nodes.bulletList.create(null, [
        schema.nodes.taskItem.create(null, schema.nodes.paragraph.create(null, schema.text('todo'))),
      ]),
    ]);
    expect(computeVersionChanges(on, off)).toEqual([]);
  });
});
