import { Node, mergeAttributes, nodeInputRule } from '@tiptap/core';
import { VueNodeViewRenderer } from '@tiptap/vue-3';
import { saveFile } from '@/utils/assets/storage.js';
import { notify } from '@/lib/native/app';

const inputRegex = /!\[(.+|:?)]\((\S+)(?:(?:\s+)["'](\S+)["'])?\)/;

/**
 * Swap the src of a file-like block node (audio/video/file) after its asset
 * finishes saving in the background. Matches by temp src (+ fileName when
 * given, since dialog-picked paths share the same '' temp src).
 */
export function swapFileBlockSrc(view, typeName, tempSrc, finalSrc, fileName) {
  let pos = null;
  let node = null;
  view.state.doc.descendants((n, p) => {
    if (
      n.type.name === typeName &&
      n.attrs.src === tempSrc &&
      (!fileName || n.attrs.fileName === fileName)
    ) {
      pos = p;
      node = n;
      return false;
    }
    return true;
  });
  if (pos == null || !node) return;
  view.dispatch(
    view.state.tr.setNodeMarkup(pos, undefined, { ...node.attrs, src: finalSrc }),
  );
}

/** Remove a pending file-like block (used when the background save fails). */
export function removeFileBlockBySrc(view, typeName, tempSrc, fileName) {  let pos = null;
  let node = null;
  view.state.doc.descendants((n, p) => {
    if (
      n.type.name === typeName &&
      n.attrs.src === tempSrc &&
      (!fileName || n.attrs.fileName === fileName)
    ) {
      pos = p;
      node = n;
      return false;
    }
    return true;
  });
  if (pos == null || !node) return;
  view.dispatch(view.state.tr.delete(pos, pos + node.nodeSize));
}
/**
 * Factory for file-like TipTap block extensions (audio, video, file-embed).
 * `name`/`commandName`/`component` are required; `extraAttrs` adds attribute
 * keys beyond src/fileName; `buildAttrs` maps command args to node attrs.
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
            width: (() => {
              const raw =
                el.getAttribute('data-width') ?? el.getAttribute('width');
              const w = parseInt(raw, 10);
              return Number.isFinite(w) ? w : null;
            })(),
            layout: (() => {
              const raw =
                el.getAttribute('data-layout') ?? el.getAttribute('layout');
              return ['block', 'wrap-left', 'wrap-right'].includes(raw)
                ? raw
                : null;
            })(),
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

/**
 * Optimistic file insert for audio/video/file blocks. `insert` runs
 * synchronously with the temp src so the node appears instantly (a blob URL
 * that plays immediately when holding File bytes, '' for dialog-picked
 * paths); the encrypt streams in the background and src swaps to the final
 * assets:// URL on completion. Failures remove the pending node and toast.
 */
export function insertFileBlockOptimistic(
  view,
  { typeName, insert, file, preview, noteId, fileName },
) {
  const tempSrc = preview ? URL.createObjectURL(preview) : '';
  insert(tempSrc, fileName);
  saveFile(file, noteId).then(
    ({ relativePath }) => {
      if (preview) URL.revokeObjectURL(tempSrc);
      swapFileBlockSrc(view, typeName, tempSrc, relativePath, fileName);
    },
    (error) => {
      if (preview) URL.revokeObjectURL(tempSrc);
      console.error('Background file save failed:', error?.cause ?? error);
      removeFileBlockBySrc(view, typeName, tempSrc, fileName);
      void notify({ title: `${typeName} insert failed`, body: fileName }).catch(() => {});
    },
  );
}
