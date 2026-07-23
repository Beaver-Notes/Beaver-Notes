import { Node, mergeAttributes, nodeInputRule } from '@tiptap/core';
import { VueNodeViewRenderer } from '@tiptap/vue-3';

const inputRegex = /!\[(.+|:?)]\((\S+)(?:(?:\s+)["'](\S+)["'])?\)/;

/**
 * Factory for file-like TipTap block extensions (audio, video, file-embed).
 *
 * @param {object} opts
 * @param {string}  opts.name         – Unique node name (e.g. 'Audio', 'Video', 'fileEmbed')
 * @param {string}  opts.commandName  – Editor command (e.g. 'setAudio', 'setVideo', 'setFileEmbed')
 * @param {object}  opts.component    – Vue component for the node view
 * @param {string[]} [opts.extraAttrs] – Additional attribute keys beyond src/fileName
 * @param {function} [opts.buildAttrs] – (attrs) => object  – map command args to node attrs
 */
export function createFileBlock({
  name,
  commandName,
  component,
  extraAttrs = [],
  buildAttrs,
}) {
  const baseAttrs = { src: { default: null }, fileName: { default: null } };
  for (const key of extraAttrs) {
    if (!(key in baseAttrs)) {
      baseAttrs[key] = { default: null };
    }
  }

  const toAttrs =
    buildAttrs ||
    ((args) => {
      if (Array.isArray(args)) {
        const map = {};
        const keys = ['src', 'fileName', ...extraAttrs];
        args.forEach((v, i) => {
          if (keys[i]) map[keys[i]] = v;
        });
        return map;
      }
      return args || {};
    });

  return Node.create({
    name,
    group: 'block',
    atom: true,
    addAttributes() {
      return baseAttrs;
    },
    parseHTML() {
      return [
        {
          tag: 'span[data-file-name]',
          getAttrs: (el) => ({
            src: el.getAttribute('data-src'),
            fileName: el.getAttribute('data-file-name'),
          }),
        },
      ];
    },
    renderHTML({ HTMLAttributes }) {
      return ['span', mergeAttributes(HTMLAttributes)];
    },
    addNodeView() {
      return VueNodeViewRenderer(component);
    },
    addCommands() {
      return {
        [commandName]:
          (...args) =>
          ({ tr, dispatch }) => {
            const attrs = toAttrs(args);
            const node = this.type.create(attrs);
            const transaction = tr.replaceSelectionWith(node);
            if (transaction) {
              dispatch(transaction);
              return true;
            }
            return false;
          },
      };
    },
    addInputRules() {
      return [nodeInputRule({ find: inputRegex, type: this.type })];
    },
  });
}
