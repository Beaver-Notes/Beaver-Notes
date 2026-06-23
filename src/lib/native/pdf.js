import { backend } from '@/lib/tauri-bridge';

/**
 * Render an export-ready HTML document to a PDF on disk using the platform's
 * native webview (macOS/iOS: a hidden WKWebView; other platforms: not supported
 * and will reject).
 *
 * @param {string} html - Self-contained HTML to render (must include the
 *   `@page` rules that drive A4 pagination).
 * @param {string} outputPath - Absolute path where the PDF file should be written.
 * @returns {Promise<void>} Resolves when the PDF has been written to disk.
 *
 * @example
 * import { renderPdf } from '@/lib/native/pdf';
 *
 * const filePath = await saveDialog({ filters: [{ name: 'PDF', extensions: ['pdf'] }] });
 * if (!filePath) return;
 *
 * const html = await buildExportHtml(...);
 * try {
 *   await renderPdf(html, filePath);
 *   console.log('PDF saved to', filePath);
 * } catch (err) {
 *   console.error('PDF generation failed:', err);
 * }
 */
export async function renderPdf(html, outputPath) {
  return backend.invoke('pdf:render', { html, outputPath });
}
