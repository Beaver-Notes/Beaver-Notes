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

export {
  A4_CSS_W,
  PAGE_MARGIN_PX,
  A4_PT_W,
  A4_PT_H,
  CSS_PX_TO_PT,
  PDF_PAGE_MARGIN_CSS_PX,
  CALLOUT_STYLES,
  buildWebPageCss,
};
