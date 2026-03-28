export const DRAWING_EXPORT_SUPPORT = Object.freeze({
  html: 'best',
  pdf: 'best',
  markdown: 'limited',
  docx: 'limited',
});

export function getDrawingExportSupportCopy(name, translations = {}) {
  const level = DRAWING_EXPORT_SUPPORT[name] || 'limited';
  const shareTranslations = translations.share || {};

  if (level === 'best') {
    return {
      level,
      label: shareTranslations.bestSupport || 'Best support',
    };
  }

  return {
    level,
    label: shareTranslations.limitedSupport || 'Limited support',
  };
}

export function getDrawingExportHint(translations = {}) {
  return (
    translations.share?.drawingHint ||
    'Drawings export best in PDF and HTML. Markdown and Word include limited drawing support.'
  );
}
