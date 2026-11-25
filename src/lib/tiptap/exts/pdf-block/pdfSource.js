/**
 * pdfSource.js — pdf.js glue isolated here so components and tests can mock
 * document loading without touching pdf.js internals.
 *
 * Uses the legacy build for Tauri's WebKit webview; the worker is imported
 * as a Vite module URL (inlined by the bundler, no runtime fetch needed).
 */
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import workerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url';

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

/**
 * @param {Uint8Array} bytes
 * @returns {{ numPages: number, pageDims: Promise<Array<{width:number,height:number}>>, renderPage: (index:number, canvas:HTMLCanvasElement, scale:number)=>Promise<void> }}
 */
export async function openPdf(bytes) {
  const doc = await pdfjs.getDocument({ data: bytes }).promise;
  const pageDims = (async () => {
    const dims = [];
    for (let i = 0; i < doc.numPages; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      const page = await doc.getPage(i + 1);
      const viewport = page.getViewport({ scale: 1 });
      dims.push({ width: viewport.width, height: viewport.height });
    }
    return dims;
  })();
  return {
    numPages: doc.numPages,
    pageDims,
    renderPage: async (index, canvas, scale) => {
      const page = await doc.getPage(index + 1);
      const viewport = page.getViewport({ scale });
      await page.render({
        canvasContext: canvas.getContext('2d'),
        viewport,
      }).promise;
    },
  };
}
