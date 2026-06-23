import { buildWebExportDocument } from './export-html';
import { renderPdf } from '@/lib/native/pdf';

/**
 * macOS/iOS: render the export HTML in a dedicated hidden webview window
 * (managed by Rust) and capture it as an A4-paginated PDF. The editor
 * webview is never touched. Output is a text-selectable, paginated PDF.
 *
 * The export HTML must include the `isPaginated: true` CSS rules so the
 * hidden webview's `WKWebView.createPDF` paginates into A4 pages.
 */
async function exportPDFNative(editor, noteId, noteTitle, filePath) {
  const html = await buildWebExportDocument(editor, {
    mode: 'self-contained',
    title: noteTitle,
    noteId,
    isPaginated: true,
  });
  await renderPdf(html, filePath);
}

/**
 * Export a note as PDF.
 *
 * Apple platforms: native WKWebView.createPDF on a hidden render window
 *   (text-selectable, A4 paginated, no dialog).
 * Other platforms: not supported (the native command rejects with an
 *   error message).
 */
export async function exportPDF(noteId, noteTitle, editor, filePath) {
  return exportPDFNative(editor, noteId, noteTitle, filePath);
}
