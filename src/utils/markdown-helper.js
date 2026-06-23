import { marked } from 'marked';
import { v4 as uuidv4 } from 'uuid';
import { backend, path } from '@/lib/tauri-bridge';
import { getAppDirectory } from '@/lib/native/app';
import { generateJSON } from '@tiptap/core';
import { extensions, CollapseHeading, heading } from '@/lib/tiptap';

const handlers = [];

export function registerMarkdownHandler(handler) {
  if (!handler || !handler.name) {
    throw new Error('Markdown handler must have a name');
  }
  handlers.push(handler);
  return () => {
    const idx = handlers.indexOf(handler);
    if (idx !== -1) handlers.splice(idx, 1);
  };
}

export function getMarkdownHandlers() {
  return handlers;
}

export function clearMarkdownHandlers() {
  handlers.length = 0;
}

function applyPreprocessors(markdown, context) {
  let result = markdown;
  for (const h of handlers) {
    if (h.preprocess) result = h.preprocess(result, context);
  }
  return result;
}

async function applyPostprocessors(json, context) {
  for (const h of handlers) {
    if (h.postprocess) await h.postprocess(json, context);
  }
}

async function copyLocalAsset(fileName, directoryPath, id, subDir) {
  const fullSource = path.join(directoryPath, subDir, fileName);
  const assetsDir = path.join(await getAppDirectory(), subDir, id);
  const dest = path.join(assetsDir, fileName);
  try {
    await backend.invoke('fs:copy', { path: fullSource, dest });
    return `${subDir}://${id}/${fileName}`;
  } catch (error) {
    console.error(
      'Error copying ' + subDir + ' asset ' + fileName + ':',
      error
    );
    return null;
  }
}

function getFileTypeFromExtension(fileName) {
  const ext = (fileName || '').split('.').pop()?.toLowerCase();
  const videoExts = ['mp4', 'webm', 'mov', 'avi', 'mkv', 'wmv'];
  const audioExts = ['mp3', 'wav', 'ogg', 'flac', 'aac', 'wma', 'm4a'];
  if (videoExts.includes(ext)) return 'video';
  if (audioExts.includes(ext)) return 'audio';
  return 'file';
}

registerMarkdownHandler({
  name: 'footnote-definitions',

  preprocess(markdown, context) {
    const regex = /\[\^(\d+)\]:\s+(.*)/g;
    let match;
    while ((match = regex.exec(markdown)) !== null) {
      const refNum = match[1];
      const definition = match[2];
      const uid = uuidv4();
      context.referenceNumberToId[refNum] = uid;
      context.footnoteDefinitions.push({
        type: 'footnote',
        attrs: { id: 'fn:' + refNum, 'data-id': uid },
        content: [
          {
            type: 'paragraph',
            content: [{ type: 'text', text: definition }],
          },
        ],
      });
    }
    return markdown.replace(regex, '');
  },
});

registerMarkdownHandler({
  name: 'math-block',

  preprocess(markdown, _context) {
    return markdown.replace(/\$\$([\s\S]*?)\$\$/g, (_match, content) => {
      const escaped = content.trim().replace(/"/g, '&quot;');
      return '<math-block content="' + escaped + '"></math-block>';
    });
  },
});

registerMarkdownHandler({
  name: 'math-inline',

  preprocess(markdown, _context) {
    return markdown.replace(
      /(?<!\$)\$([^$]+)\$(?!\$)/g,
      '<math-inline>$1</math-inline>'
    );
  },
});

registerMarkdownHandler({
  name: 'footnote-references',

  preprocess(markdown, context) {
    return markdown.replace(/\[\^(\d+)\]/g, (_match, refNum) => {
      const uid = context.referenceNumberToId[refNum] || uuidv4();
      if (!context.referenceNumberToId[refNum]) {
        context.referenceNumberToId[refNum] = uid;
      }
      return (
        '<sup id="fnref:' +
        refNum +
        '"><a class="footnote-ref" href="#fn:' +
        refNum +
        '" data-id="' +
        uid +
        '" data-reference-number="' +
        refNum +
        '">' +
        refNum +
        '</a></sup>'
      );
    });
  },
});

registerMarkdownHandler({
  name: 'image-assets',

  async postprocess(json, context) {
    const { id, directoryPath } = context;
    const ops = [];

    function walk(node) {
      if (!node || typeof node !== 'object') return;
      if (
        node.type === 'image' &&
        node.attrs?.src &&
        !node.attrs.src.startsWith('http://') &&
        !node.attrs.src.startsWith('https://') &&
        !node.attrs.src.startsWith('assets://')
      ) {
        const fileName = node.attrs.src.split('/').pop();
        ops.push(async () => {
          const newSrc = await copyLocalAsset(
            fileName,
            directoryPath,
            id,
            'notes-assets'
          );
          if (newSrc) node.attrs.src = newSrc;
        });
      }
      if (Array.isArray(node.content)) node.content.forEach(walk);
      if (Array.isArray(node.marks)) node.marks.forEach(walk);
    }

    walk(json);
    for (const op of ops) await op();
  },
});

registerMarkdownHandler({
  name: 'file-links',

  async postprocess(json, context) {
    const { id, directoryPath } = context;
    const ops = [];

    function convert(node) {
      if (!node || typeof node !== 'object') return node;

      if (node.type === 'text' && Array.isArray(node.marks)) {
        const linkIdx = node.marks.findIndex((m) => m.type === 'link');
        if (linkIdx !== -1) {
          const href = node.marks[linkIdx].attrs?.href || '';
          if (
            !href.startsWith('http://') &&
            !href.startsWith('https://') &&
            !href.startsWith('mailto:') &&
            !href.startsWith('#')
          ) {
            const fileName = href.split('/').pop();
            const fileType = getFileTypeFromExtension(fileName);
            const displayName = node.text || fileName;

            const nodeType =
              fileType === 'video'
                ? 'Video'
                : fileType === 'audio'
                ? 'Audio'
                : 'fileEmbed';

            const newNode = {
              type: nodeType,
              attrs: { src: '', fileName: displayName },
            };

            ops.push(async () => {
              const newSrc = await copyLocalAsset(
                fileName,
                directoryPath,
                id,
                'file-assets'
              );
              if (newSrc) newNode.attrs.src = newSrc;
            });

            return newNode;
          }
        }
      }

      if (Array.isArray(node.content)) {
        node.content = node.content.map(convert).filter(Boolean);
      }
      if (Array.isArray(node.marks)) {
        node.marks = node.marks.map(convert).filter(Boolean);
      }
      return node;
    }

    convert(json);
    for (const op of ops) await op();
  },
});

export const readMarkdownFile = async (filePath) => {
  try {
    const markdown = await backend.invoke('fs:readFile', filePath);
    return markdown;
  } catch (error) {
    console.error('Error reading file ' + filePath + ':', error);
    throw error;
  }
};

export const convertMarkdownToTiptap = async (markdown, id, directoryPath) => {
  const context = {
    id,
    directoryPath,
    referenceNumberToId: {},
    footnoteDefinitions: [],
  };

  const processedMarkdown = applyPreprocessors(markdown, context);

  const html = marked(processedMarkdown);
  const json = generateJSON(html, [...extensions, CollapseHeading, heading]);

  await applyPostprocessors(json, context);

  let title = '';
  if (Array.isArray(json.content) && json.content.length > 0) {
    const first = json.content[0];
    if (first.type === 'heading' && first.attrs?.level === 1) {
      title = (first.content || []).map((n) => n.text || '').join('');
      json.content.shift();
    }
  }

  if (context.footnoteDefinitions.length > 0) {
    json.content.push({
      type: 'footnotes',
      attrs: { class: 'footnotes' },
      content: context.footnoteDefinitions,
    });
  }

  return { title, content: json };
};
