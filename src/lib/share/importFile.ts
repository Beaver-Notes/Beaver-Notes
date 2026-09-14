// src/lib/share/importFile.ts
import { convertMarkdownToTiptap } from '@/utils/markdown';
import { htmlToTiptap } from './htmlToTiptap';
import mime from 'mime';
import { bufToBase64 } from '@/utils/crypto/codec.js';

const TEXT_DECODER = new TextDecoder();

export async function importSharedFile(args: {
  fileName: string;
  data: Uint8Array | string;
}): Promise<{ title: string; content: object }> {
  const name = args.fileName.toLowerCase();
  const text = typeof args.data === 'string' ? args.data : TEXT_DECODER.decode(args.data);

  if (name.endsWith('.bea')) {
    const parsed = JSON.parse(text);
    if (!parsed || parsed.content?.type !== 'doc') throw new Error('Invalid .bea payload');
    return { title: parsed.title || '', content: parsed.content };
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
