import { marked } from 'marked';
import { v4 as uuidv4 } from 'uuid';
import { backend, path } from '@/lib/tauri-bridge';
import { getAppDirectory } from '@/lib/native/app';
import { generateJSON } from '@tiptap/core';
import { extensions, CollapseHeading, heading } from '@/lib/tiptap';

const handlers = [];

export function registerMarkdownHandler(handler) {
  if (!handler || !handler.name)
    throw new Error('Markdown handler must have a name');
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

function getNodeRenderers() {
  const renderers = {};
  for (const h of handlers) {
    if (h.renderNode) Object.assign(renderers, h.renderNode);
  }
  return renderers;
}

function getMarkRenderers() {
  const renderers = {};
  for (const h of handlers) {
    if (h.renderMark) Object.assign(renderers, h.renderMark);
  }
  return renderers;
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
  if (['mp4', 'webm', 'mov', 'avi', 'mkv', 'wmv'].includes(ext)) return 'video';
  if (['mp3', 'wav', 'ogg', 'flac', 'aac', 'wma', 'm4a'].includes(ext))
    return 'audio';
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
          { type: 'paragraph', content: [{ type: 'text', text: definition }] },
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
      if (!context.referenceNumberToId[refNum])
        context.referenceNumberToId[refNum] = uid;
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
      if (Array.isArray(node.content))
        node.content = node.content.map(convert).filter(Boolean);
      if (Array.isArray(node.marks))
        node.marks = node.marks.map(convert).filter(Boolean);
      return node;
    }
    convert(json);
    for (const op of ops) await op();
  },
});

export const readMarkdownFile = async (filePath) => {
  try {
    return await backend.invoke('fs:readFile', filePath);
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

export function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function escapeMarkdownText(value) {
  return String(value ?? '').replace(/([\\`*_{}\[\]()#+\-.!|>])/g, '\\$1');
}

export function normalizeWhitespace(value) {
  return String(value ?? '')
    .replace(/\r\n/g, '\n')
    .replace(/\u00a0/g, ' ');
}

function prefixLines(value, prefix) {
  return String(value || '')
    .split('\n')
    .map((line) => `${prefix}${line}`)
    .join('\n');
}

function trimBlock(value) {
  return String(value || '')
    .replace(/^\n+/, '')
    .replace(/\n+$/, '');
}

export function getNodeChildren(node) {
  return Array.isArray(node?.content) ? node.content : [];
}

export function getDocContent(content) {
  if (!content) return [];
  if (Array.isArray(content)) return content;
  if (content.type === 'doc' && Array.isArray(content.content))
    return content.content;
  return Array.isArray(content.content) ? content.content : [];
}

export function collectDescendantText(node) {
  if (!node) return '';
  if (node.type === 'text') return normalizeWhitespace(node.text || '');
  const directText =
    typeof node?.attrs?.content === 'string'
      ? normalizeWhitespace(node.attrs.content)
      : '';
  const text = getNodeChildren(node)
    .map((child) => collectDescendantText(child))
    .filter(Boolean)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
  return text || directText;
}

function buildInlineFallback(node) {
  return escapeMarkdownText(collectDescendantText(node));
}

function quoteYaml(value) {
  return JSON.stringify(String(value ?? ''));
}

function toIsoString(timestamp) {
  const date = new Date(timestamp || Date.now());
  return Number.isNaN(date.getTime())
    ? new Date().toISOString()
    : date.toISOString();
}

export function resolveAssetSrc(src, noteId) {
  if (!src) return null;
  if (/^https?:\/\//i.test(src)) return { type: 'remote', filename: src };
  const m1 = src.match(/^assets:\/\/([^/]+)\/(.+)$/);
  if (m1) return { type: 'notes-assets', assetNoteId: m1[1], filename: m1[2] };
  const m2 = src.match(/^file-assets:\/\/([^/]+)\/(.+)$/);
  if (m2) return { type: 'file-assets', assetNoteId: m2[1], filename: m2[2] };
  return { type: 'notes-assets', filename: src };
}

export function resolveAssetOutputPath(src, noteId) {
  const resolved = resolveAssetSrc(src, noteId);
  if (!resolved?.filename) return src || '';
  if (resolved.type === 'remote') return resolved.filename;
  const assetNoteId = resolved.assetNoteId || noteId;
  return resolved.type === 'notes-assets'
    ? `assets/${assetNoteId}/${resolved.filename}`
    : `file-assets/${assetNoteId}/${resolved.filename}`;
}

export function getFootnoteNumber(attrs = {}, ctx) {
  const explicitNumber =
    attrs.referenceNumber || attrs['data-reference-number'];
  if (explicitNumber) return explicitNumber;
  const footnoteId = attrs['data-id'];
  if (!footnoteId) {
    const next = String(ctx.footnoteCounter);
    ctx.footnoteCounter += 1;
    return next;
  }
  if (!ctx.footnoteNumbers.has(footnoteId)) {
    ctx.footnoteNumbers.set(footnoteId, String(ctx.footnoteCounter));
    ctx.footnoteCounter += 1;
  }
  return ctx.footnoteNumbers.get(footnoteId);
}

export function createRenderContext(noteId) {
  return { noteId, footnoteNumbers: new Map(), footnoteCounter: 1 };
}

function renderMarkdownInline(nodes, ctx) {
  return (nodes || [])
    .map((node) => renderMarkdownInlineNode(node, ctx))
    .join('');
}

function renderMarkdownInlineNode(node, ctx) {
  if (!node) return '';

  const nodeRenderers = getNodeRenderers();
  if (nodeRenderers[node.type]) return nodeRenderers[node.type](node, ctx);

  switch (node.type) {
    case 'text': {
      const hasCode = Array.isArray(node.marks)
        ? node.marks.some((m) => m.type === 'code')
        : false;
      let text = hasCode
        ? normalizeWhitespace(node.text ?? '')
        : escapeMarkdownText(normalizeWhitespace(node.text ?? ''));
      const marks = Array.isArray(node.marks) ? [...node.marks] : [];

      const markRenderers = getMarkRenderers();
      for (const mark of marks) {
        if (markRenderers[mark.type]) {
          text = markRenderers[mark.type](text, mark.attrs);
          continue;
        }
        if (mark.type === 'bold') text = `**${text}**`;
        else if (mark.type === 'italic') text = `*${text}*`;
        else if (mark.type === 'code') text = `\`${text}\``;
        else if (mark.type === 'strike') text = `~~${text}~~`;
        else if (mark.type === 'link')
          text = `[${text || mark.attrs?.href || ''}](${
            mark.attrs?.href || ''
          })`;
      }
      return text;
    }
    case 'hardBreak':
      return '\\\n';
    case 'image':
      return `![${node?.attrs?.alt || ''}](${resolveAssetOutputPath(
        node?.attrs?.src,
        ctx.noteId
      )})`;
    case 'math_inline': {
      const value =
        node?.attrs?.content ||
        renderMarkdownInline(getNodeChildren(node), ctx) ||
        buildInlineFallback(node);
      return `$${value}$`;
    }
    case 'footnoteReference':
      return `[^${getFootnoteNumber(node.attrs, ctx)}]`;
    case 'fileEmbed': {
      const href = resolveAssetOutputPath(node?.attrs?.src, ctx.noteId);
      return `[${
        node?.attrs?.fileName || path.basename(href) || 'Attachment'
      }](${href})`;
    }
    case 'iframe': {
      const src = node?.attrs?.src || '';
      return `<iframe src="${src}" width="${
        node?.attrs?.width || '560'
      }" height="${node?.attrs?.height || '315'}" frameborder="${
        node?.attrs?.frameborder ?? '0'
      }" allow="${node?.attrs?.allow || ''}"${
        node?.attrs?.allowfullscreen ? ' allowfullscreen' : ''
      }></iframe>`;
    }
    case 'Audio':
      return `<audio controls src="${resolveAssetOutputPath(
        node?.attrs?.src,
        ctx.noteId
      )}">Your browser does not support the audio element.</audio>`;
    case 'Video':
      return `<video controls src="${resolveAssetOutputPath(
        node?.attrs?.src,
        ctx.noteId
      )}" style="max-width: 100%; height: auto;">Your browser does not support the video tag.</video>`;
    default:
      return getNodeChildren(node).length > 0
        ? renderMarkdownInline(getNodeChildren(node), ctx)
        : buildInlineFallback(node);
  }
}

function renderMarkdownParagraph(node, ctx) {
  const text = renderMarkdownInline(getNodeChildren(node), ctx);
  return text ? `${text}\n\n` : '';
}

function renderMarkdownListItem(node, ctx, options = {}) {
  const { task = false } = options;
  const children = getNodeChildren(node);
  const inlineParts = children
    .filter((c) => c?.type === 'paragraph')
    .flatMap((p) => getNodeChildren(p));
  const nestedBlocks = children.filter((c) => !['paragraph'].includes(c?.type));
  const indent = node?.type === 'taskList' ? '  ' : '';
  const rendered = nestedBlocks
    .map((child) => renderMarkdownBlock(child, { ...ctx, inList: true }))
    .join('');
  const fallback = collectDescendantText(node);
  if (!inlineParts.length && !nestedBlocks.length)
    return `${indent}- ${escapeMarkdownText(fallback)}\n`;
  const text = renderMarkdownInline(inlineParts, ctx);
  const marker = task ? (node?.attrs?.checked ? '- [x]' : '- [ ]') : '-';
  const padding = ' '.repeat(marker.length + 1);
  const lines = (text || '').split('\n');
  const firstLine = `${indent}${marker} ${lines[0]}`;
  const continuation = lines
    .slice(1)
    .map((line) => `${indent}${padding}${line}`)
    .join('\n');
  const nested = rendered ? `\n${prefixLines(trimBlock(rendered), '  ')}` : '';
  return `${firstLine}${continuation ? `\n${continuation}` : ''}${nested}\n`;
}

function renderMarkdownTable(node, ctx) {
  const rows = getNodeChildren(node).filter(
    (child) => child?.type === 'tableRow'
  );
  if (!rows.length) return '';
  const width = Math.max(...rows.map((row) => getNodeChildren(row).length));
  const normalizedRows = rows.map((row) => {
    const c = { ...row, content: [...getNodeChildren(row)] };
    while (c.content.length < width)
      c.content.push({ type: 'tableCell', content: [] });
    return c;
  });
  const header = `| ${getNodeChildren(normalizedRows[0])
    .map((cell) => renderMarkdownInline(getNodeChildren(cell), ctx))
    .join(' | ')} |`;
  const divider = `| ${Array(width).fill('---').join(' | ')} |`;
  const body = normalizedRows
    .slice(1)
    .map(
      (row) =>
        `| ${getNodeChildren(row)
          .map((cell) => renderMarkdownInline(getNodeChildren(cell), ctx))
          .join(' | ')} |`
    )
    .join('\n');
  return `\n${header}\n${divider}\n${body}\n\n`;
}

function renderMarkdownFootnote(node, ctx) {
  const number = getFootnoteNumber(node.attrs, ctx);
  const body = getNodeChildren(node)
    .map((child) => renderMarkdownBlock(child, { ...ctx, inList: true }))
    .join('');
  const lines = body.trim().split('\n');
  return `[^${number}]: ${lines[0] || ''}${
    lines.slice(1).length
      ? '\n' +
        lines
          .slice(1)
          .map((l) => '  ' + l)
          .join('\n')
      : ''
  }\n\n`;
}

function renderMarkdownBlock(node, ctx) {
  if (!node) return '';

  const nodeRenderers = getNodeRenderers();
  if (nodeRenderers[node.type]) return nodeRenderers[node.type](node, ctx);

  switch (node.type) {
    case 'doc':
      return renderMarkdownBlocks(getNodeChildren(node), ctx);
    case 'paragraph':
      return renderMarkdownParagraph(node, ctx);
    case 'heading': {
      const level = Math.min(Math.max(Number(node?.attrs?.level || 1), 1), 6);
      const text = renderMarkdownInline(getNodeChildren(node), ctx);
      return text ? `${'#'.repeat(level)} ${text}\n\n` : '';
    }
    case 'bulletList':
      return `${getNodeChildren(node)
        .map((child) => renderMarkdownListItem(child, ctx))
        .join('')}\n`;
    case 'orderedList': {
      const start = node?.attrs?.order ?? 1;
      return `${getNodeChildren(node)
        .map((child, i) => {
          const index = start + i;
          const text = renderMarkdownInline(getNodeChildren(child), ctx);
          const nested = getNodeChildren(child).filter(
            (c) => !['paragraph'].includes(c?.type)
          );
          const rendered = nested
            .map((c) => renderMarkdownBlock(c, { ...ctx, inList: true }))
            .join('');
          const marker = `${index}.`;
          const lines = (text || '').split('\n');
          return `${marker} ${lines[0]}${
            lines.slice(1).length
              ? '\n' +
                lines
                  .slice(1)
                  .map((l) => ' '.repeat(String(marker).length + 1) + l)
                  .join('\n')
              : ''
          }${rendered ? '\n' + prefixLines(trimBlock(rendered), '  ') : ''}`;
        })
        .join('\n')}\n\n`;
    }
    case 'taskList':
      return `${getNodeChildren(node)
        .map((child) => renderMarkdownListItem(child, ctx, { task: true }))
        .join('')}\n`;
    case 'codeBlock': {
      const language = node?.attrs?.language || '';
      const code = getNodeChildren(node)
        .map((child) => child?.text || '')
        .join('');
      return `\`\`\`${language}\n${code}\n\`\`\`\n\n`;
    }
    case 'blockquote':
      return `${prefixLines(
        trimBlock(
          getNodeChildren(node)
            .map((child) => renderMarkdownBlock(child, ctx))
            .join('')
        ),
        '> '
      )}\n\n`;
    case 'horizontalRule':
      return '---\n\n';
    case 'mathBlock': {
      const content = getNodeChildren(node)
        .map((child) => child?.text || '')
        .join('');
      return `\`\`\`math\n${content}\n\`\`\`\n\n`;
    }
    case 'callout': {
      const color = node?.attrs?.color || 'blue';
      const body = getNodeChildren(node)
        .map((child) => renderMarkdownBlock(child, ctx))
        .join('');
      return `> **${
        color.charAt(0).toUpperCase() + color.slice(1)
      }**\n${prefixLines(trimBlock(body), '> ')}\n\n`;
    }
    case 'table':
      return renderMarkdownTable(node, ctx);
    case 'footnotes':
      return `${getNodeChildren(node)
        .map((child) => renderMarkdownFootnote(child, ctx))
        .join('')}\n`;
    case 'footnote':
      return renderMarkdownFootnote(node, ctx);
    case 'math_inline':
      return `$${node?.attrs?.content || buildInlineFallback(node)}$`;
    case 'image':
      return `![${node?.attrs?.alt || ''}](${resolveAssetOutputPath(
        node?.attrs?.src,
        ctx.noteId
      )})\n\n`;
    default:
      if (ctx.inList && getNodeChildren(node).length > 0)
        return getNodeChildren(node)
          .map((child) => renderMarkdownBlock(child, ctx))
          .join('');
      if (getNodeChildren(node).length > 0)
        return getNodeChildren(node)
          .map((child) => renderMarkdownBlock(child, ctx))
          .join('');
      const fallback = collectDescendantText(node);
      return fallback ? `${escapeMarkdownText(fallback)}\n\n` : '';
  }
}

function renderMarkdownBlocks(nodes, ctx) {
  return (nodes || []).map((node) => renderMarkdownBlock(node, ctx)).join('');
}

export function buildFrontmatter(note, folderPath) {
  if (!note) return '';
  const parts = ['---', `title: ${quoteYaml(note.title || 'Untitled')}`];
  if (Array.isArray(note.labels) && note.labels.length) {
    parts.push('labels:');
    note.labels.forEach((label) => parts.push(`  - ${quoteYaml(label)}`));
  }
  if (note.createdAt) parts.push(`created: ${toIsoString(note.createdAt)}`);
  if (note.updatedAt) parts.push(`updated: ${toIsoString(note.updatedAt)}`);
  if (folderPath) parts.push(`folder: ${quoteYaml(folderPath)}`);
  parts.push('---');
  return parts.join('\n');
}

export function tiptapToMarkdown(content, options = {}) {
  const { noteId = '' } = options;
  const nodes = getDocContent(content);
  if (!nodes.length) return '';
  return renderMarkdownBlocks(nodes, createRenderContext(noteId)).trim();
}
