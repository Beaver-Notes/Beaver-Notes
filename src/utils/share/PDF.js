import { buildWebExportDocument } from './exportBulk';
import { renderPdf } from '@/lib/native/pdf';

async function exportPDFNative(editor, noteId, noteTitle, filePath, dir) {
  const html = await buildWebExportDocument(editor, {
    mode: 'self-contained',
    title: noteTitle,
    noteId,
    dir: dir || document.documentElement.dir || 'auto',
    isPaginated: true,
  });
  await renderPdf(html, filePath);
}

export async function exportPDF(noteId, noteTitle, editor, filePath) {
  return exportPDFNative(editor, noteId, noteTitle, filePath);
}
