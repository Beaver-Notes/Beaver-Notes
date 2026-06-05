import { path } from '@/lib/tauri-bridge';
import { getAppDirectory } from '@/lib/native/app';
import { readData } from '@/lib/native/fs';

const A4_CSS_W = 794;
const PAGE_MARGIN_PX = 48;

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

const PAGE_CSS = `
  *, *::before, *::after { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; background: transparent; overflow-x: hidden; }

  .export-root {
    font-size: 1.065rem;
    line-height: 1.5;
    padding: ${PAGE_MARGIN_PX}px;
    background: #ffffff;
    color: #1f1f1f;
    width: ${A4_CSS_W}px;
    overflow-x: hidden;
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

  @media print {
    @page { size: A4 portrait; margin: 1.5cm; }
    html, body { width: 100% !important; background: #ffffff !important; color: #1f1f1f !important; }
    .export-root { width: 100% !important; padding: 0 !important; background: transparent !important; }
    .dark .export-root { background: transparent !important; color: #1f1f1f !important; }
    h1, h2, h3, h4, h5, h6 { break-after: avoid; page-break-after: avoid; }
    pre, table, figure, blockquote, .callout, tr { break-inside: avoid; page-break-inside: avoid; }
    p { orphans: 3; widows: 3; }
  }

  .export-root img { max-width: 100%; height: auto; display: block; }

  .export-root table { border-collapse: collapse; width: 100%; }
  .export-root td, .export-root th { border: 1px solid #d1d5db; padding: 0.4em 0.6em; }
  .dark .export-root td, .dark .export-root th { border-color: #404040; }
  .export-root a { color: inherit; text-decoration: underline; }
`;

// Maps Tailwind highlight classes to inline background-color values
// so the isolated export iframe renders them without a Tailwind stylesheet.
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
  if (src.endsWith('.svg')) return 'image/svg+xml';
  if (src.endsWith('.png')) return 'image/png';
  if (src.endsWith('.jpg') || src.endsWith('.jpeg')) return 'image/jpeg';
  if (src.endsWith('.gif')) return 'image/gif';
  if (src.endsWith('.webp')) return 'image/webp';
  return 'image/png';
}

function sanitizeClone(clone) {
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

  // FIX: Resolve Tailwind arbitrary highlight classes to inline background-color.
  // The isolated iframe has no Tailwind stylesheet so class names like
  // "bg-[#DC8D42]/30" render as transparent. Walk every <mark> and convert
  // any matching class to a real inline style so colors appear in the PDF.
  clone.querySelectorAll('mark').forEach((mark) => {
    for (const cls of Array.from(mark.classList)) {
      if (cls in HIGHLIGHT_RGBA) {
        mark.style.backgroundColor = HIGHLIGHT_RGBA[cls];
        mark.style.borderRadius = '3px';
        mark.style.padding = '0 2px';
        break;
      }
    }
  });

  return clone;
}

function collectPageStyles() {
  let css = '';
  for (const sheet of document.styleSheets) {
    try {
      if (!sheet.cssRules) continue;
      const href = sheet.href || '';
      if (
        href.includes('remixicon') ||
        href.includes('toastify') ||
        href.includes('overlayscrollbars') ||
        href.includes('v-tooltip')
      )
        continue;
      for (const rule of sheet.cssRules) css += rule.cssText + '\n';
    } catch {}
  }
  return css;
}

async function inlineImages(clone, noteId) {
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

export async function buildExportDocument(editor, options = {}) {
  const {
    title = 'Untitled',
    mode = 'folder',
    noteId = '',
    extraStyles = '',
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
  <style>${PAGE_CSS}</style>
  <style>${pageCss}</style>
  <style>${CALLOUT_STYLES}</style>
  ${extraStyles ? `<style>${extraStyles}</style>` : ''}
</head>
<body>
  <div class="export-root note-editor__content prose prose-stone max-w-none ${
    isDark ? 'dark:text-neutral-100' : ''
  }">
    ${clone.outerHTML}
  </div>
</body>
</html>`;
}
