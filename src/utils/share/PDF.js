import { buildWebExportDocument } from './exportBulk';
import { renderPdf } from '@/lib/native/pdf';

async function exportPDFNative(editor, noteId, noteTitle, filePath) {
  const html = await buildWebExportDocument(editor, {
    mode: 'self-contained',
    title: noteTitle,
    noteId,
    isPaginated: true,
  });
  await renderPdf(html, filePath);
}

export async function exportPDF(noteId, noteTitle, editor, filePath) {
  return exportPDFNative(editor, noteId, noteTitle, filePath);
}
