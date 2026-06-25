const CARD_PREVIEW_VERSION = 1;
const MAX_BLOCKS = 5;
const MAX_TOTAL_CHARS = 240;

const MAX_CHARS_BY_KIND = {
  heading: 72,
  paragraph: 96,
  quote: 88,
  code: 72,
  list: 72,
  task: 72,
  callout: 84,
};

const MEDIA_TYPES = {
  audioBlock: { label: 'Audio', tone: 'audio' },
  videoBlock: { label: 'Video', tone: 'video' },
  fileEmbed: { label: 'Attachment', tone: 'file' },
  mermaidBlock: { label: 'Diagram', tone: 'diagram' },
  mermaidDiagram: { label: 'Diagram', tone: 'diagram' },
  mathBlock: { label: 'Math', tone: 'math' },
  mathInline: { label: 'Math', tone: 'math' },
  math_inline: { label: 'Math', tone: 'math' },
  paper: { label: 'Sketch', tone: 'sketch' },
};

export const EMPTY_CARD_PREVIEW = Object.freeze({
  version: CARD_PREVIEW_VERSION,
  blocks: [],
  hasMore: false,
  mediaCount: 0,
  visibleMediaCount: 0,
});

function normalizeText(text) {
  return String(text || '')
    .replace(/\u00a0/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/\s+([,.;:!?%)\]}])/g, '$1')
    .replace(/([([{])\s+/g, '$1')
    .replace(/\s+(['’])/g, '$1')
    .trim();
}

function truncateText(text, limit) {
  if (text.length <= limit) return text;
  return `${text.slice(0, Math.max(0, limit - 1)).trimEnd()}…`;
}

function extractInlineText(node) {
  if (!node) return '';
  if (Array.isArray(node)) {
    return node.map(extractInlineText).join('');
  }
  if (node.type === 'text') return node.text || '';
  if (node.type === 'hardBreak') return ' ';
  return extractInlineText(node.content || []);
}

function createPreview() {
  return {
    version: CARD_PREVIEW_VERSION,
    blocks: [],
    hasMore: false,
    mediaCount: 0,
    visibleMediaCount: 0,
  };
}

function visibleVisualBlocks(preview) {
  return preview.blocks.filter((block) =>
    ['image', 'table', 'media'].includes(block.kind)
  ).length;
}

function pushTextBlock(preview, kind, text, state) {
  const normalized = normalizeText(text);
  if (!normalized) return null;

  if (preview.blocks.length >= MAX_BLOCKS) {
    preview.hasMore = true;
    return null;
  }

  const remainingChars = MAX_TOTAL_CHARS - state.charCount;
  if (remainingChars <= 0) {
    preview.hasMore = true;
    return null;
  }

  const limit = Math.min(
    MAX_CHARS_BY_KIND[kind] || MAX_CHARS_BY_KIND.paragraph,
    remainingChars
  );
  const truncated = truncateText(normalized, limit);
  if (truncated.length < normalized.length) {
    preview.hasMore = true;
  }

  state.charCount += truncated.length;
  const block = { kind, text: truncated };
  preview.blocks.push(block);
  return block;
}

function pushImageBlock(preview, attrs = {}) {
  const src = normalizeText(attrs.src);
  if (!src) return;

  preview.mediaCount += 1;
  if (preview.blocks.length >= MAX_BLOCKS) {
    preview.hasMore = true;
    return;
  }

  const hasVisibleImage = preview.blocks.some(
    (block) => block.kind === 'image'
  );
  if (hasVisibleImage) {
    preview.hasMore = true;
    return;
  }

  preview.blocks.push({
    kind: 'image',
    src,
    alt: normalizeText(attrs.alt),
  });
}

function extractTableRows(node) {
  const rows = [];

  for (const row of node.content || []) {
    if (rows.length >= 2) break;

    const cells = (row.content || [])
      .slice(0, 3)
      .map((cell) => {
        const text = truncateText(
          normalizeText(extractInlineText(cell.content)),
          18
        );
        if (!text) return null;

        return {
          text,
          isHeader: cell.type === 'tableHeader',
        };
      })
      .filter(Boolean);

    if (cells.length) rows.push(cells);
  }

  return rows;
}

function pushTableBlock(preview, node) {
  const rows = extractTableRows(node);
  if (!rows.length) {
    pushMediaBlock(preview, { label: 'Table', tone: 'table' });
    return;
  }

  preview.mediaCount += 1;

  if (preview.blocks.length >= MAX_BLOCKS) {
    preview.hasMore = true;
    return;
  }

  if (preview.blocks.some((block) => block.kind === 'table')) {
    preview.hasMore = true;
    return;
  }

  preview.blocks.push({ kind: 'table', rows });
}

function pushMediaBlock(preview, media) {
  preview.mediaCount += 1;

  if (preview.blocks.length >= MAX_BLOCKS) {
    preview.hasMore = true;
    return;
  }

  if (preview.blocks.some((block) => block.kind === 'media')) {
    preview.hasMore = true;
    return;
  }

  preview.blocks.push({
    kind: 'media',
    label: media.label,
    tone: media.tone,
    text: media.text ? truncateText(normalizeText(media.text), 52) : '',
  });
}

function visitNode(node, preview, state) {
  if (!node) return;

  switch (node.type) {
    case 'heading':
      pushTextBlock(preview, 'heading', extractInlineText(node.content), state);
      return;
    case 'paragraph':
      pushTextBlock(
        preview,
        'paragraph',
        extractInlineText(node.content),
        state
      );
      return;
    case 'blockquote':
      pushTextBlock(preview, 'quote', extractInlineText(node.content), state);
      return;
    case 'codeBlock':
      pushTextBlock(preview, 'code', extractInlineText(node.content), state);
      return;
    case 'image':
      pushImageBlock(preview, node.attrs);
      return;
    case 'bulletList':
    case 'orderedList':
      for (const item of node.content || []) {
        pushTextBlock(preview, 'list', extractInlineText(item.content), state);
        if (preview.blocks.length >= MAX_BLOCKS) {
          preview.hasMore = true;
          return;
        }
      }
      return;
    case 'taskList':
      for (const item of node.content || []) {
        const text = extractInlineText(item.content);
        if (!normalizeText(text)) continue;
        if (preview.blocks.length >= MAX_BLOCKS) {
          preview.hasMore = true;
          return;
        }

        const remainingChars = MAX_TOTAL_CHARS - state.charCount;
        if (remainingChars <= 0) {
          preview.hasMore = true;
          return;
        }

        const truncated = truncateText(
          normalizeText(text),
          Math.min(MAX_CHARS_BY_KIND.task, remainingChars)
        );
        if (truncated.length < normalizeText(text).length) {
          preview.hasMore = true;
        }
        state.charCount += truncated.length;
        preview.blocks.push({
          kind: 'task',
          text: truncated,
          checked: !!item.attrs?.checked,
        });
      }
      return;
    case 'table':
      pushTableBlock(preview, node);
      return;
    default:
      if (MEDIA_TYPES[node.type]) {
        pushMediaBlock(preview, {
          ...MEDIA_TYPES[node.type],
          text:
            node.attrs?.content || node.attrs?.title || node.attrs?.name || '',
        });
        return;
      }

      if (node.type?.endsWith('Callout')) {
        const block = pushTextBlock(
          preview,
          'callout',
          extractInlineText(node.content),
          state
        );
        if (block) {
          block.tone = node.type.replace(/Callout$/, '').toLowerCase();
        }
        return;
      }

      for (const child of node.content || []) {
        visitNode(child, preview, state);
        if (preview.blocks.length >= MAX_BLOCKS) {
          preview.hasMore = true;
          return;
        }
      }
  }
}

export function buildCardPreview(content) {
  const preview = createPreview();

  if (!content) return preview;

  if (typeof content === 'string') {
    const state = { charCount: 0 };
    for (const paragraph of content.split(/\n+/)) {
      pushTextBlock(preview, 'paragraph', paragraph, state);
      if (preview.blocks.length >= MAX_BLOCKS) break;
    }
    preview.visibleMediaCount = visibleVisualBlocks(preview);
    return preview;
  }

  const nodes = Array.isArray(content) ? content : content.content || [];
  const state = { charCount: 0 };

  for (const node of nodes) {
    visitNode(node, preview, state);
    if (preview.blocks.length >= MAX_BLOCKS) {
      preview.hasMore = true;
      break;
    }
  }

  preview.visibleMediaCount = visibleVisualBlocks(preview);

  return preview;
}
