import { afterEach, describe, expect, it, vi } from 'vitest';
import { Editor } from '@tiptap/core';
import Document from '@tiptap/extension-document';
import Paragraph from '@tiptap/extension-paragraph';
import Text from '@tiptap/extension-text';
import Image from '@/lib/tiptap/exts/image';
import { dropFile } from '../drop-file';

// Mock the asset boundary, not insertImages itself: the real insertImages +
// drop-file wiring stays under test, and the node count is the assertion
// (the pre-fix handler re-inserted the whole set once per file → N² nodes).
vi.mock('@/utils/assets/storage.js', async (importOriginal) => {
  const actual = await importOriginal();
  const fakeCopyImage = async () => ({ fileName: 'mocked.png' });
  return { ...actual, default: fakeCopyImage, writeImageFile: fakeCopyImage };
});

vi.mock('@/store', () => ({
  useStore: () => ({ activeNoteId: 'note-1' }),
}));

const editors = [];

function makeEditor() {
  const editor = new Editor({
    extensions: [
      Document,
      Paragraph,
      Text,
      Image,
      dropFile.configure({ id: 'note-1' }),
    ],
    enableCoreExtensions: { paste: false, textDirection: false },
  });
  editors.push(editor);
  return editor;
}

function getDropHandler(editor) {
  return editor.view.someProp(
    'handleDOMEvents',
    (handlers) => handlers?.drop || null,
  );
}

function imageFile(name, type = 'image/png') {
  const file = new File(['x'], name, { type });
  file.path = `/fake/${name}`;
  return file;
}

function imageNodesIn(editor) {
  const nodes = [];
  editor.state.doc.descendants((node) => {
    if (node.type.name === 'image') nodes.push(node);
  });
  return nodes;
}

afterEach(() => {
  while (editors.length) editors.pop().destroy();
});

describe('dropFile', () => {
  it('inserts one image node per dropped file (3 files → 3 nodes)', async () => {
    const editor = makeEditor();
    // happy-dom has no layout: pin the drop position to the doc end.
    vi.spyOn(editor.view, 'posAtCoords').mockImplementation(() => ({
      pos: editor.state.doc.content.size,
      inside: -1,
    }));

    const drop = getDropHandler(editor);
    expect(typeof drop).toBe('function');

    drop(editor.view, {
      clientX: 10,
      clientY: 10,
      dataTransfer: {
        files: [imageFile('a.png'), imageFile('b.png'), imageFile('c.jpg')],
      },
      preventDefault: () => {},
      stopPropagation: () => {},
    });

    // copyImage resolves asynchronously per file, sequentially.
    await vi.waitFor(() => {
      expect(imageNodesIn(editor)).toHaveLength(3);
    });

    expect(imageNodesIn(editor)).toHaveLength(3);
    expect(
      imageNodesIn(editor).every((node) =>
        node.attrs.src.startsWith('assets://note-1/'),
      ),
    ).toBe(true);
  });

  it('inserts a dropped image whose File.type is empty (filename mime fallback)', async () => {
    const editor = makeEditor();
    vi.spyOn(editor.view, 'posAtCoords').mockImplementation(() => ({
      pos: editor.state.doc.content.size,
      inside: -1,
    }));

    const drop = getDropHandler(editor);
    // Tauri/WebKit drop files can carry an empty `type`; drop-file's predicate
    // accepts them by filename, so insertImages must not silently skip them.
    drop(editor.view, {
      clientX: 10,
      clientY: 10,
      dataTransfer: { files: [imageFile('no-type.png', '')] },
      preventDefault: () => {},
      stopPropagation: () => {},
    });

    await vi.waitFor(() => {
      expect(imageNodesIn(editor)).toHaveLength(1);
    });

    expect(imageNodesIn(editor)[0].attrs.src).toBe('assets://note-1/mocked.png');
  });
});
