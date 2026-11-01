// src/lib/share/importFile.ts
import { convertMarkdownToTiptap } from '@/utils/markdown';
import { htmlToTiptap } from './htmlToTiptap';
import mime from 'mime';
import { bufToBase64 } from '@/utils/crypto/codec.js';

const TEXT_DECODER = new TextDecoder();

// The share path never writes .bea asset files to disk (no note id exists
// until saveAll), so inline the base64 payloads embedded in BEA into data:
// URLs — same convention as the image/fileEmbed share branches. Srcs whose
// file is missing from the asset dicts stay untouched, as on desktop import.
function inlineBeaAssets(
  content: Record<string, any>,
  note: { assets?: { notesAssets?: Record<string, string>; fileAssets?: Record<string, string> } }
): Record<string, any> {
  if (!note.assets) return content;
  const dicts: Array<[string, Record<string, string>]> = [
    ['assets://', note.assets.notesAssets || {}],
    ['file-assets://', note.assets.fileAssets || {}],
  ];
  const rewrite = (node: any): void => {
    if (Array.isArray(node)) {
      node.forEach(rewrite);
      return;
    }
    if (!node || typeof node !== 'object') return;
    const src = node.attrs?.src;
    if (typeof src === 'string') {
      for (const [prefix, dict] of dicts) {
        if (!src.startsWith(prefix)) continue;
        const raw = src.slice(prefix.length).split('/').pop() || '';
        let key = raw;
        try {
          const decoded = decodeURIComponent(raw);
          if (!(key in dict)) key = decoded;
        } catch { /* keep raw key */ }
        const base64 = dict[key];
        if (base64) {
          const type = mime.getType(raw) || 'application/octet-stream';
          node.attrs.src = `data:${type};base64,${base64}`;
        }
        break;
      }
    }
    for (const value of Object.values(node)) rewrite(value);
  };
  rewrite(content);
  return content;
}

export async function importSharedFile(args: {
  fileName: string;
  data: Uint8Array | string;
}): Promise<{ title: string; content: object }> {
  const name = args.fileName.toLowerCase();
  const text = typeof args.data === 'string' ? args.data : TEXT_DECODER.decode(args.data);

  if (name.endsWith('.bea')) {
    const parsed = JSON.parse(text);
    // Files written by exportBEA wrap the note in a { data: {...} } envelope;
    // hand-made or third-party files are flat. Unwrap, then validate.
    const note = parsed?.data && typeof parsed.data === 'object' ? parsed.data : parsed;
    if (!note || note.content?.type !== 'doc') throw new Error('Invalid .bea payload');
    return { title: note.title || '', content: inlineBeaAssets(note.content, note) };
  }
  if (name.endsWith('.md') || name.endsWith('.mdx') || name.endsWith('.markdown')) {
    const { title, content } = await convertMarkdownToTiptap(text, '', '');
    return { title, content };
  }
  if (name.endsWith('.html')) {
    return { title: '', content: htmlToTiptap(text) };
  }
  if (name.endsWith('.txt')) {
    const paragraphs = text.split(/\r?\n/).map((line) => ({
      type: 'paragraph',
      content: line ? [{ type: 'text', text: line }] : [],
    }));
    return { title: '', content: { type: 'doc', content: paragraphs } };
  }
  // Keep-as-file fallback: pdf/zip/office/etc. embed as a file-attachment
  // node (exact type/attrs of the fileEmbed block factory: { src, fileName }).
  // src is a data: URL mirroring the image-share convention: no assets://
  // note id exists at hydrate time, sanitizeNoteContent passes fileEmbed
  // through untouched so the src survives, and FileEmbedComponent renders any
  // non-assets:// src as present. Large files cost ~33% base64 overhead in
  // the doc — same trade-off as image shares. Empty payloads keep the old
  // Unsupported error (and the .bea guard above still throws).
  const bytes = typeof args.data === 'string' ? new TextEncoder().encode(args.data) : args.data;
  if (!bytes.length) throw new Error(`Unsupported file type: ${args.fileName}`);
  const type = mime.getType(args.fileName) || 'application/octet-stream';
  return {
    title: args.fileName,
    content: {
      type: 'doc',
      content: [
        {
          type: 'fileEmbed',
          attrs: { src: `data:${type};base64,${bufToBase64(bytes)}`, fileName: args.fileName },
        },
      ],
    },
  };
}
