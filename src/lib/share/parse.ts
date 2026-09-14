// src/lib/share/parse.ts
const SUPPORTED_FILE_RE = /\.(bea|md|mdx|markdown|txt|html)$/i;
const URL_RE = /https?:\/\/[^\s<>"')\]]+/;

export function extractFirstUrl(text: string): string | null {
  const m = text?.match(URL_RE);
  return m ? m[0] : null;
}

export function guessShareKind(input: {
  url?: string | null;
  text?: string | null;
  mimeType?: string | null;
  filePath?: string | null;
}): 'url' | 'text' | 'image' | 'file' {
  const mime = input.mimeType || '';
  if (mime.startsWith('image/')) return 'image';
  if (input.filePath && SUPPORTED_FILE_RE.test(input.filePath)) return 'file';
  if (input.url) return 'url';
  if (input.text) {
    const url = extractFirstUrl(input.text);
    if (url && url.trim() === input.text.trim()) return 'url';
  }
  return 'text';
}

export function createTextContent(text: string) {
  const lines = (text || '').split(/\r?\n/);
  return {
    type: 'doc',
    content: lines.map((line) => ({
      type: 'paragraph',
      content: line ? [{ type: 'text', text: line }] : [],
    })),
  };
}
