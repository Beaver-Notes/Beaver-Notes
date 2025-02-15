// tiptap-commands.d.ts
import { Commands } from '@tiptap/core';

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    iframe: {
      /**
       * Add an iframe
       */
      setIframe: (options: { src: string }) => ReturnType;
    };
  }
}
