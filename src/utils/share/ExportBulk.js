import dayjs from '@/lib/dayjs';
import { useStorage } from '@/composable/storage';
import { useFolderStore } from '@/store/folder';
import { useNoteStore } from '@/store/note';
import { backend, path } from '@/lib/tauri-bridge';

const INVALID_FILE_CHARS = /[\/\\:*?"<>|]/g;
const CALLOUT_STYLES = `
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

function sanitizeFileName(value) {
  const sanitized = String(value || '')
    .replace(INVALID_FILE_CHARS, '-')
    .trim();
  return sanitized || 'Untitled';
}

function escapeHtml(value) {
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

function normalizeWhitespace(value) {
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

function getNodeChildren(node) {
  return Array.isArray(node?.content) ? node.content : [];
}

function getDocContent(content) {
  if (!content) return [];
  if (Array.isArray(content)) return content;
  if (content.type === 'doc' && Array.isArray(content.content)) {
    return content.content;
  }
  return Array.isArray(content.content) ? content.content : [];
}

function collectDescendantText(node) {
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

function buildHtmlInlineFallback(node) {
  return escapeHtml(collectDescendantText(node));
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

function resolveAssetOutputPath(src, noteId) {
  const resolved = resolveAssetSrc(src, noteId);
  if (!resolved?.filename) return src || '';
  if (resolved.type === 'remote') return resolved.filename;
  const assetNoteId = resolved.assetNoteId || noteId;
  if (resolved.type === 'notes-assets') {
    return `assets/${assetNoteId}/${resolved.filename}`;
  }
  return `file-assets/${assetNoteId}/${resolved.filename}`;
}

function getFootnoteNumber(attrs = {}, ctx) {
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

function createRenderContext(noteId) {
  return {
    noteId,
    footnoteNumbers: new Map(),
    footnoteCounter: 1,
  };
}

function renderMarkdownInline(nodes, ctx) {
  return (nodes || [])
    .map((node) => renderMarkdownInlineNode(node, ctx))
    .join('');
}

function renderMarkdownInlineNode(node, ctx) {
  if (!node) return '';

  switch (node.type) {
    case 'text': {
      const hasCode = (node.marks || []).some((mark) => mark.type === 'code');
      let text = hasCode
        ? String(node.text ?? '')
        : escapeMarkdownText(normalizeWhitespace(node.text ?? ''));

      const marks = Array.isArray(node.marks) ? [...node.marks] : [];
      const nonLinkMarks = marks.filter((mark) => mark.type !== 'link');
      const linkMarks = marks.filter((mark) => mark.type === 'link');

      nonLinkMarks.forEach((mark) => {
        if (mark.type === 'bold') {
          text = `**${text}**`;
        } else if (mark.type === 'italic') {
          text = `_${text}_`;
        } else if (mark.type === 'code') {
          text = `\`${text.replace(/`/g, '\\`')}\``;
        } else if (mark.type === 'strike') {
          text = `~~${text}~~`;
        }
      });

      linkMarks.forEach((mark) => {
        const href = mark?.attrs?.href || '';
        text = `[${text || escapeMarkdownText(href)}](${href})`;
      });

      return text;
    }
    case 'hardBreak':
      return '\n';
    case 'image': {
      const src = resolveAssetOutputPath(node?.attrs?.src, ctx.noteId);
      const alt = node?.attrs?.alt || '';
      return `![${escapeMarkdownText(alt)}](${src})`;
    }
    case 'math_inline': {
      const value =
        node?.attrs?.content ||
        renderMarkdownInline(getNodeChildren(node), ctx) ||
        collectDescendantText(node);
      return `$${value}$`;
    }
    case 'footnoteReference':
      return `[^${getFootnoteNumber(node.attrs, ctx)}]`;
    case 'fileEmbed': {
      const href = resolveAssetOutputPath(node?.attrs?.src, ctx.noteId);
      const label =
        node?.attrs?.fileName || path.basename(href) || 'Attachment';
      return `[${escapeMarkdownText(label)}](${href})`;
    }
    case 'iframe': {
      const src = node?.attrs?.src || '';
      const width = node?.attrs?.width || '560';
      const height = node?.attrs?.height || '315';
      const frameborder = node?.attrs?.frameborder ?? '0';
      const allow = node?.attrs?.allow || '';
      const allowfullscreen = node?.attrs?.allowfullscreen
        ? ' allowfullscreen'
        : '';
      return `<iframe src="${escapeHtml(src)}" width="${escapeHtml(
        width
      )}" height="${escapeHtml(height)}" frameborder="${escapeHtml(
        frameborder
      )}" allow="${escapeHtml(allow)}"${allowfullscreen}></iframe>`;
    }
    case 'Audio': {
      const src = resolveAssetOutputPath(node?.attrs?.src, ctx.noteId);
      return `![:audio](${src})`;
    }
    case 'Video': {
      const src = resolveAssetOutputPath(node?.attrs?.src, ctx.noteId);
      return `![:video](${src})`;
    }
    default:
      if (getNodeChildren(node).length > 0) {
        return renderMarkdownInline(getNodeChildren(node), ctx);
      }
      return buildInlineFallback(node);
  }
}

function renderMarkdownParagraph(node, ctx, inList = false) {
  const text = trimBlock(renderMarkdownInline(getNodeChildren(node), ctx));
  if (!text) return inList ? '' : '\n';
  return inList ? text : `${text}\n\n`;
}

function renderMarkdownListItem(node, ctx, options = {}) {
  const { ordered = false, index = 1, task = false, indent = 0 } = options;
  const children = getNodeChildren(node);
  const inlineParts = [];
  const nestedBlocks = [];

  children.forEach((child) => {
    if (['bulletList', 'orderedList', 'taskList'].includes(child?.type)) {
      nestedBlocks.push(
        renderMarkdownBlock(child, ctx, { indent: indent + 1 })
      );
      return;
    }

    if (child?.type === 'paragraph') {
      inlineParts.push(trimBlock(renderMarkdownParagraph(child, ctx, true)));
      return;
    }

    const rendered = trimBlock(
      renderMarkdownBlock(child, ctx, { inList: true, indent })
    );
    if (rendered) inlineParts.push(rendered);
  });

  const fallback = collectDescendantText(node);
  const text = (inlineParts.join('\n') || escapeMarkdownText(fallback)).trim();
  const marker = task
    ? `- [${node?.attrs?.checked ? 'x' : ' '}] `
    : ordered
    ? `${index}. `
    : '- ';
  const padding = ' '.repeat(marker.length);
  const baseIndent = '  '.repeat(indent);
  const lines = text ? text.split('\n') : [''];
  const firstLine = `${baseIndent}${marker}${lines[0]}`;
  const continuation = lines
    .slice(1)
    .map((line) => `${baseIndent}${padding}${line}`)
    .join('\n');
  const nested = nestedBlocks.filter(Boolean).join('');

  return `${firstLine}${continuation ? `\n${continuation}` : ''}${
    nested ? `\n${trimBlock(nested)}` : ''
  }\n`;
}

function renderMarkdownTable(node, ctx) {
  const rows = getNodeChildren(node)
    .filter((child) => child?.type === 'tableRow')
    .map((row) =>
      getNodeChildren(row).map((cell) => {
        const content = renderMarkdownInline(getNodeChildren(cell), ctx)
          .replace(/\n+/g, ' ')
          .trim();
        return content || ' ';
      })
    )
    .filter((row) => row.length > 0);

  if (!rows.length) return '';

  const width = Math.max(...rows.map((row) => row.length));
  const normalizedRows = rows.map((row) => {
    const cloned = [...row];
    while (cloned.length < width) cloned.push(' ');
    return cloned;
  });

  const header = normalizedRows[0];
  const divider = header.map(() => '---');
  const body = normalizedRows.slice(1);
  const lines = [
    `| ${header.join(' | ')} |`,
    `| ${divider.join(' | ')} |`,
    ...body.map((row) => `| ${row.join(' | ')} |`),
  ];

  return `${lines.join('\n')}\n\n`;
}

function renderMarkdownFootnote(node, ctx) {
  const number = getFootnoteNumber(node.attrs, ctx);
  const body = trimBlock(
    getNodeChildren(node)
      .map((child) => renderMarkdownBlock(child, ctx, { inList: true }))
      .join('')
  );
  if (!body) return '';
  const lines = body.split('\n');
  const firstLine = `[^${number}]: ${lines[0]}`;
  const rest = lines
    .slice(1)
    .map((line) => `    ${line}`)
    .join('\n');
  return `${firstLine}${rest ? `\n${rest}` : ''}\n`;
}

function renderMarkdownBlock(node, ctx, options = {}) {
  if (!node) return '';

  const { inList = false, indent = 0 } = options;

  switch (node.type) {
    case 'doc':
      return renderMarkdownBlocks(getNodeChildren(node), ctx);
    case 'paragraph':
      return renderMarkdownParagraph(node, ctx, inList);
    case 'heading': {
      const level = Math.min(Math.max(Number(node?.attrs?.level || 1), 1), 4);
      const text = trimBlock(renderMarkdownInline(getNodeChildren(node), ctx));
      return `${'#'.repeat(level)} ${text}\n\n`;
    }
    case 'bulletList':
      return `${getNodeChildren(node)
        .map((child) =>
          renderMarkdownListItem(child, ctx, { ordered: false, indent })
        )
        .join('')}\n`;
    case 'orderedList': {
      const start = Number(node?.attrs?.order || 1);
      return `${getNodeChildren(node)
        .map((child, index) =>
          renderMarkdownListItem(child, ctx, {
            ordered: true,
            index: start + index,
            indent,
          })
        )
        .join('')}\n`;
    }
    case 'taskList':
      return `${getNodeChildren(node)
        .map((child) =>
          renderMarkdownListItem(child, ctx, { task: true, indent })
        )
        .join('')}\n`;
    case 'listItem':
    case 'taskItem':
      return renderMarkdownListItem(node, ctx, {
        task: node.type === 'taskItem',
        indent,
      });
    case 'blockquote': {
      const body = trimBlock(renderMarkdownBlocks(getNodeChildren(node), ctx));
      if (!body) return '';
      return `${prefixLines(body, '> ')}\n\n`;
    }
    case 'codeBlock': {
      const language = node?.attrs?.language || '';
      const code =
        node?.attrs?.content ||
        getNodeChildren(node)
          .map((child) => child?.text || '')
          .join('');
      return `\`\`\`${language}\n${code}\n\`\`\`\n\n`;
    }
    case 'horizontalRule':
      return '---\n\n';
    case 'image':
      return `${renderMarkdownInlineNode(node, ctx)}\n\n`;
    case 'mathBlock': {
      const content =
        node?.attrs?.content ||
        getNodeChildren(node)
          .map((child) => child?.text || '')
          .join('');
      return `$$\n${content}\n$$\n\n`;
    }
    case 'mermaidDiagram':
      return `\`\`\`mermaid\n${node?.attrs?.content || ''}\n\`\`\`\n\n`;
    case 'iframe':
      return `${renderMarkdownInlineNode(node, ctx)}\n\n`;
    case 'fileEmbed':
      return `${renderMarkdownInlineNode(node, ctx)}\n\n`;
    case 'table':
      return renderMarkdownTable(node, ctx);
    case 'footnoteReference':
      return `${renderMarkdownInlineNode(node, ctx)}\n\n`;
    case 'footnotes':
      return `${getNodeChildren(node)
        .map((child) => renderMarkdownFootnote(child, ctx))
        .join('')}\n`;
    case 'footnote':
      return renderMarkdownFootnote(node, ctx);
    case 'Audio':
    case 'Video':
      return `${renderMarkdownInlineNode(node, ctx)}\n\n`;
    default: {
      if (/-Callout$/.test(node.type) || /Callout$/.test(node.type)) {
        const color = node.type.replace(/Callout$/, '').toLowerCase();
        const body = trimBlock(
          renderMarkdownBlocks(getNodeChildren(node), ctx)
        );
        const lines = body ? body.split('\n') : [''];
        const first = lines.shift() || '';
        const rest = lines.map((line) => `> ${line}`).join('\n');
        return `> [!${color}] ${first}${rest ? `\n${rest}` : ''}\n\n`;
      }

      if (getNodeChildren(node).length > 0) {
        const rendered = renderMarkdownBlocks(getNodeChildren(node), ctx);
        if (rendered.trim()) return rendered;
      }

      const fallback = collectDescendantText(node);
      if (!fallback) return '';
      return `${escapeMarkdownText(fallback)}\n\n`;
    }
  }
}

function renderMarkdownBlocks(nodes, ctx) {
  return (nodes || []).map((node) => renderMarkdownBlock(node, ctx)).join('');
}

function renderHtmlInline(nodes, ctx) {
  return (nodes || []).map((node) => renderHtmlInlineNode(node, ctx)).join('');
}

function renderHtmlInlineNode(node, ctx) {
  if (!node) return '';

  switch (node.type) {
    case 'text': {
      let text = escapeHtml(normalizeWhitespace(node.text ?? ''));
      const marks = Array.isArray(node.marks) ? [...node.marks] : [];
      const nonLinkMarks = marks.filter((mark) => mark.type !== 'link');
      const linkMarks = marks.filter((mark) => mark.type === 'link');

      nonLinkMarks.forEach((mark) => {
        if (mark.type === 'bold') {
          text = `<strong>${text}</strong>`;
        } else if (mark.type === 'italic') {
          text = `<em>${text}</em>`;
        } else if (mark.type === 'code') {
          text = `<code>${text}</code>`;
        } else if (mark.type === 'strike') {
          text = `<s>${text}</s>`;
        }
      });

      linkMarks.forEach((mark) => {
        const href = escapeHtml(mark?.attrs?.href || '');
        text = `<a href="${href}">${text || href}</a>`;
      });

      return text;
    }
    case 'hardBreak':
      return '<br>';
    case 'image': {
      const src = escapeHtml(
        resolveAssetOutputPath(node?.attrs?.src, ctx.noteId)
      );
      const alt = escapeHtml(node?.attrs?.alt || '');
      return `<img src="${src}" alt="${alt}">`;
    }
    case 'math_inline': {
      const value =
        node?.attrs?.content ||
        renderHtmlInline(getNodeChildren(node), ctx) ||
        buildHtmlInlineFallback(node);
      return `<code>${escapeHtml(value.replace(/<[^>]+>/g, ''))}</code>`;
    }
    case 'footnoteReference': {
      const number = getFootnoteNumber(node.attrs, ctx);
      return `<sup id="fnref:${escapeHtml(
        number
      )}"><a class="footnote-ref" href="#fn:${escapeHtml(
        number
      )}" data-reference-number="${escapeHtml(number)}">${escapeHtml(
        number
      )}</a></sup>`;
    }
    case 'fileEmbed': {
      const href = escapeHtml(
        resolveAssetOutputPath(node?.attrs?.src, ctx.noteId)
      );
      const label = escapeHtml(
        node?.attrs?.fileName || path.basename(href) || 'Attachment'
      );
      return `<a href="${href}" download>${label}</a>`;
    }
    case 'iframe': {
      const src = escapeHtml(node?.attrs?.src || '');
      const width = escapeHtml(node?.attrs?.width || '560');
      const height = escapeHtml(node?.attrs?.height || '315');
      const frameborder = escapeHtml(node?.attrs?.frameborder ?? '0');
      const allow = escapeHtml(node?.attrs?.allow || '');
      const allowfullscreen = node?.attrs?.allowfullscreen
        ? ' allowfullscreen'
        : '';
      return `<iframe src="${src}" width="${width}" height="${height}" frameborder="${frameborder}" allow="${allow}"${allowfullscreen}></iframe>`;
    }
    case 'Audio': {
      const src = escapeHtml(
        resolveAssetOutputPath(node?.attrs?.src, ctx.noteId)
      );
      return `<audio controls src="${src}">Your browser does not support the audio element.</audio>`;
    }
    case 'Video': {
      const src = escapeHtml(
        resolveAssetOutputPath(node?.attrs?.src, ctx.noteId)
      );
      return `<video controls src="${src}" style="max-width: 100%; height: auto;">Your browser does not support the video tag.</video>`;
    }
    default:
      if (getNodeChildren(node).length > 0) {
        return renderHtmlInline(getNodeChildren(node), ctx);
      }
      return buildHtmlInlineFallback(node);
  }
}

function renderHtmlListItem(node, ctx, options = {}) {
  const { task = false } = options;
  const children = getNodeChildren(node);
  const content = children
    .map((child) => {
      if (child?.type === 'paragraph') {
        return renderHtmlInline(getNodeChildren(child), ctx);
      }
      if (['bulletList', 'orderedList', 'taskList'].includes(child?.type)) {
        return renderHtmlBlock(child, ctx);
      }
      return renderHtmlBlock(child, ctx);
    })
    .join('');

  const fallback = buildHtmlInlineFallback(node);
  if (!task) {
    return `<li>${content || fallback}</li>`;
  }

  const checked = node?.attrs?.checked ? ' checked' : '';
  return `<li><label><input type="checkbox" disabled${checked}> ${
    content || fallback
  }</label></li>`;
}

function renderHtmlTable(node, ctx) {
  const rows = getNodeChildren(node).filter(
    (child) => child?.type === 'tableRow'
  );
  if (!rows.length) return '';

  const headerCells = getNodeChildren(rows[0]).map(
    (cell) =>
      `<th>${renderHtmlInline(getNodeChildren(cell), ctx) || '&nbsp;'}</th>`
  );
  const bodyRows = rows.slice(1).map((row) => {
    const cells = getNodeChildren(row).map(
      (cell) =>
        `<td>${renderHtmlInline(getNodeChildren(cell), ctx) || '&nbsp;'}</td>`
    );
    return `<tr>${cells.join('')}</tr>`;
  });

  return `<table><thead><tr>${headerCells.join(
    ''
  )}</tr></thead><tbody>${bodyRows.join('')}</tbody></table>`;
}

function renderHtmlFootnote(node, ctx) {
  const number = getFootnoteNumber(node.attrs, ctx);
  const body = getNodeChildren(node)
    .map((child) => renderHtmlBlock(child, ctx))
    .join('');
  return `<li id="fn:${escapeHtml(
    number
  )}" class="footnotes" data-id="${escapeHtml(
    node?.attrs?.['data-id'] || ''
  )}">${body}</li>`;
}

function renderHtmlBlock(node, ctx) {
  if (!node) return '';

  switch (node.type) {
    case 'doc':
      return renderHtmlBlocks(getNodeChildren(node), ctx);
    case 'paragraph':
      return `<p>${renderHtmlInline(getNodeChildren(node), ctx)}</p>`;
    case 'heading': {
      const level = Math.min(Math.max(Number(node?.attrs?.level || 1), 1), 4);
      return `<h${level}>${renderHtmlInline(
        getNodeChildren(node),
        ctx
      )}</h${level}>`;
    }
    case 'bulletList':
      return `<ul>${getNodeChildren(node)
        .map((child) => renderHtmlListItem(child, ctx))
        .join('')}</ul>`;
    case 'orderedList':
      return `<ol start="${escapeHtml(
        node?.attrs?.order || 1
      )}">${getNodeChildren(node)
        .map((child) => renderHtmlListItem(child, ctx))
        .join('')}</ol>`;
    case 'taskList':
      return `<ul>${getNodeChildren(node)
        .map((child) => renderHtmlListItem(child, ctx, { task: true }))
        .join('')}</ul>`;
    case 'listItem':
      return renderHtmlListItem(node, ctx);
    case 'taskItem':
      return renderHtmlListItem(node, ctx, { task: true });
    case 'blockquote':
      return `<blockquote>${renderHtmlBlocks(
        getNodeChildren(node),
        ctx
      )}</blockquote>`;
    case 'codeBlock': {
      const language = escapeHtml(node?.attrs?.language || '');
      const code =
        node?.attrs?.content ||
        getNodeChildren(node)
          .map((child) => child?.text || '')
          .join('');
      return `<pre><code${
        language ? ` class="language-${language}"` : ''
      }>${escapeHtml(code)}</code></pre>`;
    }
    case 'horizontalRule':
      return '<hr>';
    case 'image':
    case 'iframe':
    case 'fileEmbed':
    case 'Audio':
    case 'Video':
      return renderHtmlInlineNode(node, ctx);
    case 'mathBlock': {
      const content =
        node?.attrs?.content ||
        getNodeChildren(node)
          .map((child) => child?.text || '')
          .join('');
      return `<pre><code class="language-latex">${escapeHtml(
        content
      )}</code></pre>`;
    }
    case 'mermaidDiagram':
      return `<pre><code class="language-mermaid">${escapeHtml(
        node?.attrs?.content || ''
      )}</code></pre>`;
    case 'table':
      return renderHtmlTable(node, ctx);
    case 'footnoteReference':
      return renderHtmlInlineNode(node, ctx);
    case 'footnotes':
      return `<ol class="footnotes">${getNodeChildren(node)
        .map((child) => renderHtmlFootnote(child, ctx))
        .join('')}</ol>`;
    case 'footnote':
      return renderHtmlFootnote(node, ctx);
    default: {
      if (/-Callout$/.test(node.type) || /Callout$/.test(node.type)) {
        const color = node.type.replace(/Callout$/, '').toLowerCase();
        return `<blockquote class="callout callout-${escapeHtml(
          color
        )}">${renderHtmlBlocks(getNodeChildren(node), ctx)}</blockquote>`;
      }

      if (getNodeChildren(node).length > 0) {
        const rendered = renderHtmlBlocks(getNodeChildren(node), ctx);
        if (rendered) return rendered;
      }

      const fallback = buildHtmlInlineFallback(node);
      return fallback ? `<p>${fallback}</p>` : '';
    }
  }
}

function renderHtmlBlocks(nodes, ctx) {
  return (nodes || []).map((node) => renderHtmlBlock(node, ctx)).join('');
}

function buildHtmlDocument(note, body) {
  return `<!DOCTYPE html>
<html>
  <head>
    <meta charset="utf-8">
    <title>${escapeHtml(note?.title || 'Untitled')}</title>
    <style>${CALLOUT_STYLES}</style>
  </head>
  <body>${body}</body>
</html>`;
}

async function copyNoteAssetDir(sourcePath, destPath) {
  try {
    await backend.invoke('fs:ensureDir', destPath);
    await backend.invoke('fs:copy', {
      path: sourcePath,
      dest: destPath,
    });
  } catch (error) {
    console.warn('Asset copy failed:', error);
  }
}

async function copyNoteAssets(dataDir, noteId, outputDir) {
  if (!dataDir) return;

  await copyNoteAssetDir(
    path.join(dataDir, 'notes-assets', noteId),
    path.join(outputDir, 'assets', noteId)
  );
  await copyNoteAssetDir(
    path.join(dataDir, 'file-assets', noteId),
    path.join(outputDir, 'file-assets', noteId)
  );
}

function buildOutputDir(rootDir, folderPath) {
  if (!folderPath) return rootDir;
  return path.join(rootDir, folderPath);
}

function normalizeFolders(folderStore) {
  return Array.isArray(folderStore?.data)
    ? folderStore.data
    : Object.values(folderStore?.data || {});
}

function normalizeNotes(noteStore) {
  return Object.values(noteStore?.data || {}).filter((note) => note?.id);
}

export function buildFolderTree(folders) {
  const folderMap = {};
  const normalizedFolders = Array.isArray(folders)
    ? folders
    : Object.values(folders || {});

  normalizedFolders.forEach((folder) => {
    if (!folder?.id) return;
    folderMap[folder.id] = {
      ...folder,
      children: [],
    };
  });

  Object.values(folderMap).forEach((folder) => {
    if (folder.parentId == null) return;
    const parent = folderMap[folder.parentId];
    if (parent) {
      parent.children.push(folder);
    }
  });

  return folderMap;
}

export function getFolderPath(folderId, folderMap) {
  if (!folderId || !folderMap?.[folderId]) return '';

  const segments = [];
  const visited = new Set();
  let currentId = folderId;

  while (currentId && folderMap[currentId] && !visited.has(currentId)) {
    visited.add(currentId);
    const folder = folderMap[currentId];
    segments.unshift(sanitizeFileName(folder.name));
    currentId = folder.parentId;
  }

  return segments.join('/');
}

export function buildFrontmatter(note, folderPath) {
  const lines = [
    '---',
    `title: ${quoteYaml(note?.title || 'Untitled')}`,
    `created: ${quoteYaml(toIsoString(note?.createdAt))}`,
    `updated: ${quoteYaml(toIsoString(note?.updatedAt))}`,
  ];

  if (Array.isArray(note?.labels) && note.labels.length > 0) {
    lines.push(
      `labels: ${JSON.stringify(note.labels.map((label) => String(label)))}`
    );
  }

  if (folderPath) {
    lines.push(`folder: ${quoteYaml(folderPath)}`);
  }

  if (note?.isBookmarked) {
    lines.push('bookmarked: true');
  }

  if (note?.isArchived) {
    lines.push('archived: true');
  }

  lines.push('---');
  return lines.join('\n');
}

export function tiptapToMarkdown(content, options = {}) {
  const ctx = createRenderContext(options.noteId);
  return trimBlock(renderMarkdownBlocks(getDocContent(content), ctx));
}

function tiptapToHTML(content, options = {}) {
  const ctx = createRenderContext(options.noteId);
  return renderHtmlBlocks(getDocContent(content), ctx);
}

export function resolveAssetSrc(src, noteId) {
  const value = String(src || '').trim();
  if (!value) {
    return { type: 'remote', filename: '' };
  }

  if (/^https?:\/\//i.test(value)) {
    return { type: 'remote', filename: value };
  }

  const fileAssetsSchemeMatch = value.match(/^file-assets:\/\/([^/]+)\/(.+)$/);
  if (fileAssetsSchemeMatch) {
    return {
      type: 'file-assets',
      filename: fileAssetsSchemeMatch[2],
      assetNoteId: fileAssetsSchemeMatch[1],
    };
  }

  const noteAssetsSchemeMatch = value.match(/^assets:\/\/([^/]+)\/(.+)$/);
  if (noteAssetsSchemeMatch) {
    return {
      type: 'notes-assets',
      filename: noteAssetsSchemeMatch[2],
      assetNoteId: noteAssetsSchemeMatch[1],
    };
  }

  if (value.startsWith('file-assets/')) {
    return {
      type: 'file-assets',
      filename: value.replace(/^file-assets\//, ''),
      assetNoteId: noteId,
    };
  }

  if (value.startsWith('assets/')) {
    return {
      type: 'notes-assets',
      filename: value.replace(/^assets\//, ''),
      assetNoteId: noteId,
    };
  }

  return {
    type: 'remote',
    filename: value,
  };
}

export async function exportAllMarkdown(onProgress) {
  const { canceled, filePaths = [] } = await backend.invoke('dialog:open', {
    title: 'Select export folder',
    properties: ['openDirectory'],
  });

  if (canceled || !filePaths.length) {
    return null;
  }

  const noteStore = useNoteStore();
  const folderStore = useFolderStore();
  const storage = useStorage('settings');
  const dataDir = await storage.get('dataDir', '');
  const notes = normalizeNotes(noteStore);
  const folderMap = buildFolderTree(normalizeFolders(folderStore));
  const outputRoot = path.join(
    filePaths[0],
    `Beaver Notes Export ${dayjs().format('YYYY-MM-DD')}`
  );

  await backend.invoke('fs:ensureDir', outputRoot);

  const skipped = [];
  let exported = 0;
  let done = 0;
  const total = notes.length;

  for (const note of notes) {
    const currentTitle = note?.title || 'Untitled';

    if (note?.isLocked) {
      skipped.push({ title: currentTitle, reason: 'locked' });
      done += 1;
      onProgress?.({ done, total, current: currentTitle });
      continue;
    }

    const folderPath = getFolderPath(note?.folderId, folderMap);
    const outputDir = buildOutputDir(outputRoot, folderPath);
    const frontmatter = buildFrontmatter(note, folderPath);
    const markdownBody = tiptapToMarkdown(note?.content, { noteId: note?.id });
    const fileName = `${sanitizeFileName(note?.title)}.md`;

    await backend.invoke('fs:ensureDir', outputDir);
    await backend.invoke('fs:writeFile', {
      path: path.join(outputDir, fileName),
      data: `${frontmatter}\n\n${markdownBody}`.trimEnd(),
    });

    await copyNoteAssets(dataDir, note.id, outputDir);

    exported += 1;
    done += 1;
    onProgress?.({ done, total, current: currentTitle });
  }

  return { exported, skipped };
}

export async function exportAllHTML(onProgress) {
  const { canceled, filePaths = [] } = await backend.invoke('dialog:open', {
    title: 'Select export folder',
    properties: ['openDirectory'],
  });

  if (canceled || !filePaths.length) {
    return null;
  }

  const noteStore = useNoteStore();
  const folderStore = useFolderStore();
  const storage = useStorage('settings');
  const dataDir = await storage.get('dataDir', '');
  const notes = normalizeNotes(noteStore);
  const folderMap = buildFolderTree(normalizeFolders(folderStore));
  const outputRoot = path.join(
    filePaths[0],
    `Beaver Notes Export ${dayjs().format('YYYY-MM-DD')}`
  );

  await backend.invoke('fs:ensureDir', outputRoot);

  const skipped = [];
  let exported = 0;
  let done = 0;
  const total = notes.length;

  for (const note of notes) {
    const currentTitle = note?.title || 'Untitled';

    if (note?.isLocked) {
      skipped.push({ title: currentTitle, reason: 'locked' });
      done += 1;
      onProgress?.({ done, total, current: currentTitle });
      continue;
    }

    const folderPath = getFolderPath(note?.folderId, folderMap);
    const outputDir = buildOutputDir(outputRoot, folderPath);
    const body = tiptapToHTML(note?.content, { noteId: note?.id });
    const fileName = `${sanitizeFileName(note?.title)}.html`;

    await backend.invoke('fs:ensureDir', outputDir);
    await backend.invoke('fs:writeFile', {
      path: path.join(outputDir, fileName),
      data: buildHtmlDocument(note, body),
    });

    await copyNoteAssets(dataDir, note.id, outputDir);

    exported += 1;
    done += 1;
    onProgress?.({ done, total, current: currentTitle });
  }

  return { exported, skipped };
}
