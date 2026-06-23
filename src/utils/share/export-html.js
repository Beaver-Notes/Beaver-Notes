import { path } from '@/lib/tauri-bridge';
import { getAppDirectory } from '@/lib/native/app';
import { readData } from '@/lib/native/fs';
import mime from 'mime';

const A4_CSS_W = 794;
const PAGE_MARGIN_PX = 48;

// A4 in points for WKWebView.createPDF. 1pt = 1/72 inch. A4 = 210×297mm.
// 210mm / 25.4 * 72 = 595.28 ≈ 595pt  |  297mm / 25.4 * 72 = 841.89 ≈ 842pt
const A4_PT_W = 595;
const A4_PT_H = 842;

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

/**
 * Build the CSS block for the exported document.
 *
 * isPaginated=true  → used by the PDF path. @page rules go at the TOP LEVEL
 *                     (not inside @media print) because WKWebView.createPDF
 *                     renders in "screen" mode, never "print" mode.
 *                     Page size is expressed in pt to match WKPDFConfiguration.
 *
 * isPaginated=false → used by the HTML export path. @page rules go inside
 *                     @media print for browser Print dialogs.
 */
function buildWebPageCss(pageWidth, pageMargin, isPaginated) {
  const padding = isPaginated ? '0' : `${pageMargin}px`;

  // ── Shared rules (screen + PDF) ──────────────────────────────────────────
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

  /* Hide editor UI chrome */
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

  /* Page-break hints */
  .export-root table,
  .export-root figure,
  .export-root img,
  .export-root .callout {
    break-inside: avoid;
    page-break-inside: avoid;
  }

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
    // ── PDF path: @page MUST be at top level, NOT inside @media print ──────
    //
    // WKWebView.createPDF renders in screen mode. Any CSS inside @media print
    // is completely ignored. The @page rule here drives:
    //   • Page dimensions passed to WKPDFConfiguration.rect (595pt × 842pt)
    //   • Margins (white space around the content area on each page)
    //
    // We also reset html/body so the webview's own frame doesn't interfere,
    // and force the content column to fill the printable area.
    return `
  ${shared}

  @page {
    size: ${A4_PT_W}pt ${A4_PT_H}pt;
    margin: 15mm 15mm 15mm 15mm;
  }

  html, body {
    width: ${A4_PT_W}pt !important;
    max-width: ${A4_PT_W}pt !important;
    background: #ffffff !important;
    color: #1f1f1f !important;
  }

  .export-root {
    /* Fill the printable width; let @page margin handle whitespace */
    width: 100% !important;
    max-width: 100% !important;
    padding: 0 !important;
    margin: 0 !important;
    background: transparent !important;
  }

  img {
    max-width: 100% !important;
    /* Never let an image taller than one page minus margins */
    max-height: calc(${A4_PT_H}pt - 30mm) !important;
    height: auto !important;
    width: auto !important;
  }

  table, pre {
    max-width: 100% !important;
    overflow: visible !important;
  }
    `;
  }

  // ── HTML export path: @page inside @media print (browser Print dialog) ───
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

// ── Everything below is unchanged from your original ────────────────────────

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

function escapeHtml(v) {
  return String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
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

  const isDark = document.documentElement.classList.contains('dark');
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
</body>
</html>`;
}
