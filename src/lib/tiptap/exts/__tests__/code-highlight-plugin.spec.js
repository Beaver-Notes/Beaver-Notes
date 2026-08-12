import { describe, expect, it } from 'vitest';
import { Schema } from '@tiptap/pm/model';
import { EditorState, TextSelection } from '@tiptap/pm/state';
import { DecorationSet } from '@tiptap/pm/view';
import {
  createCodeHighlightPlugin,
  codeHighlightPluginKey,
} from '../code-block/plugin';

function makeState() {
  const schema = new Schema({
    nodes: {
      doc: { content: 'block+' },
      code_block: { group: 'block', content: 'text*' },
      text: {},
    },
  });
  const codeText = schema.text('const x = 1');
  const codeBlock = schema.nodes.code_block.create(null, codeText);
  const doc = schema.nodes.doc.create(null, [codeBlock]);
  const plugin = createCodeHighlightPlugin();
  const state = EditorState.create({ schema, doc, plugins: [plugin] });
  return { schema, state, plugin };
}

describe('code-highlight plugin decorations', () => {
  it('builds inline decorations from the token map', () => {
    const { state, plugin } = makeState();
    const tokens = [{ from: 0, to: 5, class: 'shj-syn-key' }];
    // First block starts at position 1 in the doc.
    const next = state.apply(
      state.tr.setMeta(codeHighlightPluginKey, { nodePos: 1, tokens })
    );
    const set = plugin.props.decorations(next);
    expect(set).toBeInstanceOf(DecorationSet);
    const found = set.find(1, 12);
    expect(found.length).toBe(1);
    expect(found[0].type.attrs.class).toBe('shj-syn-key');
  });

  it('returns the cached set for non-doc, non-highlight transactions', () => {
    const { state, plugin } = makeState();
    const next = state.apply(
      state.tr.setMeta(codeHighlightPluginKey, {
        nodePos: 1,
        tokens: [{ from: 0, to: 5, class: 'shj-syn-key' }],
      })
    );
    const first = plugin.props.decorations(next);

    // A selection-only transaction must not rebuild the decoration set.
    const selOnly = next.apply(
      next.tr.setSelection(new TextSelection(next.doc.resolve(3)))
    );
    const second = plugin.props.decorations(selOnly);
    expect(second).toBe(first);
  });

  it('rebuilds after a doc change', () => {
    const { state, plugin } = makeState();
    const next = state.apply(
      state.tr.setMeta(codeHighlightPluginKey, {
        nodePos: 1,
        tokens: [{ from: 0, to: 5, class: 'shj-syn-key' }],
      })
    );
    const first = plugin.props.decorations(next);

    const edited = next.apply(next.tr.insertText(' more'));
    const rebuilt = plugin.props.decorations(edited);
    expect(rebuilt).not.toBe(first);
  });
});
