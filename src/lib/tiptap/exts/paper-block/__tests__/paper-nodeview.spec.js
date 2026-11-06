import { afterEach, describe, expect, it, vi } from 'vitest';
import { defineComponent } from 'vue';
import { mount, flushPromises } from '@vue/test-utils';
import { Editor } from '@tiptap/core';
import Document from '@tiptap/extension-document';
import Paragraph from '@tiptap/extension-paragraph';
import Text from '@tiptap/extension-text';
import Paper from '@/lib/tiptap/exts/paper-block';
import PaperNodeView from '@/lib/tiptap/exts/paper-block/Paper.vue';

vi.mock('@/composable/useTranslations', async () => {
  const { ref } = await import('vue');
  return {
    useTranslations: () => ({ translations: ref({ paperBlock: {} }) }),
  };
});
import { parseStrokes, serializeStrokes } from '@/lib/tiptap/exts/paper-block/ink/stroke-model';

// The Vue node view renderer needs an app context we don't have in tests;
// fall back to ProseMirror's default DOM rendering instead.
vi.mock('@tiptap/vue-3', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    VueNodeViewRenderer: () => undefined,
    NodeViewWrapper: defineComponent({
      name: 'NodeViewWrapper',
      props: { class: { default: '' } },
      template: '<div class="nv-wrapper"><slot /></div>',
    }),
    nodeViewProps: {
      editor: { type: Object, default: null },
      node: { type: Object, required: true },
      selected: { type: Boolean, default: false },
      getPos: { type: Function, default: () => 0 },
      updateAttributes: { type: Function, required: true },
    },
  };
});

vi.mock('@/lib/tiptap/exts/paper-block/PaperSurface.vue', async () => {
  const { defineComponent: dc } = await import('vue');
  return {
    default: dc({
      name: 'PaperSurfaceStub',
      props: {
        strokes: { type: Array, default: () => [] },
        focused: { type: Boolean, default: false },
        tool: { type: String, default: 'pen' },
        toolSettings: { type: Object, default: () => ({}) },
        height: { type: Number, default: 210 },
        paperType: { type: String, default: 'transparent' },
        nodeKey: { type: String, default: '' },
        hint: { type: String, default: '' },
      },
      emits: ['commit', 'update-strokes', 'focus-request', 'height-change'],
      template: '<div class="surface-stub" />',
    }),
  };
});

// v1 format: 2-tuple points, "highlighter" tool name, no ids.
const V1_LINES = [
  { tool: 'highlighter', color: '#fbbf24', points: [[0, 0], [10, 10]] },
  { tool: 'pen', color: '#1a1a1a', points: [[0, 0, 0.5], [4, 4, 0.7]] },
];

const V2_LINES = [
  { tool: 'pen', color: '#1a1a1a', size: 4, points: [[0, 0, 0.5], [4, 4, 0.7]] },
];

const editors = [];

function makeEditor(html = '') {
  const editor = new Editor({
    extensions: [Document, Paragraph, Text, Paper],
    enableCoreExtensions: { paste: false, textDirection: false },
    content: html || undefined,
  });
  editors.push(editor);
  return editor;
}

function makeNode(attrs) {
  return { attrs };
}


function firstPaper(editor) {
  const nodes = [];
  editor.state.doc.descendants((n) => {
    if (n.type.name === 'paper') nodes.push(n);
  });
  return nodes[0];
}

function makeEditorStub() {
  return {
    commands: {
      setNodeSelection: vi.fn(),
      undo: vi.fn(),
      redo: vi.fn(),
    },
    can: () => ({ undo: () => true, redo: () => true }),
  };
}

function mountPaper({ attrs, selected = true } = {}) {
  const editor = makeEditorStub();
  const node = makeNode(
    attrs ?? { strokes: V1_LINES, height: 400, paperType: 'dotted' },
  );
  const updateAttributes = vi.fn((patch) => Object.assign(node.attrs, patch));
  const wrapper = mount(PaperNodeView, {
    props: {
      editor,
      node,
      selected,
      getPos: () => 0,
      updateAttributes,
    },
  });
  return { wrapper, editor, node, updateAttributes };
}

afterEach(() => {
  editors.splice(0).forEach((e) => e.destroy());
});

describe('paper node attrs', () => {
  it('insertPaper defaults to 210px transparent', () => {
    const editor = makeEditor();
    editor.commands.insertPaper();
    const node = firstPaper(editor);
    expect(node.attrs.height).toBe(210);
    expect(node.attrs.paperType).toBe('transparent');
    expect(parseStrokes(node.attrs.strokes)).toEqual([]);
  });

  it('parses legacy v2/v1 html into v3 strokes and serializes only v3', () => {
    const editor = makeEditor(
      `<div data-type="paper" data-lines-v2='${JSON.stringify(V2_LINES)}' data-lines='${JSON.stringify(V1_LINES)}'></div>`,
    );
    firstPaper(editor);

    const html = editor.getHTML();
    expect(html).toContain('data-lines-v3');
    expect(html).not.toContain('data-lines-v2');
    expect(html).not.toContain('data-lines=');
  });
});

describe('Paper node view', () => {
  it('migrates a v1 fixture and commits edits as v3, one transaction per stroke', () => {
    const { wrapper, updateAttributes } = mountPaper({
      attrs: { strokes: JSON.stringify(V1_LINES), height: 400, paperType: 'dotted' },
    });
    const surface = wrapper.findComponent({ name: "PaperSurfaceStub" });
    const migrated = surface.props('strokes');
    expect(migrated).toEqual(parseStrokes(JSON.stringify(V1_LINES)));
    expect(migrated[0].tool).toBe('marker');
    expect(migrated[0].points[0]).toHaveLength(3);

    const stroke = { id: 'new-1', tool: 'pen', color: '#1a1a1a', size: 4, opacity: 1, points: [[1, 1, 0.9]] };
    surface.vm.$emit('commit', stroke);
    expect(updateAttributes).toHaveBeenCalledTimes(1);
    const payload = updateAttributes.mock.calls[0][0];
    expect(Object.keys(payload)).toEqual(['strokes']);
    const parsed = parseStrokes(serializeStrokes(payload.strokes));
    expect(parsed).toHaveLength(3);
    expect(parsed[2]).toEqual(stroke);

    surface.vm.$emit('commit', { ...stroke, id: 'new-2' });
    expect(updateAttributes).toHaveBeenCalledTimes(2);
  });

  it('update-strokes (eraser/lasso) writes the given array in one update', () => {
    const { wrapper, updateAttributes } = mountPaper({
      attrs: { strokes: [], height: 210, paperType: 'transparent' },
    });
    const surface = wrapper.findComponent({ name: "PaperSurfaceStub" });
    const next = [V2_LINES[0]];
    surface.vm.$emit('update-strokes', next);
    expect(updateAttributes).toHaveBeenCalledTimes(1);
    expect(updateAttributes.mock.calls[0][0].strokes).toEqual(next);
  });

  it('focus-request enters editing and selects the node', async () => {
    const { wrapper, editor } = mountPaper({ selected: false });
    const surface = wrapper.findComponent({ name: "PaperSurfaceStub" });
    surface.vm.$emit('focus-request');
    await flushPromises();
    expect(editor.commands.setNodeSelection).toHaveBeenCalledWith(0);
    expect(surface.props('focused')).toBe(true);
  });

  it('toolbar undo button invokes the editor undo command', async () => {
    const { wrapper, editor } = mountPaper({ selected: true });
    const surface = wrapper.findComponent({ name: "PaperSurfaceStub" });
    surface.vm.$emit('focus-request');
    await flushPromises();
    const undoBtn = wrapper.find('button[title="Undo"]');
    expect(undoBtn.exists()).toBe(true);
    await undoBtn.trigger('pointerdown');
    expect(editor.commands.undo).toHaveBeenCalledTimes(1);
  });

  it('height-change rescales strokes to the new height', async () => {
    const { wrapper, updateAttributes } = mountPaper({
      attrs: {
        height: 210,
        paperType: 'transparent',
        strokes: [
          { id: 's1', tool: 'pen', color: '#000000', size: 4, opacity: 1, points: [[10, 20, 0.5]] },
        ],
      },
    });
    wrapper.findComponent({ name: "PaperSurfaceStub" }).vm.$emit('height-change', 420);
    expect(updateAttributes).toHaveBeenCalledWith({
      height: 420,
      strokes: [
        { id: 's1', tool: 'pen', color: '#000000', size: 4, opacity: 1, points: [[20, 40, 0.5]] },
      ],
    });
  });
});
