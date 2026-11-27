import mime from 'mime';

const KIND_BY_MIME = {
  'application/pdf': 'PDF Document',
  'application/msword': 'Word Document',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document':
    'Word Document',
  'application/vnd.ms-excel': 'Excel Spreadsheet',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet':
    'Excel Spreadsheet',
  'text/csv': 'CSV File',
  'application/vnd.ms-powerpoint': 'PowerPoint Presentation',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation':
    'PowerPoint Presentation',
  'application/vnd.apple.numbers': 'Numbers File',
  'application/vnd.apple.pages': 'Pages Document',
  'application/vnd.apple.keynote': 'Keynote Presentation',
  'application/zip': 'ZIP Archive',
  'application/x-rar-compressed': 'RAR Archive',
  'application/x-7z-compressed': '7-Zip Archive',
  'application/x-tar': 'TAR Archive',
  'application/gzip': 'Gzip Archive',
  'text/markdown': 'Markdown Document',
  'text/plain': 'Plain Text',
};

const ARCHIVE_MIMES = new Set([
  'application/zip',
  'application/x-rar-compressed',
  'application/x-7z-compressed',
  'application/x-tar',
  'application/gzip',
]);

export function extOf(name) {
  const s = String(name || '');
  const index = s.lastIndexOf('.');
  return index < 0 ? '' : s.slice(index + 1).toLowerCase();
}

export function mimeOf(name) {
  return mime.getType(String(name || '')) || '';
}

export function kindFor(fileName) {
  const type = mimeOf(fileName);
  if (KIND_BY_MIME[type]) return KIND_BY_MIME[type];
  if (type.startsWith('image/')) return 'Image';
  if (type.startsWith('video/')) return 'Video';
  if (type.startsWith('audio/')) return 'Audio';
  if (type.startsWith('text/')) return 'Text Document';
  const ext = extOf(fileName);
  return ext ? `${ext.toUpperCase()} File` : 'File';
}

export function iconFor(fileName) {
  const type = mimeOf(fileName);
  if (type.startsWith('image/')) return 'riImageLine';
  if (type.startsWith('audio/')) return 'riVolumeDownFill';
  if (type.startsWith('video/')) return 'riMovieLine';
  if (ARCHIVE_MIMES.has(type)) return 'riArchiveLine';
  if (
    type.startsWith('text/') ||
    type === 'application/pdf' ||
    /word|excel|powerpoint|officedocument|msword|ms-excel|ms-powerpoint|apple/i.test(
      type
    )
  ) {
    return 'riFileTextLine';
  }
  return 'riFile2Line';
}
