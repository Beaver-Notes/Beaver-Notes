import { afterEach, describe, expect, it, vi } from 'vitest';
import { Editor } from '@tiptap/core';
import Document from '@tiptap/extension-document';
import Paragraph from '@tiptap/extension-text';
import Image, { ImageNodeView } from '@/lib/tiptap/exts/image';
import { parseStrokes, serializeStrokes } from '@/lib/tiptap/exts/paper-block/ink/stroke-model.js';

vi.mock('@/utils/assets/storage.js', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    default: vi.fn(async () => ({ fileName: 'mocked.png' })),
    writeImageFile: vi.fn(async () => ({ fileName: 'mocked.png' })),
    saveFile: vi.fn(async () => ({ fileName: 'saved.png' })),
  };
});

vi.mock('@/store', () => ({
  useStore: () => ({ activeNoteId: 'note-1' }),
}));

const STROKE = {
  id: 's1',
  tool: 'pen',
  color: '#1a1a1a',
  size: 4,
  opacity: 1,
  points: [
    [10, 10, 0.5],
    [40, 14, 0.6],
    [70, 20, 0.55],
  ],
};

let editors = [];
afterEach(() => {
  editors.forEach((e) => e.destroy());
  editors = [];
});

function penEvent(type, x, y) {
  const event = new PointerEvent(type, {
    pointerType: 'pen',
    clientX: x,
    clientY: y,
    button: 0,
    bubbles: true,
  });
  if (event.pointerType !== 'pen') {
    Object.defineProperty(event, 'pointerType', { value: 'pen' });
  }
  if (event.button !== 0) {
    Object.defineProperty(event, 'button', { value: 0 });
  }
  return event;
}

function fakeTr() {
  const tr = { setNodeMarkup: vi.fn(() => tr), scrollIntoView: vi.fn(() => tr) };
  return tr;
}

function stubEditor() {
  const tr = fakeTr();
  return {
    view: {
      state: { tr },
      dispatch: vi.fn(),
    },
    commands: {
      command: vi.fn(),
    },
  };
}

function fakeNode(attrs = {}) {
  return {
    type: { name: 'image' },
    attrs: {
      src: 'assets://note-1/a.png',
      alt: '',
      markup: [],
      ...attrs,
    },
  };
}

function makeNodeView(attrs = {}) {
  const editor = stubEditor();
  const nodeview = new ImageNodeView({
    node: fakeNode(attrs),
    editor,
    getPos: () => 1,
    resizeLimits: {},
  });
  return { nodeview, editor };
}

describe('image markup overlay', () => {
  it('round-trips data-markup through parseHTML and renderHTML', () => {
    const editor = new Editor({
      extensions: [Document, Paragraph, Image],
      content: `<img src="assets://note-1/a.png" data-markup='${serializeStrokes([STROKE])}'>`,
    });
    editors.push(editor);

    let image = null;
    editor.state.doc.descendants((n) => {
      if (n.type.name === 'image') image = n;
    });
    expect(image).not.toBeNull();
    expect(image.attrs.markup).toHaveLength(1);
    expect(image.attrs.markup[0].tool).toBe('pen');

    const html = editor.getHTML();
    expect(html).toContain('data-markup');
    expect(parseStrokes(image.attrs.markup)).toHaveLength(1);
  });

  it('keeps images without markup clean of the data-markup attr', () => {
    const editor = new Editor({
      extensions: [Document, Paragraph, Image],
      content: '<img src="assets://note-1/a.png">',
    });
    editors.push(editor);
    expect(editor.getHTML()).not.toContain('data-markup');
  });

  it('shows the annotate toggle only on a selected image', () => {
    const { nodeview } = makeNodeView();
    const button = nodeview.dom.querySelector('.bn-image-annotate');
    expect(button).not.toBeNull();
    expect(button.style.display).toBe('none');

    nodeview.selectNode();
    expect(button.style.display).not.toBe('none');

    nodeview.deselectNode();
    expect(button.style.display).toBe('none');
  });

  it('mounts the ink overlay on annotate and persists strokes to the markup attr', () => {
    const { nodeview, editor } = makeNodeView();
    const commitSpy = vi.spyOn(nodeview, 'commitMarkup');
    nodeview.selectNode();

    nodeview.dom.querySelector('.bn-image-annotate').click();

    const surface = nodeview.dom.querySelector('.paper-surface');
    expect(surface).not.toBeNull();

    surface.dispatchEvent(penEvent('pointerdown', 10, 10));
    surface.dispatchEvent(penEvent('pointermove', 30, 12));
    surface.dispatchEvent(penEvent('pointermove', 50, 16));
    surface.dispatchEvent(penEvent('pointerup', 50, 16));

    expect(commitSpy).toHaveBeenCalled();

    const markupCall = editor.view.state.tr.setNodeMarkup.mock.calls.find(
      ([, , attrs]) => Array.isArray(attrs?.markup) && attrs.markup.length > 0,
    );
    expect(markupCall).toBeTruthy();
    const [stroke] = markupCall[2].markup;
    expect(stroke.tool).toBe('pen');
    expect(stroke.points.length).toBeGreaterThanOrEqual(3);
  });

  it('clips strokes to the image bounds (height-change is ignored)', () => {
    const { nodeview } = makeNodeView();
    nodeview.selectNode();
    nodeview.dom.querySelector('.bn-image-annotate').click();

    const surface = nodeview.dom.querySelector('.paper-surface');
    const before = surface.style.height;

    surface.dispatchEvent(penEvent('pointerdown', 10, 10));
    surface.dispatchEvent(penEvent('pointermove', 30, 400));
    surface.dispatchEvent(penEvent('pointermove', 50, 500));
    surface.dispatchEvent(penEvent('pointerup', 50, 500));

    expect(surface.style.height).toBe(before);
  });

  it('exits annotate mode via Done and keeps committed strokes', () => {
    const { nodeview } = makeNodeView();
    nodeview.selectNode();
    nodeview.dom.querySelector('.bn-image-annotate').click();

    nodeview.dom.querySelector('.bn-image-markup-exit').click();

    expect(nodeview.dom.querySelector('.paper-surface')).toBeNull();
    // nothing was committed, nothing lost: annotate can be re-entered
    nodeview.dom.querySelector('.bn-image-annotate').click();
    expect(nodeview.dom.querySelector('.paper-surface')).not.toBeNull();
  });
});
