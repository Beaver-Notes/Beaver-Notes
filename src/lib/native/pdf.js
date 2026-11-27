import { backend } from '@/lib/tauri-bridge';

/**
 * Render an export-ready HTML document to a PDF on disk via the platform's
 * native webview (macOS/iOS hidden WKWebView; other platforms reject).
 * `html` must be self-contained and include the `@page` rules driving A4
 * pagination; `outputPath` is absolute. Resolves once the PDF is on disk.
 */
export async function renderPdf(html, outputPath) {
  return backend.invoke('pdf:render', { html, outputPath });
}
