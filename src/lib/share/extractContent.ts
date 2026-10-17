// src/lib/share/extractContent.ts
// URL extraction for inbound shares: static HTML via Rust, parsed with
// Defuddle's async pipeline (site extractors first — YouTube transcripts —
// then generic readability), served two ways from one pass:
//   - markdown → note importer (convertMarkdownToTiptap, the .md path)
//   - contentHtml → legacy htmlToTiptap (append-to-existing-note only)
import { invokeCommand } from '@/lib/tauri/commands.js';

export interface ExtractedUrlContent {
  title: string;
  /** Legacy append path (targetNoteId items). */
  contentHtml: string;
  /** Importer path (new notes). Empty when Defuddle found nothing. */
  markdown: string;
  textContent: string;
}

const EMPTY: ExtractedUrlContent = { title: '', contentHtml: '', markdown: '', textContent: '' };

/** YouTube video id from watch / youtu.be / shorts / embed / live URLs (VideoComponent embed). */
export function youtubeEmbedId(url: string): string | null {
  const match = (url || '').match(
    /(?:youtube(?:-nocookie)?\.com\/(?:watch\?[^#]*?v=|shorts\/|embed\/|live\/)|youtu\.be\/)([\w-]{6,})/,
  );
  return match?.[1] ?? null;
}

/** Rewrite relative src/href in an HTML fragment against the page URL. */
export function absolutizeRelativeUrls(html: string, base: string): string {
  if (!html) return html;
  let origin = '';
  try {
    origin = new URL(base).origin;
  } catch {
    return html;
  }
  return html.replace(/(src|href)="([^"]+)"/g, (match, attr, value) => {
    if (/^(https?:|data:|#|mailto:)/i.test(value)) return match;
    try {
      const absolute = value.startsWith('/') ? origin + value : new URL(value, base).href;
      return `${attr}="${absolute}"`;
    } catch {
      return match;
    }
  });
}

/** Rewrite relative markdown image/link destinations against the page URL. */
export function absolutizeMarkdownUrls(markdown: string, base: string): string {
  if (!markdown) return markdown;
  let origin = '';
  try {
    origin = new URL(base).origin;
  } catch {
    return markdown;
  }
  return markdown.replace(/(!?\[[^\]]*\]\()([^)\s]+)(\))/g, (match, open, dest, close) => {
    if (/^(https?:|data:|#|mailto:)/i.test(dest)) return match;
    try {
      const absolute = dest.startsWith('/') ? origin + dest : new URL(dest, base).href;
      return `${open}${absolute}${close}`;
    } catch {
      return match;
    }
  });
}

export async function extractFromUrl(url: string): Promise<ExtractedUrlContent> {
  let html = '';
  try {
    html = await invokeCommand<string>('fetch_page_html', { url });
  } catch {
    return EMPTY;
  }
  if (!html) return EMPTY;
  try {
    // ponytail: full bundle (Turndown markdown) via dynamic import so the
    // 761KB stays out of the main chunk; core dist has no markdown output.
    const { default: Defuddle } = await import('defuddle/full');
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const result = await new Defuddle(doc, { url, separateMarkdown: true }).parseAsync();
    return {
      title: result.title || '',
      contentHtml: absolutizeRelativeUrls(result.content || '', url),
      markdown: absolutizeMarkdownUrls(result.contentMarkdown || '', url),
      textContent: doc.body?.textContent?.trim() || '',
    };
  } catch {
    return EMPTY;
  }
}

/**
 * Importer path: Defuddle markdown → the .md note importer. The importer
 * lifts a leading H1 to the note title, so the Defuddle title is prepended
 * (unless the markdown already opens with a heading). A YouTube page URL
 * additionally gets a leading Video node — the importer only maps relative
 * local-file links to file nodes, so without this the player has nothing
 * to render.
 */
export async function extractedToNote(
  extracted: Pick<ExtractedUrlContent, 'title' | 'markdown'>,
  url?: string,
): Promise<{ title: string; content: object }> {
  const { convertMarkdownToTiptap } = await import('@/utils/markdown.js');
  const body = extracted.markdown || '';
  const composed =
    extracted.title && !/^#\s/m.test(body) ? `# ${extracted.title}\n\n${body}` : body;
  const { title, content } = await convertMarkdownToTiptap(composed, '', '');
  const resolvedTitle = title || extracted.title;
  if (url && youtubeEmbedId(url)) {
    const node = { type: 'Video', attrs: { src: url, fileName: resolvedTitle } };
    const blocks = (content as any)?.content;
    if (Array.isArray(blocks)) blocks.unshift(node);
    else (content as any).content = [node];
  }
  return { title: resolvedTitle, content };
}
