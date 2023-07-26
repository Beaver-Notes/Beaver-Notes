import { Node } from '@tiptap/core';
import {
  makeInlineMathInputRule,
  REGEX_INLINE_MATH_DOLLARS,
} from '@benrbray/prosemirror-math';
import { mathPlugin } from '@benrbray/prosemirror-math';
import '@benrbray/prosemirror-math/style/math.css';
import 'katex/dist/katex.min.css';

export default Node.create({
  name: 'math_inline',
  group: 'inline math',
  content: 'text*',
  inline: true,
  atom: true,
  parseHTML() {
    return [
      {
        tag: 'math-inline',
      },
    ];
  },
  renderHTML() {
    return ['math-inline', { class: 'math-node' }, 0];
  },
  addProseMirrorPlugins() {
    return [mathPlugin];
  },
  addInputRules() {
    return [makeInlineMathInputRule(REGEX_INLINE_MATH_DOLLARS, this.type)];
  },
});
