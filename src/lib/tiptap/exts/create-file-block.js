import { Node, mergeAttributes, nodeInputRule } from '@tiptap/core';
import { VueNodeViewRenderer } from '@tiptap/vue-3';
import { saveFile } from '@/utils/assets/storage.js';
import { parseStrokes, serializeStrokes } from './paper-block/ink/stroke-model';
import {
  sanitizeFileSource,
  sanitizeMediaSource,
} from '@/utils/note/contentSecurity.js';

const inputRegex = /!\[(.+|:?)]\((\S+)(?:(?:\s+)["'](\S+)["'])?\)/;

const VIDEO_EXTS = new Set(['mp4', 'webm', 'mov', 'm4v', 'ogv', 'mkv', 'avi']);
const AUDIO_EXTS = new Set([
  'mp3', 'm4a', 'wav', 'ogg', 'oga', 'flac', 'aac', 'opus', 'weba',
]);
const MEDIA_EXTS = new Set([...VIDEO_EXTS, ...AUDIO_EXTS]);

function fileExtension(fileName) {
  const m = /\.([a-z0-9]+)$/i.exec(String(fileName || ''));
  return m ? m[1].toLowerCase() : '';
}

/**
 * Legacy span[data-file-name] HTML carries no data-block-name, so the three
 * factory types race for the same parse rule and fileEmbed won (a pasted
 * .mp4/.mp3 became a file embed). Media types now claim only their own
 * extensions; fileEmbed takes the rest. In-app copies declare
 * data-block-name and are exact either way.
 * shortcut: a media file attached as a *file* embed parses as Video/Audio on
 * legacy HTML only — upgrade to a content-hash discriminator if that shows up.
 */
function claimsLegacySpan(nodeName, fileName) {
  const ext = fileExtension(fileName);
  // PDFs are pdfBlock territory now; fileEmbed no longer accepts them.
  if (nodeName === 'fileEmbed') return !MEDIA_EXTS.has(ext) && ext !== 'pdf';
  if (nodeName === 'Video') return VIDEO_EXTS.has(ext);
  if (nodeName === 'Audio') return AUDIO_EXTS.has(ext);
  return true;
}

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
  // Schema-level src gate (SC-4-02): fileEmbed may carry inline data: URLs of
  // any mime (share-import embeds), media blocks may not.
  const sanitizeSource =
    name === 'fileEmbed' ? sanitizeFileSource : sanitizeMediaSource;
  const baseAttrs = {
    src: { default: null },
    fileName: { default: null },
    // carried, not rendered: survives fileEmbed ⇄ pdfBlock conversion
    markup: {
      default: [],
      parseHTML: (el) => parseStrokes(el.getAttribute('data-markup') || '[]'),
      renderHTML: (attrs) =>
        Array.isArray(attrs.markup) && attrs.markup.length
          ? { 'data-markup': serializeStrokes(attrs.markup) }
          : {},
    },
  };
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
          getAttrs: (el) => {
            const declared = el.getAttribute('data-block-name');
            if (declared && declared !== name) return false;
            const rawSrc = el.getAttribute('data-src') || '';
            const src = sanitizeSource(rawSrc);
            // Keep pending inserts (empty src), drop unsafe schemes entirely.
            if (rawSrc && !src) return false;
            const fileName = el.getAttribute('data-file-name');
            if (!declared && !claimsLegacySpan(name, fileName)) return false;
            return {
              src,
              fileName,
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
              markup: parseStrokes(el.getAttribute('data-markup') || '[]'),
            };
          },
        },
      ];
    },
    renderHTML({ HTMLAttributes }) {
      // Emit data-prefixed names so clipboard HTML round-trips through the
      // parseHTML rules above (which only read data-src/data-file-name/...).
      const renames = {
        src: 'data-src',
        fileName: 'data-file-name',
        width: 'data-width',
        layout: 'data-layout',
      };
      const attrs = {};
      for (const [key, value] of Object.entries(HTMLAttributes)) {
        if (value == null) continue;
        if (key === 'markup') {
          if (Array.isArray(value) && value.length) {
            attrs['data-markup'] = serializeStrokes(value);
          }
          continue;
        }
        attrs[renames[key] || key] = value;
      }
      // Declaring the node type makes clipboard round-trips exact instead of
      // racing the shared span[data-file-name] rule (see claimsLegacySpan).
      attrs['data-block-name'] = name;
      return ['span', mergeAttributes(attrs)];
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
    },
  );
}
