// iframe.ts
import { Node } from '@tiptap/core';

export interface IframeOptions {
  allowFullscreen: boolean;
  HTMLAttributes: Record<string, any>;
  /**
   * Message shown when no src is set. Can be a string or a function (for i18n).
   */
  placeholderText: string | ((opts: { editor: any }) => string);
  /**
   * Tailwind utility classes for the placeholder wrapper.
   * (Centered, muted text by default.)
   */
  placeholderClasses: string;
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    iframe: {
      /** Add an iframe */
      setIframe: (options: { src: string }) => ReturnType;
    };
  }
}

export default Node.create<IframeOptions>({
  name: 'iframe',
  group: 'block',
  atom: true,

  addOptions() {
    return {
      allowFullscreen: true,
      HTMLAttributes: {
        class:
          'iframe-wrapper relative overflow-auto border border-gray-300 resize-y',
        style: 'width: 100%; min-height: 300px; display: flex; align-items: center; justify-content: center;',
      },
      placeholderText: 'Click to insert embed URL',
      placeholderClasses:
        'flex h-full w-full items-center justify-center text-sm text-neutral-500 dark:text-neutral-400 cursor-pointer select-none',
    };
  },

  addAttributes() {
    return {
      src: { default: null },
      frameborder: { default: 0 },
      allowfullscreen: {
        default: this.options.allowFullscreen,
        parseHTML: () => this.options.allowFullscreen,
      },
    };
  },

  parseHTML() {
    return [{ tag: 'iframe' }];
  },

  renderHTML({ HTMLAttributes }) {
    const hasSrc = !!HTMLAttributes.src;

    if (!hasSrc) {
      const text =
        typeof this.options.placeholderText === 'function'
          ? this.options.placeholderText({ editor: this.editor })
          : this.options.placeholderText;

      const wrapperAttrs = {
        ...this.options.HTMLAttributes,
        style: 'width: 100%; height: 300px;',
        class: 'flex items-center justify-center border border-gray-300 text-sm text-neutral-500 dark:text-neutral-400 cursor-pointer select-none',
        'data-placeholder': 'true',
      };

      return ['div', wrapperAttrs, text];
    }


    return ['div', this.options.HTMLAttributes, ['iframe', HTMLAttributes]];
  },

  addCommands() {
    return {
      setIframe:
        (options: { src: string }) =>
          ({ tr, dispatch }) => {
            const { selection } = tr;
            const node = this.type.create(options);
            if (dispatch) tr.replaceRangeWith(selection.from, selection.to, node);
            return true;
          },
    };
  },
});
