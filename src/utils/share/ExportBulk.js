import dayjs from '@/lib/dayjs';
import { useStorage } from '@/composable/storage';
import { useFolderStore } from '@/store/folder';
import { useNoteStore } from '@/store/note';
import { path } from '@/lib/tauri-bridge';
import { getAppDirectory } from '@/lib/native/app';
import { readData } from '@/lib/native/fs';
import mime from 'mime';
import {
  chooseExportDirectory,
  copyExportPath,
  ensureExportDir,
  writeExportFile,
} from '@/lib/native/exports';
import {
  escapeHtml,
  normalizeWhitespace,
  getNodeChildren,
  getDocContent,
  collectDescendantText,
  resolveAssetOutputPath,
  getFootnoteNumber,
  createRenderContext,
  tiptapToMarkdown,
  buildFrontmatter,
} from '@/utils/markdown';

const INVALID_FILE_CHARS = /[\/\\:*?"<>|]/g;

const A4_CSS_W = 794;
const PAGE_MARGIN_PX = 48;
const A4_PT_W = 595;
const A4_PT_H = 842;

// Page margin applied to the PDF output. The CSS shrinks the rendered
// content width by 2× this value on each side, and the Rust splitter
// applies the same margin in points when stamping onto A4 pages.
//
// The Rust constant `PDF_PAGE_MARGIN_PT` is derived from this value:
//   content width (pt) = (A4_CSS_W - 2 × PDF_PAGE_MARGIN_CSS_PX) × 0.75
//   margin (pt) = (A4_PT_W - content width) / 2
// Keep the two in sync if you change this number.
const PDF_PAGE_MARGIN_CSS_PX = 60; // ≈ 12.7mm

const CALLOUT_STYLES = `
.callout {
  border-left: 4px solid;
  padding: 1em;
  margin: 1em 0;
  border-radius: 4px;
}
.callout-black  { background:#1f1f1f; color:#fff;    border-color:#444; }
.callout-blue   { background:#e0f2fe; border-color:#3b82f6; }
.callout-yellow { background:#fef9c3; border-color:#facc15; }
.callout-red    { background:#fee2e2; border-color:#ef4444; }
.callout-green  { background:#dcfce7; border-color:#10b981; }
.callout-purple { background:#ede9fe; border-color:#8b5cf6; }
`;

const HIGHLIGHT_RGBA = {
  'bg-[#DC8D42]/30': 'rgba(220,141,66,0.30)',
  'bg-[#DC8D42]/40': 'rgba(220,141,66,0.40)',
  'bg-[#E3B324]/30': 'rgba(227,179,36,0.30)',
  'bg-[#E3B324]/40': 'rgba(227,179,36,0.40)',
  'bg-[#4CAF50]/30': 'rgba(76,175,80,0.30)',
  'bg-[#4CAF50]/40': 'rgba(76,175,80,0.40)',
  'bg-[#3A8EE6]/30': 'rgba(58,142,230,0.30)',
  'bg-[#3A8EE6]/40': 'rgba(58,142,230,0.40)',
  'bg-[#9B5EE6]/30': 'rgba(155,94,230,0.30)',
  'bg-[#9B5EE6]/40': 'rgba(155,94,230,0.40)',
  'bg-[#E67EA4]/30': 'rgba(230,126,164,0.30)',
  'bg-[#E67EA4]/40': 'rgba(230,126,164,0.40)',
  'bg-[#E75C5C]/30': 'rgba(231,92,92,0.30)',
  'bg-[#E75C5C]/40': 'rgba(231,92,92,0.40)',
};

// ── Inlined from export-staging.js ──────────────────────────────────────────

export async function chooseRootExportDir(title) {
  const { canceled, filePaths = [] } = await chooseExportDirectory(title);
  if (canceled || !filePaths.length) return null;
  return filePaths[0];
}

export async function createDatedExportRoot(rootDir, prefix) {
  const outputRoot = path.join(
    rootDir,
    `${prefix} ${dayjs().format('YYYY-MM-DD')}`
  );
  await ensureExportDir(outputRoot);
  return outputRoot;
}

export async function writeTextExportFile(filePath, data) {
  await writeExportFile(filePath, data);
}

export async function ensureExportFolder(targetPath) {
  await ensureExportDir(targetPath);
}

export async function copyExportAssetDir(sourcePath, destPath) {
  try {
    await ensureExportDir(destPath);
    await copyExportPath(sourcePath, destPath);
  } catch (error) {
    console.warn('Asset copy failed:', error);
  }
}

export async function copyNoteAssetDirectories(
  appDirectory,
  noteId,
  outputDir
) {
  if (!appDirectory) return;

  await copyExportAssetDir(
    path.join(appDirectory, 'notes-assets', noteId),
    path.join(outputDir, 'assets', noteId)
  );
  await copyExportAssetDir(
    path.join(appDirectory, 'file-assets', noteId),
    path.join(outputDir, 'file-assets', noteId)
  );
}

// ── Exported utility functions ──────────────────────────────────────────────

export function sanitizeFileName(value) {
  const sanitized = String(value || '')
    .replace(INVALID_FILE_CHARS, '-')
    .trim();
  return sanitized || 'Untitled';
}

function buildHtmlInlineFallback(node) {
  return escapeHtml(collectDescendantText(node));
}

function normalizeAssetPath(url) {
  const m1 = url.match(/^file-assets:\/\/[^/]+\/(.+)$/);
  if (m1) return `file-assets/${m1[1]}`;
  const m2 = url.match(/^assets:\/\/[^/]+\/(.+)$/);
  if (m2) return `assets/${m2[1]}`;
  return url;
}

function getMimeType(src) {
  return mime.getType(src) || 'image/png';
}

// ── Web page CSS builder (from export-html.js) ──────────────────────────────

function buildWebPageCss(pageWidth, pageMargin, isPaginated) {
  const padding = isPaginated ? '0' : `${pageMargin}px`;

  const shared = `
  *, *::before, *::after { box-sizing: border-box; }

  html, body {
    margin: 0;
    padding: 0;
    background: transparent;
    overflow-x: hidden;
  }

  * {
    -webkit-print-color-adjust: exact !important;
    print-color-adjust: exact !important;
  }

  .export-root {
    font-size: 1.065rem;
    line-height: 1.5;
    padding: ${padding};
    background: #ffffff;
    color: #1f1f1f;
    width: 100%;
    max-width: ${pageWidth}px;
    overflow-x: hidden;
    margin: 0 auto;
  }
  .dark .export-root {
    background: #171717;
    color: #e5e5e5;
  }
  .export-root .ProseMirror {
    outline: none;
    min-height: auto !important;
    padding-inline-start: 0 !important;
  }

  .export-root .ProseMirror-trailingBreak,
  .export-root .ProseMirror-gapcursor,
  .export-root .drag-handle,
  .export-root .grid-resize-handle,
  .export-root .bn-image-resize-handle,
  .export-root .column-resize-handle,
  .export-root .paper-inline-toolbar,
  .export-root .paper-draw-hint,
  .export-root .collapse-indicator,
  .export-root [contenteditable="false"]::after,
  .export-root .is-editor-empty::before {
    display: none !important;
  }
  .export-root [contenteditable] { contenteditable: unset; }

  .export-title {
    font-size: 2.5rem;
    font-weight: 700;
    line-height: 1.2;
    margin: 0 0 1.5em 0;
    padding: 0;
    color: inherit;
  }

  .export-root table,
  .export-root figure,
  .export-root img,
  .export-root .callout,
  .export-root pre,
  .export-root blockquote {
    break-inside: avoid;
    page-break-inside: avoid;
  }

  /* Table rows stay together; the table itself can split between rows */
  .export-root tr,
  .export-root thead {
    break-inside: avoid;
    page-break-inside: avoid;
  }

  /* Oversized images / SVGs: scale down instead of being cropped */
  .export-root svg {
    max-width: 100%;
    max-height: 95vh;
    height: auto;
  }

  /* Prevent single-line orphans on headings */

  .export-root h1, .export-root h2, .export-root h3,
  .export-root h4, .export-root h5, .export-root h6 {
    break-after: avoid;
    page-break-after: avoid;
    break-inside: avoid;
    page-break-inside: avoid;
    margin-top: 1.5em;
    margin-bottom: 0.5em;
  }
  .export-root h1 { margin-top: 0; }

  .export-root p { orphans: 3; widows: 3; }

  .export-root img { max-width: 100%; height: auto; display: block; }

  .export-root table { border-collapse: collapse; width: 100%; }
  .export-root td, .export-root th {
    border: 1px solid #d1d5db;
    padding: 0.4em 0.6em;
  }
  .dark .export-root td, .dark .export-root th { border-color: #404040; }
  .export-root a { color: inherit; text-decoration: underline; }

  .export-root mark {
    box-decoration-break: clone;
    -webkit-box-decoration-break: clone;
    padding: 0 2px;
    border-radius: 3px;
  }

  .export-root sup {
    vertical-align: super;
    font-size: 0.75em;
    line-height: 1;
  }
  .export-root .footnote-ref {
    text-decoration: none;
    color: inherit;
  }
  .export-root .footnotes {
    margin-top: 2em;
    padding-top: 1em;
    border-top: 1px solid #d1d5db;
    font-size: 0.875rem;
    clear: both;
  }
  .dark .export-root .footnotes { border-top-color: #404040; }
  .export-root .footnotes li { margin-bottom: 0.5em; }
  `;

  if (isPaginated) {
    const contentW = Math.max(A4_CSS_W - 2 * PDF_PAGE_MARGIN_CSS_PX, 100);
    return `
  ${shared}

  /*
   * Note: WKWebView.createPDF ignores @page rules, so the page margin
   * is enforced by (a) shrinking the rendered content width below and
   * (b) the Rust splitter insetting each A4 page by the same margin in
   * points. PDF_PAGE_MARGIN_CSS_PX must match the splitter's margin in
   * points (the splitter applies the pt equivalent of this CSS value).
   */

  html {
    width: ${A4_CSS_W}px !important;
    max-width: ${A4_CSS_W}px !important;
  }

  body {
    width: ${A4_CSS_W}px !important;
    max-width: ${A4_CSS_W}px !important;
    margin: 0 auto !important;
    background: #ffffff !important;
    color: #1f1f1f !important;
  }

  .export-root {
    width: ${contentW}px !important;
    max-width: ${contentW}px !important;
    padding: 0 !important;
    margin: 0 auto !important;
    background: transparent !important;
  }

  img {
    max-width: 100% !important;
    height: auto !important;
    width: auto !important;
  }

  table, pre {
    max-width: 100% !important;
    overflow: visible !important;
  }
    `;
  }

  return `
  ${shared}

  @media print {
    @page {
      size: A4 portrait;
      margin: 12mm;
    }

    html, body {
      width: 100% !important;
      background: #ffffff !important;
      color: #1f1f1f !important;
    }

    .export-root {
      width: 100% !important;
      max-width: 100% !important;
      padding: 0 !important;
      background: transparent !important;
    }

    img {
      max-width: 100% !important;
      max-height: calc(297mm - 3cm) !important;
      height: auto !important;
      width: auto !important;
    }

    table, pre {
      max-width: 100% !important;
      overflow: visible !important;
    }
  }
  `;
}

// ── HTML renderers ──────────────────────────────────────────────────────────

function renderHtmlInline(nodes, ctx) {
  return (nodes || []).map((node) => renderHtmlInlineNode(node, ctx)).join('');
}

function renderHtmlInlineNode(node, ctx) {
  if (!node) return '';

  switch (node.type) {
    case 'text': {
      let text = escapeHtml(normalizeWhitespace(node.text ?? ''));
      const marks = Array.isArray(node.marks) ? [...node.marks] : [];
      const nonLinkMarks = marks.filter((mark) => mark.type !== 'link');
      const linkMarks = marks.filter((mark) => mark.type === 'link');

      nonLinkMarks.forEach((mark) => {
        if (mark.type === 'bold') {
          text = `<strong>${text}</strong>`;
        } else if (mark.type === 'italic') {
          text = `<em>${text}</em>`;
        } else if (mark.type === 'code') {
          text = `<code>${text}</code>`;
        } else if (mark.type === 'strike') {
          text = `<s>${text}</s>`;
        }
      });

      linkMarks.forEach((mark) => {
        const href = escapeHtml(mark?.attrs?.href || '');
        text = `<a href="${href}">${text || href}</a>`;
      });

      return text;
    }
    case 'hardBreak':
      return '<br>';
    case 'image': {
      const src = escapeHtml(
        resolveAssetOutputPath(node?.attrs?.src, ctx.noteId)
      );
      const alt = escapeHtml(node?.attrs?.alt || '');
      return `<img src="${src}" alt="${alt}">`;
    }
    case 'math_inline': {
      const value =
        node?.attrs?.content ||
        renderHtmlInline(getNodeChildren(node), ctx) ||
        buildHtmlInlineFallback(node);
      return `<code>${escapeHtml(value.replace(/<[^>]+>/g, ''))}</code>`;
    }
    case 'footnoteReference': {
      const number = getFootnoteNumber(node.attrs, ctx);
      return `<sup id="fnref:${escapeHtml(
        number
      )}"><a class="footnote-ref" href="#fn:${escapeHtml(
        number
      )}" data-reference-number="${escapeHtml(number)}">${escapeHtml(
        number
      )}</a></sup>`;
    }
    case 'fileEmbed': {
      const href = escapeHtml(
        resolveAssetOutputPath(node?.attrs?.src, ctx.noteId)
      );
      const label = escapeHtml(
        node?.attrs?.fileName || path.basename(href) || 'Attachment'
      );
      return `<a href="${href}" download>${label}</a>`;
    }
    case 'iframe': {
      const src = escapeHtml(node?.attrs?.src || '');
      const width = escapeHtml(node?.attrs?.width || '560');
      const height = escapeHtml(node?.attrs?.height || '315');
      const frameborder = escapeHtml(node?.attrs?.frameborder ?? '0');
      const allow = escapeHtml(node?.attrs?.allow || '');
      const allowfullscreen = node?.attrs?.allowfullscreen
        ? ' allowfullscreen'
        : '';
      return `<iframe src="${src}" width="${width}" height="${height}" frameborder="${frameborder}" allow="${allow}"${allowfullscreen}></iframe>`;
    }
    case 'Audio': {
      const src = escapeHtml(
        resolveAssetOutputPath(node?.attrs?.src, ctx.noteId)
      );
      return `<audio controls src="${src}">Your browser does not support the audio element.</audio>`;
    }
    case 'Video': {
      const src = escapeHtml(
        resolveAssetOutputPath(node?.attrs?.src, ctx.noteId)
      );
      return `<video controls src="${src}" style="max-width: 100%; height: auto;">Your browser does not support the video tag.</video>`;
    }
    default:
      if (getNodeChildren(node).length > 0) {
        return renderHtmlInline(getNodeChildren(node), ctx);
      }
      return buildHtmlInlineFallback(node);
  }
}

function renderHtmlListItem(node, ctx, options = {}) {
  const { task = false } = options;
  const children = getNodeChildren(node);
  const content = children
    .map((child) => {
      if (child?.type === 'paragraph') {
        return renderHtmlInline(getNodeChildren(child), ctx);
      }
      if (['bulletList', 'orderedList', 'taskList'].includes(child?.type)) {
        return renderHtmlBlock(child, ctx);
      }
      return renderHtmlBlock(child, ctx);
    })
    .join('');

  const fallback = buildHtmlInlineFallback(node);
  if (!task) {
    return `<li>${content || fallback}</li>`;
  }

  const checked = node?.attrs?.checked ? ' checked' : '';
  return `<li><label><input type="checkbox" disabled${checked}> ${
    content || fallback
  }</label></li>`;
}

function renderHtmlTable(node, ctx) {
  const rows = getNodeChildren(node).filter(
    (child) => child?.type === 'tableRow'
  );
  if (!rows.length) return '';

  const headerCells = getNodeChildren(rows[0]).map(
    (cell) =>
      `<th>${renderHtmlInline(getNodeChildren(cell), ctx) || '&nbsp;'}</th>`
  );
  const bodyRows = rows.slice(1).map((row) => {
    const cells = getNodeChildren(row).map(
      (cell) =>
        `<td>${renderHtmlInline(getNodeChildren(cell), ctx) || '&nbsp;'}</td>`
    );
    return `<tr>${cells.join('')}</tr>`;
  });

  return `<table><thead><tr>${headerCells.join(
    ''
  )}</tr></thead><tbody>${bodyRows.join('')}</tbody></table>`;
}

function renderHtmlFootnote(node, ctx) {
  const number = getFootnoteNumber(node.attrs, ctx);
  const body = getNodeChildren(node)
    .map((child) => renderHtmlBlock(child, ctx))
    .join('');
  return `<li id="fn:${escapeHtml(
    number
  )}" class="footnotes" data-id="${escapeHtml(
    node?.attrs?.['data-id'] || ''
  )}">${body}</li>`;
}

function renderHtmlBlock(node, ctx) {
  if (!node) return '';

  switch (node.type) {
    case 'doc':
      return renderHtmlBlocks(getNodeChildren(node), ctx);
    case 'paragraph':
      return `<p>${renderHtmlInline(getNodeChildren(node), ctx)}</p>`;
    case 'heading': {
      const level = Math.min(Math.max(Number(node?.attrs?.level || 1), 1), 4);
      return `<h${level}>${renderHtmlInline(
        getNodeChildren(node),
        ctx
      )}</h${level}>`;
    }
    case 'bulletList':
      return `<ul>${getNodeChildren(node)
        .map((child) => renderHtmlListItem(child, ctx))
        .join('')}</ul>`;
    case 'orderedList':
      return `<ol>${getNodeChildren(node)
        .map((child) => renderHtmlListItem(child, ctx))
        .join('')}</ol>`;
    case 'taskList':
      return `<ul>${getNodeChildren(node)
        .map((child) => renderHtmlListItem(child, ctx, { task: true }))
        .join('')}</ul>`;
    case 'codeBlock': {
      const language = node?.attrs?.language || '';
      const code = getNodeChildren(node)
        .map((child) => child?.text || '')
        .join('');
      return `<pre><code${
        language ? ` class="language-${escapeHtml(language)}"` : ''
      }>${escapeHtml(code)}</code></pre>`;
    }
    case 'blockquote':
      return `<blockquote>${getNodeChildren(node)
        .map((child) => renderHtmlBlock(child, ctx))
        .join('')}</blockquote>`;
    case 'horizontalRule':
      return '<hr>';
    case 'mathBlock': {
      const content = getNodeChildren(node)
        .map((child) => child?.text || '')
        .join('');
      return `<pre><code class="language-math">${escapeHtml(
        content
      )}</code></pre>`;
    }
    case 'callout': {
      const color = node?.attrs?.color || 'blue';
      const body = getNodeChildren(node)
        .map((child) => renderHtmlBlock(child, ctx))
        .join('');
      return `<div class="callout callout-${escapeHtml(color)}">${body}</div>`;
    }
    case 'table':
      return renderHtmlTable(node, ctx);
    case 'footnotes':
      return `<ol>${getNodeChildren(node)
        .map((child) => renderHtmlFootnote(child, ctx))
        .join('')}</ol>`;
    case 'footnote':
      return renderHtmlFootnote(node, ctx);
    default:
      if (getNodeChildren(node).length > 0) {
        return getNodeChildren(node)
          .map((child) => renderHtmlBlock(child, ctx))
          .join('');
      }
      const fallback = collectDescendantText(node);
      if (!fallback) return '';
      return `<p>${escapeHtml(fallback)}</p>`;
  }
}

function renderHtmlBlocks(nodes, ctx) {
  return (nodes || []).map((node) => renderHtmlBlock(node, ctx)).join('');
}

// ── Tiptap JSON → HTML converter ───────────────────────────────────────────

export function tiptapToHtml(content, options = {}) {
  const { noteId = '' } = options;
  const nodes = getDocContent(content);
  if (!nodes.length) return '';
  const ctx = createRenderContext(noteId);
  return renderHtmlBlocks(nodes, ctx).trim();
}

// ── Folder tree helpers (used by bulk export) ──────────────────────────────

export function getFolderPath(folderId, folders) {
  if (!folderId || !folders) return '';
  const parts = [];
  let current = folders[folderId] || folders.find((f) => f.id === folderId);
  while (current) {
    parts.unshift(current.name || '');
    current = current.parentId
      ? folders[current.parentId] ||
        folders.find((f) => f.id === current.parentId)
      : null;
  }
  return parts.join('/');
}

export function buildFolderTree(folders) {
  if (!folders) return {};
  const tree = {};
  const list = Array.isArray(folders) ? folders : Object.values(folders);
  list.forEach((folder) => {
    if (!folder) return;
    tree[folder.id] = folder.name || 'Unnamed';
  });
  return tree;
}

// ── Bulk export: Markdown ──────────────────────────────────────────────────

export async function exportAllMarkdown(onProgress) {
  const storage = useStorage();
  const noteStore = useNoteStore();
  const folderStore = useFolderStore();
  const allNotes = await storage.store();
  const notesArray = Array.isArray(allNotes)
    ? allNotes
    : Object.values(allNotes.notes || {});
  const folders = folderStore?.data || {};

  const rootDir = await chooseRootExportDir('Select export folder');
  if (!rootDir) return null;

  const outputRoot = await createDatedExportRoot(rootDir, 'Markdown-Export');
  const total = notesArray.length;
  let done = 0;

  for (const note of notesArray) {
    try {
      const folderPath = getFolderPath(note.folderId, folders);
      const folderDir = folderPath
        ? path.join(outputRoot, folderPath)
        : outputRoot;
      await ensureExportFolder(folderDir);

      const safeName = sanitizeFileName(note.title || 'Untitled');
      const frontmatter = buildFrontmatter(note, folderPath);
      const mdBody = tiptapToMarkdown(note.content, { noteId: note.id });
      const content = frontmatter ? `${frontmatter}\n${mdBody}` : mdBody;
      await writeTextExportFile(
        path.join(folderDir, `${safeName}.md`),
        content
      );
      await copyNoteAssetDirectories(
        await getAppDirectory(),
        note.id,
        folderDir
      );
    } catch (err) {
      console.warn(`Failed to export "${note.title}":`, err);
    }
    done++;
    onProgress?.({ done, total });
  }
  return { outputRoot };
}

// ── Bulk export: HTML ──────────────────────────────────────────────────────

export async function exportAllHTML(onProgress) {
  const storage = useStorage();
  const noteStore = useNoteStore();
  const folderStore = useFolderStore();
  const allNotes = await storage.store();
  const notesArray = Array.isArray(allNotes)
    ? allNotes
    : Object.values(allNotes.notes || {});
  const folders = folderStore?.data || {};

  const rootDir = await chooseRootExportDir('Select export folder');
  if (!rootDir) return null;

  const outputRoot = await createDatedExportRoot(rootDir, 'HTML-Export');
  const total = notesArray.length;
  let done = 0;

  for (const note of notesArray) {
    try {
      const folderPath = getFolderPath(note.folderId, folders);
      const folderDir = folderPath
        ? path.join(outputRoot, folderPath)
        : outputRoot;
      await ensureExportFolder(folderDir);

      const safeName = sanitizeFileName(note.title || 'Untitled');
      const htmlBody = tiptapToHtml(note.content, { noteId: note.id });
      const title = escapeHtml(note.title || 'Untitled');
      const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${title}</title>
  <style>${buildWebPageCss(A4_CSS_W, PAGE_MARGIN_PX, false)}</style>
  <style>${CALLOUT_STYLES}</style>
</head>
<body>
  <div class="export-root prose prose-stone max-w-none">
    <h1 class="export-title">${title}</h1>
    ${htmlBody}
  </div>
</body>
</html>`;
      await writeTextExportFile(path.join(folderDir, `${safeName}.html`), html);
      await copyNoteAssetDirectories(
        await getAppDirectory(),
        note.id,
        folderDir
      );
    } catch (err) {
      console.warn(`Failed to export "${note.title}":`, err);
    }
    done++;
    onProgress?.({ done, total });
  }
  return { outputRoot };
}

// ── Web export document builder (from export-html.js) ───────────────────────

function collectPageStyles() {
  const contentHrefPatterns = [
    'katex',
    'highlight.js',
    'prosemirror',
    'tauri',
    'tailwind',
    'tiptap',
    'beaver',
    'editor',
    'note',
    'content',
    'typography',
    'app',
    'main',
    'index',
  ];

  const uiHrefPatterns = [
    'remixicon',
    'toastify',
    'overlayscrollbars',
    'v-tooltip',
    'vue-tooltip',
    'vue-select',
    'vuedraggable',
    'command-palette',
    'masonry',
    'context-menu',
    'toolbar',
    'sidebar',
  ];

  const uiSelectorPatterns = [
    '.command-prompt',
    '.note-card',
    '.masonry',
    '.context-menu',
    '.sidebar',
    '.toolbar',
    '.toast',
    '.dropdown',
    '.drawer',
    '.sheet',
    '.popover',
    '.tooltip',
    '.Vue-Toastification',
    '.toastify',
  ];

  function isUiRule(text) {
    const selector = text.split('{')[0];
    return uiSelectorPatterns.some((p) => selector.includes(p));
  }

  const cssParts = [];

  for (const sheet of document.styleSheets) {
    try {
      if (!sheet.cssRules) continue;
      const href = sheet.href || '';
      if (href) {
        const lower = href.toLowerCase();
        if (uiHrefPatterns.some((p) => lower.includes(p))) continue;
        if (!contentHrefPatterns.some((p) => lower.includes(p))) continue;
      }
      for (const rule of sheet.cssRules) {
        const text = rule.cssText;
        if (text.includes('[data-v-')) continue;
        if (isUiRule(text)) continue;
        if (rule.type === CSSRule.KEYFRAMES_RULE) continue;
        cssParts.push(text);
      }
    } catch {
      // CORS-restricted stylesheet — skip.
    }
  }

  return cssParts.join('\n');
}

export function sanitizeClone(clone) {
  const toRemove = [
    '.drag-handle',
    '.grid-resize-handle',
    '.bn-image-resize-handle',
    '.column-resize-handle',
    '.ProseMirror-trailingBreak',
    '.ProseMirror-gapcursor',
    '.paper-inline-toolbar',
    '.paper-draw-hint',
    '.search-result-current',
    '.collapse-indicator',
  ];
  toRemove.forEach((sel) =>
    clone.querySelectorAll(sel).forEach((el) => el.remove())
  );

  clone.querySelectorAll('.search-result').forEach((el) => {
    const parent = el.parentNode;
    if (!parent) return;
    while (el.firstChild) parent.insertBefore(el.firstChild, el);
    el.remove();
  });

  clone.querySelectorAll('*').forEach((el) => {
    el.removeAttribute('contenteditable');
    el.removeAttribute('draggable');
    el.removeAttribute('tiptap-url');
    el.removeAttribute('data-ref');
    el.removeAttribute('data-node-type');
    [...el.attributes].forEach((attr) => {
      if (attr.name.startsWith('data-v-')) el.removeAttribute(attr.name);
    });
  });

  clone.querySelectorAll("input[type='checkbox']").forEach((cb) => {
    cb.setAttribute('disabled', '');
    cb.removeAttribute('onchange');
    cb.removeAttribute('onclick');
  });

  clone.querySelectorAll('.node-view-wrapper').forEach((el) => {
    const video = el.querySelector('video');
    if (video) {
      const simple = document.createElement('video');
      simple.setAttribute('controls', '');
      simple.setAttribute('src', video.getAttribute('src') || '');
      simple.style.cssText =
        'max-width:100%;height:auto;display:block;margin:1em 0;';
      el.replaceWith(simple);
      return;
    }

    const audio = el.querySelector('audio');
    if (audio) {
      const simple = document.createElement('audio');
      simple.setAttribute('controls', '');
      simple.setAttribute('src', audio.getAttribute('src') || '');
      simple.style.cssText = 'display:block;margin:1em 0;width:100%;';
      el.replaceWith(simple);
      return;
    }

    const fileEmbed = el.querySelector('.file-embed');
    if (fileEmbed) {
      const src =
        fileEmbed.getAttribute('data-src') ||
        fileEmbed.querySelector('[data-src]')?.getAttribute('data-src');
      const name =
        fileEmbed.getAttribute('data-file-name') ||
        fileEmbed.querySelector('.file-name')?.textContent ||
        'File';
      if (src) {
        const link = document.createElement('a');
        link.href = normalizeAssetPath(src);
        link.textContent = name;
        link.setAttribute('download', '');
        link.style.cssText =
          'display:inline-flex;align-items:center;gap:0.5rem;padding:0.75rem 1rem;background:#f5f5f5;border-radius:0.5rem;text-decoration:none;color:inherit;margin:1em 0;';
        el.replaceWith(link);
      }
      return;
    }

    const katex = el.querySelector('.katex-display, .katex');
    if (katex) {
      const div = document.createElement('div');
      div.className = 'math-block';
      div.style.cssText = 'overflow-x:auto;max-width:100%;padding:0.5rem 0;';
      div.appendChild(katex.cloneNode(true));
      el.replaceWith(div);
      return;
    }

    const mermaidSvg = el.querySelector('.mermaid-viewer svg');
    if (mermaidSvg) {
      const div = document.createElement('div');
      div.className = 'mermaid-diagram';
      div.style.cssText = 'width:100%;padding:0.5rem 0;';
      div.appendChild(mermaidSvg.cloneNode(true));
      el.replaceWith(div);
      return;
    }

    const pre = el.querySelector('pre');
    if (pre) {
      el.querySelectorAll('select, button, .copy-btn').forEach((b) =>
        b.remove()
      );
      return;
    }

    if (el.classList.contains('paper-node')) {
      const svg = el.querySelector('svg');
      if (svg) {
        const div = document.createElement('div');
        div.className = 'paper-node';
        div.style.cssText = 'width:100%;padding:0.5rem 0;';
        div.appendChild(svg.cloneNode(true));
        el.replaceWith(div);
      }
      return;
    }
  });

  ['black', 'blue', 'yellow', 'red', 'green', 'purple'].forEach((color) => {
    clone.querySelectorAll(`.${color}Callout`).forEach((div) => {
      const blockquote = document.createElement('blockquote');
      blockquote.className = `callout callout-${color}`;
      blockquote.innerHTML = div.innerHTML;
      div.replaceWith(blockquote);
    });
  });

  clone.querySelectorAll('[src], [href]').forEach((el) => {
    const attr = el.hasAttribute('src') ? 'src' : 'href';
    const val = el.getAttribute(attr);
    if (val) el.setAttribute(attr, normalizeAssetPath(val));
  });

  clone.querySelectorAll('p.is-editor-empty').forEach((el) => {
    if (!el.textContent.trim()) el.remove();
  });

  clone.querySelectorAll('mark').forEach((mark) => {
    for (const cls of Array.from(mark.classList)) {
      if (cls in HIGHLIGHT_RGBA) {
        mark.style.backgroundColor = HIGHLIGHT_RGBA[cls];
        mark.style.borderRadius = '3px';
        mark.style.padding = '0 2px';
        mark.style.boxDecorationBreak = 'clone';
        mark.style.webkitBoxDecorationBreak = 'clone';
        break;
      }
    }
  });

  return clone;
}

export async function inlineImages(clone, noteId) {
  const images = Array.from(clone.querySelectorAll('img[src]'));
  if (!images.length) return;

  const appDir = await getAppDirectory();

  const jobs = images
    .map((img) => {
      const src = img.getAttribute('src');
      if (!src || src.startsWith('data:') || src.startsWith('http'))
        return null;

      const normalized = normalizeAssetPath(src);
      let filePath = null;

      if (normalized.startsWith('assets/')) {
        filePath = path.join(
          appDir,
          'notes-assets',
          noteId,
          normalized.replace('assets/', '')
        );
      } else if (normalized.startsWith('file-assets/')) {
        filePath = path.join(
          appDir,
          'file-assets',
          noteId,
          normalized.replace('file-assets/', '')
        );
      }

      if (!filePath) return null;
      return { img, filePath, mimeType: getMimeType(normalized) };
    })
    .filter(Boolean);

  if (!jobs.length) return;

  const batchSize = 10;
  for (let i = 0; i < jobs.length; i += batchSize) {
    const batch = jobs.slice(i, i + batchSize);
    const results = await Promise.all(
      batch.map(async (job) => {
        try {
          const base64 = await readData(job.filePath);
          if (!base64) return null;
          return {
            img: job.img,
            dataUrl: `data:${job.mimeType};base64,${base64}`,
          };
        } catch {
          return null;
        }
      })
    );
    results.forEach((res) => {
      if (res) res.img.setAttribute('src', res.dataUrl);
    });
  }
}

async function prepareExportDom(editor, noteId, mode = 'folder') {
  if (!editor?.view?.dom) throw new Error('Invalid editor instance');
  const clone = editor.view.dom.cloneNode(true);
  sanitizeClone(clone);
  if (mode === 'self-contained') {
    await inlineImages(clone, noteId);
  }
  return clone;
}

export async function buildWebExportDocument(editor, options = {}) {
  const {
    title = 'Untitled',
    mode = 'folder',
    noteId = '',
    extraStyles = '',
    isPaginated = false,
    pageWidth = A4_CSS_W,
    pageMargin = PAGE_MARGIN_PX,
  } = options;

  const isDark = isPaginated
    ? false // PDFs must always render in light mode
    : document.documentElement.classList.contains('dark');
  const theme = isDark ? 'dark' : 'light';

  const clone = await prepareExportDom(editor, noteId, mode);
  const pageCss = collectPageStyles();

  return `<!DOCTYPE html>
<html lang="en" class="${theme}">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)}</title>
  <style>${buildWebPageCss(pageWidth, pageMargin, isPaginated)}</style>
  <style>${pageCss}</style>
  <style>${CALLOUT_STYLES}</style>
  ${extraStyles ? `<style>${extraStyles}</style>` : ''}
</head>
<body>
  <div class="export-root note-editor__content prose prose-stone max-w-none ${
    isDark ? 'dark:text-neutral-100' : ''
  }">
    ${
      title && title !== 'Untitled'
        ? `<h1 class="export-title">${escapeHtml(title)}</h1>`
        : ''
    }
    ${clone.outerHTML}
  </div>
  ${
    isPaginated
      ? `<script>(function(){var C=0.75,M=44.75,H=842,S=(H-2*M)/C,K=90,P=Math.max(S/4,50);`
      + `function run(){var r=document.querySelector('.export-root');if(!r)return;var bl=[],seen=new Set();`
      + `function a(e,t){var g=e.getBoundingClientRect();if(g.width&&g.height)bl.push({tag:t,top:Math.round(g.top+scrollY),bottom:Math.round(g.bottom+scrollY),el:e})}`
      + `var k=r.querySelectorAll('h1,h2,h3,h4,h5,h6,figure,img,.callout,pre,blockquote,li[data-type],div[data-type],[data-bn-keep]');`
      + `for(var i=0;i<k.length;i++){seen.add(k[i]);a(k[i],k[i].tagName.toLowerCase())}`
      + `var d=r.querySelectorAll('div,section,article,li,td,th,tr,thead,tbody,caption,figcaption,details,summary,fieldset');`
      + `for(var i=0;i<d.length;i++){var e=d[i];if(seen.has(e)||e.offsetHeight<10)continue;var cs=getComputedStyle(e);if(cs.breakInside!=='avoid'&&cs.pageBreakInside!=='avoid')continue;a(e,e.tagName.toLowerCase())}`
      + `window.__bnDocHeight=Math.max(document.documentElement.scrollHeight,document.body.scrollHeight);`
      + `window.__bnPageBreaks=bl.map(function(x){return{tag:x.tag,top:x.top,bottom:x.bottom}});`
      + `var fl=[],i;for(i=0;i<bl.length;i++){var x=bl[i];if(x.bottom>x.top&&x.top<window.__bnDocHeight&&x.bottom>0)fl.push(x)}`
      + `fl.sort(function(a,b){return a.top-b.top});var ct=[],cu=0,ms=Math.ceil(window.__bnDocHeight/S)+10;`
      + `while(cu<window.__bnDocHeight-0.5&&ct.length<ms){var sb=Math.min(cu+S,window.__bnDocHeight);`
      + `var mx=sb,mn=cu;for(i=0;i<fl.length;i++){var x=fl[i];if(x.bottom<=cu||x.top>=sb)continue;`
      + `if(x.top<=cu)mn=Math.max(mn,x.bottom);else if(x.bottom>sb){if(x.tag==='img'||x.tag==='figure'||(x.bottom-x.top<=sb-cu))mx=Math.min(mx,x.top)}}`
      + `var nc=Math.max(Math.min(mx,sb),mn);if(nc>=sb-0.5){var be=null;for(i=0;i<fl.length;i++){var x=fl[i];`
      + `if(!/^h[1-6]$/.test(x.tag))continue;if(x.bottom<=cu||x.top>=sb)continue;var di=nc-x.bottom;`
      + `if(di>=0&&di<=K){if(be===null||x.top>be)be=x.top}}if(be!==null)nc=be}`
      + `for(i=0;i<fl.length;i++){var x=fl[i];if(x.top<nc&&nc<x.bottom){nc=Math.max(Math.min(mx,sb),mn);break}}`
      + `var f=cu+1;nc=Math.max(nc,f);nc=Math.min(nc,sb);if(nc<=cu)nc=cu+1;if(nc-cu<P)nc=Math.min(cu+S,window.__bnDocHeight);`
      + `ct.push(nc);if(Math.abs(nc-window.__bnDocHeight)<0.5)break;cu=nc}`
      + `window.__bnPageCuts=ct;var sr=bl.slice().sort(function(a,b){return a.top-b.top});`
      + `for(i=0;i<ct.length-1;i++){var c=ct[i],be=null,bb=-Infinity;`
      + `for(var j=0;j<sr.length;j++){var x=sr[j];if(x.bottom<=c+2&&x.bottom>bb&&x.el){be=x;bb=x.bottom}}`
      + `if(be&&be.el){be.el.style.setProperty('break-after','page','important');be.el.style.setProperty('page-break-after','always','important')}}}`
      + `if(document.readyState==='complete'||document.readyState==='interactive'){setTimeout(run,0)}`
      + `else{document.addEventListener('DOMContentLoaded',function(){setTimeout(run,0)})}})();</script>`
      : ''
  }
</body>
</html>`;
}
