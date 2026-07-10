import dayjs from '@/lib/dayjs';
import { useStorage } from '@/composable/storage';
import { useFolderStore } from '@/store/folder';
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

const INVALID_FILE_CHARS = /[/\\:*?"<>|]/g;

const A4_CSS_W = 794;
const PAGE_MARGIN_PX = 48;
const A4_PT_W = 595;
const A4_PT_H = 842;

// Must match the Rust constant CSS_PX_TO_PT in pdf.rs.
const CSS_PX_TO_PT = 72 / 96;

// Must match the Rust constant PDF_PAGE_MARGIN_CSS_PX / PDF_PAGE_MARGIN_PT.
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
  const m1 = url.match(/^file-assets:\/\/(.+)$/);
  if (m1) return `file-assets/${m1[1]}`;
  const m2 = url.match(/^assets:\/\/(.+)$/);
  if (m2) return `assets/${m2[1]}`;
  return url;
}

function getMimeType(src) {
  return mime.getType(src) || 'image/png';
}

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
  .export-root .callout {
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

  html, body {
    width: ${contentW}px !important;
    max-width: ${contentW}px !important;
    background: #ffffff !important;
    color: #1f1f1f !important;
  }

  .export-root {
    width: 100% !important;
    max-width: 100% !important;
    padding: 0 !important;
    margin: 0 !important;
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

export function tiptapToHtml(content, options = {}) {
  const { noteId = '' } = options;
  const nodes = getDocContent(content);
  if (!nodes.length) return '';
  const ctx = createRenderContext(noteId);
  return renderHtmlBlocks(nodes, ctx).trim();
}

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

export async function exportAllMarkdown(onProgress) {
  const storage = useStorage();
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

export async function exportAllHTML(onProgress) {
  const storage = useStorage();
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

function collectPageStyles() {
  // Walk cssRules directly rather than filtering by href so this works
  // with Vite's content-hashed filenames (e.g. index-a3f91bc2.css).
  // UI-only rules are still excluded by selector text.
  const UI_SELECTOR_PATTERNS = [
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
    '[data-v-',
  ];

  function isUiRule(text) {
    return UI_SELECTOR_PATTERNS.some((p) => text.includes(p));
  }

  const cssParts = [];

  for (const sheet of document.styleSheets) {
    try {
      if (!sheet.cssRules) continue;
      for (const rule of sheet.cssRules) {
        if (rule.type === CSSRule.KEYFRAMES_RULE) continue;
        const text = rule.cssText;
        if (isUiRule(text)) continue;
        cssParts.push(text);
      }
    } catch {}
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

export async function inlineImages(clone, _noteId) {
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
          normalized.replace('assets/', '')
        );
      } else if (normalized.startsWith('file-assets/')) {
        filePath = path.join(
          appDir,
          'file-assets',
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

// Self-contained IIFE that walks every Tiptap block,
// computes page cuts, and inserts break-after:page markers.
// The resulting multi-page A4 PDF is produced by each platform's
// native print / PDF-capture API (no Rust-side splitting needed).

function buildMeasurementScript(stripHeightPx) {
  var MIN_USEFUL_STRIP = 120;
  var HEADING_KEEP_NEXT = 90;
  var MIN_HEADING_ORPHAN = 200;

  return `<script>
(function () {
  var PAGE_H = ${Math.round(stripHeightPx)};
  var MIN_CUT = ${MIN_USEFUL_STRIP};
  var HEADING_GAP = ${HEADING_KEEP_NEXT};
  var MIN_ORPHAN = ${MIN_HEADING_ORPHAN};

  function computeCuts(srcH, hints) {
    if (srcH <= 0.5) return [Math.max(srcH, 0)];

    var mandatory = [0];
    var sorted = hints.slice().sort(function(a, b) { return a.top - b.top; });

    for (var i = 0; i < sorted.length; i++) {
      var h = sorted[i];
      if (h.kind === 'force_break') {
        var y = Math.min(Math.max(h.top, 0), srcH);
        if (y - mandatory[mandatory.length - 1] > 1) mandatory.push(y);
      } else if (h.kind === 'tall_block') {
        var bs = Math.min(Math.max(h.top, 0), srcH);
        var be = Math.min(Math.max(h.bottom, 0), srcH);
        if (be - bs < 1) continue;
        if (bs - mandatory[mandatory.length - 1] > 1) mandatory.push(bs);

        var candidates = (h.natural_splits || []).filter(function(y) {
          return y > bs && y < be;
        }).sort(function(a, b) { return a - b; });

        var prev = bs;
        for (var k = 0; k < candidates.length; k++) {
          if (candidates[k] - prev >= PAGE_H * 0.5) {
            mandatory.push(candidates[k]);
            prev = candidates[k];
          }
        }

        var internalCuts = 0;
        for (var m = 0; m < mandatory.length; m++) {
          if (mandatory[m] > bs && mandatory[m] < be) internalCuts++;
        }
        if (internalCuts === 0) {
          var fy = bs + PAGE_H;
          while (fy < be - 1) { mandatory.push(fy); fy += PAGE_H; }
        }

        if (be - mandatory[mandatory.length - 1] > 1) mandatory.push(be);
      }
    }
    mandatory.push(srcH);
    // Dedup and sort
    mandatory.sort(function(a, b) { return a - b; });
    mandatory = mandatory.filter(function(y, idx) {
      return idx === 0 || y - mandatory[idx - 1] > 0.5;
    });

    // Pass 2: soft constraints per mandatory segment
    var cuts = [];
    for (var seg = 0; seg < mandatory.length - 1; seg++) {
      var segStart = mandatory[seg];
      var segEnd = mandatory[seg + 1];
      var segHints = sorted.filter(function(h) {
        return h.bottom > segStart && h.top < segEnd;
      });
      var cursor = segStart;
      var maxStrips = Math.ceil((segEnd - segStart) / PAGE_H) + 10;
      for (var s = 0; s < maxStrips; s++) {
        if (cursor >= segEnd - 0.5) break;
        var stripBottom = Math.min(cursor + PAGE_H, segEnd);
        var best = pickCut(cursor, stripBottom, segEnd, segHints);
        cuts.push(best);
        cursor = best;
      }
    }
    if (cuts.length === 0 || Math.abs(cuts[cuts.length - 1] - srcH) > 0.5) {
      cuts.push(srcH);
    }

    var merged = [cuts[0]];
    for (var c = 1; c < cuts.length; c++) {
      var stripLen = cuts[c] - merged[merged.length - 1];
      if (stripLen < MIN_CUT && cuts[c] < srcH - 0.5) continue;
      merged.push(cuts[c]);
    }
    if (merged.length === 0 || Math.abs(merged[merged.length - 1] - srcH) > 0.5) {
      merged.push(srcH);
    }
    return merged;
  }

  function pickCut(stripTop, stripBottom, segEnd, hints) {
    var best = stripBottom;

    for (var i = 0; i < hints.length; i++) {
      var h = hints[i];
      if (h.top <= stripTop || h.bottom <= stripBottom) continue;

      if (h.kind === 'keep_together') {
        if (h.top - stripTop >= MIN_CUT) best = Math.min(best, h.top);
      } else if (h.kind === 'table_region') {
        var rows = h.row_tops || [];
        var rowCut = null;
        for (var r = 0; r < rows.length; r++) {
          if (rows[r] > stripTop && rows[r] <= stripBottom) {
            rowCut = rowCut === null ? rows[r] : Math.max(rowCut, rows[r]);
          }
        }
        if (rowCut !== null) {
          if (rowCut - stripTop >= MIN_CUT) best = Math.min(best, rowCut);
        } else if (h.top - stripTop >= MIN_CUT) {
          best = Math.min(best, h.top);
        }
      }
    }

    for (var i = 0; i < hints.length; i++) {
      var h = hints[i];
      if (h.kind !== 'keep_with_next') continue;
      if (h.bottom <= stripTop || h.top >= stripBottom) continue;
      var gap = Math.min(best, stripBottom) - h.bottom;
      if (gap < 0 || gap > HEADING_GAP) continue;
      if (h.top - stripTop >= MIN_ORPHAN) best = Math.min(best, h.top);
    }

    return Math.max(stripTop + 1, Math.min(best, segEnd));
  }

  function paginate() {
    var root = document.querySelector('.export-root') || document.body;
    var hints = [];
    var seen = new WeakSet();

    function docY(el) {
      var r = el.getBoundingClientRect();
      return {
        top: Math.round(r.top + window.scrollY),
        bottom: Math.round(r.bottom + window.scrollY),
        h: Math.round(r.height),
      };
    }

    function addSeen(el) {
      seen.add(el);
      var kids = el.querySelectorAll('*');
      for (var i = 0; i < kids.length; i++) seen.add(kids[i]);
    }

    var stack = Array.prototype.slice.call(root.children);
    while (stack.length) {
      var el = stack.shift();
      if (seen.has(el)) continue;

      var style = window.getComputedStyle(el);
      if (style.display === 'none' || style.visibility === 'hidden') continue;

      var pos = docY(el);
      if (pos.h < 4) continue;

      var tag = el.tagName.toLowerCase();

      if (el.hasAttribute('data-pdf-break-before') || el.hasAttribute('data-pdf-break-after')) {
        hints.push({ kind: 'force_break', tag: tag, top: pos.top, bottom: pos.bottom });
        continue;
      }

      if (tag === 'table') {
        var rows = el.querySelectorAll('tr');
        var rowTops = [];
        for (var i = 0; i < rows.length; i++) {
          rowTops.push(Math.round(rows[i].getBoundingClientRect().top + window.scrollY));
        }
        hints.push({ kind: 'table_region', tag: 'table', top: pos.top, bottom: pos.bottom, row_tops: rowTops });
        addSeen(el);
        continue;
      }

      if (pos.h > PAGE_H * 0.9) {
        var splitEls = el.querySelectorAll('p,li');
        var splits = [];
        for (var i = 0; i < splitEls.length; i++) {
          if (seen.has(splitEls[i])) continue;
          var sy = Math.round(splitEls[i].getBoundingClientRect().bottom + window.scrollY);
          if (sy > pos.top && sy < pos.bottom) splits.push(sy);
        }
        hints.push({ kind: 'tall_block', tag: tag, top: pos.top, bottom: pos.bottom, natural_splits: splits });
        addSeen(el);
        continue;
      }

      if (tag === 'h1' || tag === 'h2' || tag === 'h3' || tag === 'h4' || tag === 'h5' || tag === 'h6') {
        hints.push({ kind: 'keep_with_next', tag: tag, top: pos.top, bottom: pos.bottom });
        addSeen(el);
        continue;
      }

      var isNodeView = el.classList.contains('node-view-wrapper') ||
                       el.hasAttribute('data-node-view-root') ||
                       el.hasAttribute('data-pdf-keep');
      var hasBreakAvoid = style.breakInside === 'avoid' || style.pageBreakInside === 'avoid';

      if (isNodeView || hasBreakAvoid) {
        hints.push({ kind: 'keep_together', tag: tag, top: pos.top, bottom: pos.bottom });
        addSeen(el);
        continue;
      }

      var children = el.children;
      for (var i = children.length - 1; i >= 0; i--) {
        stack.unshift(children[i]);
      }
    }

    var docH = Math.max(
      document.documentElement.scrollHeight,
      document.body.scrollHeight
    );

    window.__bnLayout = hints;
    window.__bnPageBreaks = hints.map(function(h) {
      return { tag: h.tag, top: h.top, bottom: h.bottom };
    });
    window.__bnDocHeight = docH;

    var cuts = computeCuts(docH, hints);
    window.__bnCuts = cuts;

    var body = document.body;
    for (var c = 0; c < cuts.length - 1; c++) {
      var brk = document.createElement('div');
      brk.style.cssText = 'break-after:page;page-break-after:always;height:0;margin:0;padding:0;';
      brk.setAttribute('data-pdf-break', '');
      body.appendChild(brk);
    }

    window.__bnLayoutReady = true;
  }

  // Exposed so the host platform (e.g. Android plugin) can call
  // paginate explicitly after onPageFinished.
  window.__bnPaginate = paginate;

  function run() {
    var fontReady = document.fonts ? document.fonts.ready : Promise.resolve();
    var imgs = Array.prototype.slice.call(document.images);
    var imgReady = Promise.all(imgs.map(function(img) {
      if (img.complete) return Promise.resolve();
      return new Promise(function(resolve) {
        img.addEventListener('load', resolve);
        img.addEventListener('error', resolve);
      });
    }));
    Promise.all([fontReady, imgReady]).then(function() {
      requestAnimationFrame(function() {
        setTimeout(paginate, 0);
      });
    });
  }

  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    run();
  } else {
    document.addEventListener('DOMContentLoaded', run);
  }
})();
</script>`;
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
    ? false
    : document.documentElement.classList.contains('dark');
  const theme = isDark ? 'dark' : 'light';

  const clone = await prepareExportDom(editor, noteId, mode);
  const pageCss = collectPageStyles();

  const marginPt =
    (A4_PT_W - (A4_CSS_W - 2 * PDF_PAGE_MARGIN_CSS_PX) * CSS_PX_TO_PT) / 2;
  const stripHeightPx = Math.round((A4_PT_H - 2 * marginPt) / CSS_PX_TO_PT);

  const measurementScript = isPaginated
    ? buildMeasurementScript(stripHeightPx)
    : '';

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
  ${
    title && title !== 'Untitled'
      ? `<h1 class="export-title">${escapeHtml(title)}</h1>`
      : ''
  }
  <div class="export-root note-editor__content prose prose-stone max-w-none ${
    isDark ? 'dark:text-neutral-100' : ''
  }">
    ${clone.outerHTML}
  </div>
  ${measurementScript}
</body>
</html>`;
}
