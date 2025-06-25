import { useStorage } from '@/composable/storage';
import { getProcessedHTML } from './html-helper';
const { ipcRenderer, path } = window.electron;
import TurndownService from 'turndown';
import { gfm } from 'turndown-plugin-gfm';

export async function exportMD(noteId, noteTitle, editor) {
  let html = await getProcessedHTML(noteId, editor);

  const parser = new DOMParser();
  const doc = parser.parseFromString(html, 'text/html');

  const callouts = doc.querySelectorAll(
    'blockquote.callout, blockquote[class^="callout-"]'
  );
  callouts.forEach((el) => {
    el.removeAttribute('class');
  });

  html = doc.body.innerHTML;

  const turndownService = new TurndownService({
    headingStyle: 'atx',
    codeBlockStyle: 'fenced',
    bulletListMarker: '-',
  });

  turndownService.use(gfm);

  turndownService.addRule('audioTag', {
    filter: 'audio',
    replacement: (content, node) => {
      const src = node.getAttribute('src');
      return `![:audio](${src})`;
    },
  });

  turndownService.addRule('videoTag', {
    filter: 'video',
    replacement: (content, node) => {
      const src = node.getAttribute('src');
      return `![:video](${src})`;
    },
  });

  turndownService.addRule('iframeTag', {
    filter: 'iframe',
    replacement: (content, node) => {
      // Keep iframe as raw HTML in markdown
      const src = node.getAttribute('src') || '';
      const width = node.getAttribute('width') || '560';
      const height = node.getAttribute('height') || '315';
      const frameborder = node.getAttribute('frameborder') || '0';
      const allow = node.getAttribute('allow') || '';
      const allowfullscreen = node.hasAttribute('allowfullscreen')
        ? 'allowfullscreen'
        : '';

      return `<iframe src="${src}" width="${width}" height="${height}" frameborder="${frameborder}" allow="${allow}" ${allowfullscreen}></iframe>`;
    },
  });

  let markdown = turndownService.turndown(html);

  const { canceled, filePaths } = await ipcRenderer.callMain('dialog:open', {
    title: 'Export data',
    properties: ['openDirectory'],
  });
  if (canceled) return;

  const folderName = noteTitle.replace(/[/\\?%*:|"<>]/g, '-') || 'ExportedNote';
  const folderPath = path.join(filePaths[0], folderName);

  await ipcRenderer.callMain('fs:ensureDir', folderPath);

  await ipcRenderer.callMain('fs:writeFile', {
    path: path.join(folderPath, `${noteTitle}.md`),
    data: markdown,
  });

  const storage = useStorage();
  const dataDir = await storage.get('dataDir', '', 'settings');

  const noteAssetsSource = path.join(dataDir, 'notes-assets', noteId);
  const fileAssetsSource = path.join(dataDir, 'file-assets', noteId);

  const notesAssetsDest = path.join(folderPath, 'assets');
  const fileAssetsDest = path.join(folderPath, 'file-assets');

  await ipcRenderer.callMain('fs:ensureDir', notesAssetsDest);
  await ipcRenderer.callMain('fs:ensureDir', fileAssetsDest);

  try {
    await ipcRenderer.callMain('fs:copy', {
      path: noteAssetsSource,
      dest: notesAssetsDest,
    });
  } catch (err) {
    console.warn('Note assets copy failed:', err.message);
  }

  try {
    await ipcRenderer.callMain('fs:copy', {
      path: fileAssetsSource,
      dest: fileAssetsDest,
    });
  } catch (err) {
    console.warn('File assets copy failed:', err.message);
  }

  alert(`Exported note and assets to "${folderPath}"`);
}
