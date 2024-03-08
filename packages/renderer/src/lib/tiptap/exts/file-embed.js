import { Node, nodeInputRule } from '@tiptap/core';

const { ipcRenderer } = window.electron;

const FileEmbed = Node.create({
  name: 'fileEmbed',

  group: 'block',

  addAttributes() {
    return {
      src: {
        default: null,
        parseHTML: (el) => el.getAttribute('src'),
        renderHTML: (attrs) => ({ src: attrs.src }),
      },
      fileName: {
        default: null,
        parseHTML: (el) => el.getAttribute('data-file-name'),
      },
    };
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
    return [
      'span',
      {
        src: HTMLAttributes.src,
        'data-file-name': HTMLAttributes.fileName,
        class:
          'p-2 w-full bg-[#F8F8F7] hover:bg-[#EFEFEF] dark:hover:bg-[#373737] dark:bg-[#353333] rounded-lg cursor-pointer', // Add cursor pointer
      },
      HTMLAttributes.fileName,
    ];
  },

  addCommands() {
    return {
      setFileEmbed:
        (src, fileName) =>
        ({ commands }) =>
          commands.insertContent(
            `<span data-src="${src}" data-file-name="${fileName}">${fileName}</span>`
          ),
    };
  },

  addInputRules() {
    return [
      nodeInputRule({
        find: /!\[(.+|:?)]\((\S+)(?:(?:\s+)["'](\S+)["'])?\)/,
        type: this.type,
        getAttributes: (match) => {
          const [, src, fileName] = match;
          return { src, fileName };
        },
      }),
    ];
  },
});

document.addEventListener('click', (event) => {
  const span = event.target.closest('span[data-file-name]');
  if (span) {
    const src = span.getAttribute('src');
    openDocument(src);
  }
});

export function openDocument(src) {
  ipcRenderer.callMain('open-file-external', src);
}

export default FileEmbed;
