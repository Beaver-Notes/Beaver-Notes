import mime from 'mime';
const { ipcRenderer, path } = window.electron;
import { useStorage } from '@/composable/storage';
import { getStroke } from 'perfect-freehand';
import { getSvgPathFromStroke } from '@/lib/tiptap/exts/paper-block/helpers/drawHelper.js';

const storage = useStorage('settings');

export async function getProcessedHTML(noteId, editor) {
  let html = editor.getHTML();

  const parser = new DOMParser();
  const doc = parser.parseFromString(html, 'text/html');

  await parseCustomBlocks(doc, noteId);

  injectCalloutStyles(doc);

  return doc.documentElement.outerHTML;
}

function normalizeAssetPath(url) {
  const fileAssetsMatch = url.match(/^file-assets:\/\/[^/]+\/(.+)$/);
  if (fileAssetsMatch) {
    return `file-assets/${fileAssetsMatch[1]}`;
  }

  const notesAssetsMatch = url.match(/^assets:\/\/[^/]+\/(.+)$/);
  if (notesAssetsMatch) {
    return `assets/${notesAssetsMatch[1]}`;
  }

  return url;
}

async function parseCustomBlocks(doc, noteId) {
  const mediaSpans = doc.querySelectorAll(
    'span[src], span[data-file-name][data-src]'
  );

  mediaSpans.forEach((el) => {
    const src = el.getAttribute('src') || el.getAttribute('data-src');
    if (!src) return;

    const normalizedSrc = normalizeAssetPath(src);

    const fileName = el.getAttribute('data-file-name') || '';

    const mimeType = mime.getType(fileName) || mime.getType(normalizedSrc);

    if (mimeType?.startsWith('audio/')) {
      const audio = document.createElement('audio');
      audio.setAttribute('controls', '');
      audio.setAttribute('src', normalizedSrc);
      audio.textContent = 'Your browser does not support the audio element.';
      el.replaceWith(audio);
    } else if (mimeType?.startsWith('video/')) {
      const video = document.createElement('video');
      video.setAttribute('controls', '');
      video.setAttribute('src', normalizedSrc);
      video.setAttribute('style', 'max-width: 100%; height: auto;');
      video.textContent = 'Your browser does not support the video tag.';
      el.replaceWith(video);
    } else {
      const link = document.createElement('a');
      link.setAttribute('href', normalizedSrc);
      link.setAttribute('download', '');
      link.textContent = fileName || normalizedSrc;
      el.replaceWith(link);
    }
  });

  // MathBlock handler
  const mathBlocks = doc.querySelectorAll('math-block');
  mathBlocks.forEach((el) => {
    const content = el.getAttribute('content') || '';

    const pre = document.createElement('pre');
    const code = document.createElement('code');

    code.classList.add('language-latex'); // or 'language-math' if preferred
    code.textContent = content;

    pre.appendChild(code);
    el.replaceWith(pre);
  });

  // Mermaid blocks
  const mermaidBlocks = doc.querySelectorAll('mermaid-diagram');
  mermaidBlocks.forEach((el) => {
    const content = el.getAttribute('content') || '';

    const pre = document.createElement('pre');
    const code = document.createElement('code');

    code.classList.add('language-mermaid');
    code.textContent = content;

    pre.appendChild(code);
    el.replaceWith(pre);
  });

  // Normalize src/href attributes
  const allElements = doc.querySelectorAll('[src], [href]');
  allElements.forEach((el) => {
    const attr = el.hasAttribute('src') ? 'src' : 'href';
    const original = el.getAttribute(attr);
    if (!original) return;

    el.setAttribute(attr, normalizeAssetPath(original));
  });

  // Callouts: convert divs to blockquotes with class
  const colors = ['black', 'blue', 'yellow', 'red', 'green', 'purple'];
  colors.forEach((color) => {
    const callouts = doc.querySelectorAll(`div.${color}Callout`);
    callouts.forEach((div) => {
      const blockquote = document.createElement('blockquote');
      blockquote.className = `callout callout-${color}`;
      blockquote.innerHTML = div.innerHTML;
      div.replaceWith(blockquote);
    });
  });

  //Paper blocks: convert divs to custom paper blocks
  const paperNodes = doc.querySelectorAll('div[data-type="paper"]');

  for (const el of paperNodes) {
    const height = el.style.height || '400px';
    const linesAttr = el.getAttribute('data-lines') || '[]';
    let lines = [];

    try {
      lines = JSON.parse(linesAttr);
    } catch {
      lines = [];
    }

    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 500 1000');
    svg.setAttribute('height', height);
    svg.setAttribute('class', 'w-full plain');

    lines.forEach((line) => {
      if (!line.points || !line.color) return;

      const stroke = getStroke(line.points, {
        size: line.size || 4,
        thinning: 0.6,
        streamline: 0.5,
        smoothing: 0.5,
        simulatePressure: true,
        ...line.options,
      });

      const pathData = getSvgPathFromStroke(stroke);
      const path = document.createElementNS(
        'http://www.w3.org/2000/svg',
        'path'
      );
      path.setAttribute('d', pathData);
      path.setAttribute('fill', line.color);
      path.setAttribute('stroke', 'none');
      path.setAttribute('stroke-width', '0');
      path.setAttribute('opacity', line.tool === 'highlighter' ? '0.4' : '1');
      svg.appendChild(path);
    });

    const serializer = new XMLSerializer();
    const svgString = serializer.serializeToString(svg);
    const dataDir = await storage.get('dataDir');

    const fileName = `${noteId || 'note'}-paper.svg`;
    const destPath = path.join(dataDir, 'notes-assets', noteId, fileName);

    await ipcRenderer.callMain('fs:writeFile', {
      data: svgString,
      path: destPath,
    });

    const img = document.createElement('img');
    img.setAttribute('src', `assets/${fileName}`);
    img.setAttribute('alt', 'Paper drawing');
    img.style.height = height;

    el.replaceWith(img);
  }
}

function injectCalloutStyles(doc) {
  const style = document.createElement('style');
  style.textContent = `
    .callout {
      border-left: 4px solid;
      padding: 1em;
      margin: 1em 0;
      border-radius: 4px;
    }
    .callout-black { background-color: #1f1f1f; color: white; border-color: #444; }
    .callout-blue { background-color: #e0f2fe; border-color: #3b82f6; }
    .callout-yellow { background-color: #fef9c3; border-color: #facc15; }
    .callout-red { background-color: #fee2e2; border-color: #ef4444; }
    .callout-green { background-color: #dcfce7; border-color: #10b981; }
    .callout-purple { background-color: #ede9fe; border-color: #8b5cf6; }
  `;
  doc.head.appendChild(style);
}
