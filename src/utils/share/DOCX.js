import {
  AlignmentType,
  BorderStyle,
  Document,
  ExternalHyperlink,
  HeadingLevel,
  ImageRun,
  LevelFormat,
  Packer,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  UnderlineType,
  WidthType,
} from 'docx';
import { useStorage } from '@/composable/storage';
import { useDialog } from '@/composable/dialog';
import { useI18nStore } from '@/store/i18n';
import { useNoteStore } from '@/store/note';
import { ipcRenderer, path } from '@/lib/tauri-bridge';

let collectedFootnotes = [];
let footnoteNumbers = new Map();
let footnoteCounter = 1;

const CALLOUT_STYLES = {
  black: { border: '444444', fill: 'F3F4F6' },
  blue: { border: '3B82F6', fill: 'DBEAFE' },
  yellow: { border: 'FACC15', fill: 'FEF3C7' },
  red: { border: 'EF4444', fill: 'FEE2E2' },
  green: { border: '10B981', fill: 'DCFCE7' },
  purple: { border: '8B5CF6', fill: 'EDE9FE' },
};

function getShareTranslations() {
  try {
    return useI18nStore().messages?.share || {};
  } catch {
    return {};
  }
}

function interpolate(template, params = {}) {
  let out = template;
  for (const [key, value] of Object.entries(params)) {
    out = out.split(`{${key}}`).join(String(value));
  }
  return out;
}

function showDialogAlert(body) {
  const i18n = useI18nStore();
  const dialog = useDialog();
  dialog.alert({
    title: i18n.messages?.settings?.alertTitle || 'Alert',
    body,
    okText: i18n.messages?.dialog?.close || 'Close',
  });
}

function sanitize(name) {
  return (name || '').replace(/[/\\?%*:|"<>]/g, '-').trim();
}

function getNodeChildren(node) {
  return Array.isArray(node?.content) ? node.content : [];
}

function normalizeText(value) {
  return String(value ?? '')
    .replace(/\r\n/g, '\n')
    .replace(/\u00a0/g, ' ');
}

function collectDescendantText(node) {
  if (!node) return '';
  if (node.type === 'text') return normalizeText(node.text || '');

  const directText =
    typeof node?.attrs?.content === 'string'
      ? normalizeText(node.attrs.content)
      : '';

  const nestedText = getNodeChildren(node)
    .map((child) => collectDescendantText(child))
    .filter(Boolean)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();

  return nestedText || directText;
}

function base64ToUint8Array(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function normalizeHexColor(value) {
  if (!value) return null;
  const raw = String(value).trim().replace(/^#/, '');
  if (/^[0-9a-f]{3}$/i.test(raw)) {
    return raw
      .split('')
      .map((char) => `${char}${char}`)
      .join('')
      .toUpperCase();
  }
  if (/^[0-9a-f]{6}$/i.test(raw)) {
    return raw.toUpperCase();
  }
  return null;
}

function isValidUrl(value) {
  try {
    const url = new URL(String(value || ''));
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

function getFootnoteNumber(attrs = {}) {
  const explicitNumber =
    attrs.referenceNumber || attrs['data-reference-number'];
  if (explicitNumber) return String(explicitNumber);

  const footnoteId = attrs['data-id'];
  if (!footnoteId) {
    const next = String(footnoteCounter);
    footnoteCounter += 1;
    return next;
  }

  if (!footnoteNumbers.has(footnoteId)) {
    footnoteNumbers.set(footnoteId, String(footnoteCounter));
    footnoteCounter += 1;
  }

  return footnoteNumbers.get(footnoteId);
}

function paragraphAlignment(value) {
  switch (value) {
    case 'center':
      return AlignmentType.CENTER;
    case 'right':
      return AlignmentType.RIGHT;
    case 'justify':
      return AlignmentType.JUSTIFIED;
    default:
      return AlignmentType.LEFT;
  }
}

function withLineBreaks(text, options = {}) {
  const value = String(text ?? '');
  const segments = value.split('\n');
  const runs = [];

  segments.forEach((segment, index) => {
    runs.push(new TextRun({ ...options, text: segment }));
    if (index < segments.length - 1) {
      runs.push(new TextRun({ break: 1 }));
    }
  });

  return runs.length ? runs : [new TextRun(options)];
}

function createParagraph(options = {}) {
  const paragraph = new Paragraph(options);
  paragraph.__beaverOptions = options;
  return paragraph;
}

function getParagraphOptions(paragraph) {
  return paragraph?.__beaverOptions || {};
}

function markToRunOptions(marks = [], baseOptions = {}) {
  const runOptions = { ...baseOptions };

  marks.forEach((mark) => {
    if (mark.type === 'bold') {
      runOptions.bold = true;
    } else if (mark.type === 'italic') {
      runOptions.italics = true;
    } else if (mark.type === 'underline') {
      runOptions.underline = { type: UnderlineType.SINGLE };
    } else if (mark.type === 'strike') {
      runOptions.strike = true;
    } else if (mark.type === 'superscript') {
      runOptions.superScript = true;
    } else if (mark.type === 'subscript') {
      runOptions.subScript = true;
    } else if (mark.type === 'code') {
      runOptions.font = 'Courier New';
      runOptions.shading = { fill: 'F5F5F5' };
    } else if (mark.type === 'highlight') {
      const highlight = mapHighlightColor(mark?.attrs?.color);
      if (highlight) {
        runOptions.highlight = highlight;
      }
    } else if (mark.type === 'textStyle') {
      const color = normalizeHexColor(mark?.attrs?.color);
      if (color) {
        runOptions.color = color;
      }
    }
  });

  return runOptions;
}

function mapHighlightColor(colorClass) {
  const value = String(colorClass || '').toLowerCase();
  if (!value) return undefined;

  if (value.includes('#dc8d42') || value.includes('orange')) return 'yellow';
  if (value.includes('#e3b324') || value.includes('yellow')) return 'yellow';
  if (value.includes('#4caf50') || value.includes('green')) return 'green';
  if (value.includes('#3a8ee6') || value.includes('blue')) return 'cyan';
  if (value.includes('#9b5ee6') || value.includes('purple')) return 'magenta';
  if (value.includes('#e67ea4') || value.includes('pink')) return 'magenta';
  if (value.includes('#e75c5c') || value.includes('red')) return 'red';

  return undefined;
}

function applyParagraphBox(
  paragraph,
  { borderColor, fill, indentLeft = 360 } = {}
) {
  return createParagraph({
    ...getParagraphOptions(paragraph),
    border: borderColor
      ? {
          left: {
            color: borderColor,
            style: BorderStyle.SINGLE,
            size: 32,
          },
        }
      : undefined,
    shading: fill ? { fill } : undefined,
    indent: { left: indentLeft },
  });
}

function makeFallbackParagraph(text, options = {}) {
  return createParagraph({
    ...options,
    children: options.children || withLineBreaks(text),
  });
}

function makeImagePlaceholder(src, fallbackName) {
  const label = fallbackName || path.basename(src || '') || src || 'image';
  return createParagraph({
    children: [new TextRun(`[Image: ${label}]`)],
  });
}

function resolveAssetSource(src, noteId) {
  const value = String(src || '').trim();
  if (!value) return null;
  if (/^https?:\/\//i.test(value)) {
    return { type: 'remote', filename: value, assetNoteId: noteId };
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
    const rest = value.replace(/^file-assets\//, '');
    const prefix = `${noteId}/`;
    return {
      type: 'file-assets',
      filename: rest.startsWith(prefix) ? rest.slice(prefix.length) : rest,
      assetNoteId: rest.startsWith(prefix) ? noteId : noteId,
    };
  }

  if (value.startsWith('assets/')) {
    const rest = value.replace(/^assets\//, '');
    const prefix = `${noteId}/`;
    return {
      type: 'notes-assets',
      filename: rest.startsWith(prefix) ? rest.slice(prefix.length) : rest,
      assetNoteId: noteId,
    };
  }

  return { type: 'remote', filename: value, assetNoteId: noteId };
}

function inferImageExtension(filename) {
  const ext = path
    .extname(filename || '')
    .replace('.', '')
    .toLowerCase();
  if (ext === 'jpeg') return 'jpg';
  if (['png', 'jpg', 'gif', 'webp'].includes(ext)) return ext;
  return null;
}

async function loadImageAsBase64(src, noteId, dataDir) {
  const resolved = resolveAssetSource(src, noteId);
  if (!resolved || resolved.type === 'remote') return null;

  const baseDir =
    resolved.type === 'notes-assets' ? 'notes-assets' : 'file-assets';
  const filePath = path.join(
    dataDir,
    baseDir,
    resolved.assetNoteId || noteId,
    resolved.filename
  );
  const extension = inferImageExtension(resolved.filename);
  if (!extension) return null;

  try {
    const base64 = await ipcRenderer.callMain('fs:readData', filePath);
    return {
      data: base64ToUint8Array(base64),
      extension,
    };
  } catch {
    return null;
  }
}

async function inlineNodesToDocx(nodes, noteId, dataDir, options = {}) {
  const children = [];

  for (const node of nodes || []) {
    const runs = await inlineNodeToDocx(node, noteId, dataDir, options);
    children.push(...runs);
  }

  return children;
}

async function inlineNodeToDocx(node, noteId, dataDir, options = {}) {
  if (!node) return [];

  const baseRunOptions = options.runOptions || {};

  switch (node.type) {
    case 'text': {
      const marks = Array.isArray(node.marks) ? node.marks : [];
      const runOptions = markToRunOptions(marks, baseRunOptions);
      const linkMark = marks.find((mark) => mark.type === 'link');
      const textRuns = withLineBreaks(
        normalizeText(node.text || ''),
        runOptions
      );

      if (linkMark?.attrs?.href) {
        return [
          new ExternalHyperlink({
            link: linkMark.attrs.href,
            children: textRuns,
          }),
        ];
      }

      return textRuns;
    }
    case 'hardBreak':
      return [new TextRun({ break: 1 })];
    case 'footnoteReference': {
      const number = getFootnoteNumber(node.attrs || {});
      return [
        new TextRun({
          ...baseRunOptions,
          text: `[${number}]`,
          superScript: true,
        }),
      ];
    }
    case 'image': {
      const image = await loadImageAsBase64(node?.attrs?.src, noteId, dataDir);
      if (!image) {
        const label = /^https?:\/\//i.test(node?.attrs?.src || '')
          ? node.attrs.src
          : path.basename(node?.attrs?.src || '') || node?.attrs?.alt;
        return [new TextRun(`[Image: ${label || 'image'}]`)];
      }

      const width = Number(node?.attrs?.width) || 480;
      const height = Number(node?.attrs?.height) || 320;
      return [
        new ImageRun({
          data: image.data,
          type: image.extension,
          transformation: {
            width,
            height,
          },
        }),
      ];
    }
    default: {
      const children = getNodeChildren(node);
      if (children.length) {
        return inlineNodesToDocx(children, noteId, dataDir, options);
      }

      const fallback = collectDescendantText(node);
      return fallback
        ? [new TextRun({ ...baseRunOptions, text: fallback })]
        : [];
    }
  }
}

async function paragraphFromNode(node, noteId, dataDir, options = {}) {
  const children = await inlineNodesToDocx(
    getNodeChildren(node),
    noteId,
    dataDir,
    options
  );

  return createParagraph({
    ...options.paragraphOptions,
    children: children.length ? children : [new TextRun('')],
    alignment: paragraphAlignment(node?.attrs?.textAlign),
  });
}

async function paragraphsFromStyledContainer(
  node,
  noteId,
  dataDir,
  { borderColor, fill, italics = false } = {}
) {
  const blocks = [];

  for (const child of getNodeChildren(node)) {
    if (child.type === 'paragraph' || child.type === 'heading') {
      const paragraph = await paragraphFromNode(child, noteId, dataDir, {
        runOptions: italics ? { italics: true } : {},
      });
      blocks.push(applyParagraphBox(paragraph, { borderColor, fill }));
      continue;
    }

    if (
      child.type === 'bulletList' ||
      child.type === 'orderedList' ||
      child.type === 'taskList'
    ) {
      const listBlocks = await tiptapNodeToDocx(child, noteId, dataDir, {
        listLevel: 0,
      });
      listBlocks.forEach((block) => {
        if (block instanceof Paragraph) {
          blocks.push(applyParagraphBox(block, { borderColor, fill }));
        } else {
          const fallbackText = collectDescendantText(child);
          if (fallbackText) {
            blocks.push(
              applyParagraphBox(makeFallbackParagraph(fallbackText), {
                borderColor,
                fill,
              })
            );
          }
        }
      });
      continue;
    }

    const fallbackText = collectDescendantText(child);
    if (fallbackText) {
      blocks.push(
        applyParagraphBox(
          makeFallbackParagraph(fallbackText, {
            children: withLineBreaks(
              fallbackText,
              italics ? { italics: true } : {}
            ),
          }),
          { borderColor, fill }
        )
      );
    }
  }

  if (!blocks.length) {
    blocks.push(
      applyParagraphBox(makeFallbackParagraph(''), {
        borderColor,
        fill,
      })
    );
  }

  return blocks;
}

async function convertListItem(
  node,
  noteId,
  dataDir,
  { kind, level = 0 } = {}
) {
  const children = getNodeChildren(node);
  const blocks = [];
  const prefix =
    kind === 'task'
      ? new TextRun({ text: node?.attrs?.checked ? '☑ ' : '☐ ' })
      : null;

  let usedLeadingParagraph = false;

  for (const child of children) {
    if (child.type === 'bulletList') {
      blocks.push(
        ...(await tiptapNodeToDocx(child, noteId, dataDir, {
          listLevel: level + 1,
        }))
      );
      continue;
    }

    if (child.type === 'orderedList') {
      blocks.push(
        ...(await tiptapNodeToDocx(child, noteId, dataDir, {
          listLevel: level + 1,
        }))
      );
      continue;
    }

    if (child.type === 'taskList') {
      blocks.push(
        ...(await tiptapNodeToDocx(child, noteId, dataDir, {
          listLevel: level + 1,
        }))
      );
      continue;
    }

    if (!usedLeadingParagraph) {
      const paragraph =
        child.type === 'paragraph' || child.type === 'heading'
          ? await paragraphFromNode(child, noteId, dataDir)
          : makeFallbackParagraph(collectDescendantText(child));

      const baseOptions = {
        ...getParagraphOptions(paragraph),
        indent: { left: 720 * (level + 1), hanging: kind === 'task' ? 0 : 360 },
      };

      if (kind === 'bullet') {
        blocks.push(
          createParagraph({
            ...baseOptions,
            bullet: { level },
          })
        );
      } else if (kind === 'ordered') {
        blocks.push(
          createParagraph({
            ...baseOptions,
            numbering: {
              reference: 'beaver-numbering',
              level,
            },
          })
        );
      } else {
        blocks.push(
          createParagraph({
            ...baseOptions,
            children: prefix
              ? [prefix, ...(getParagraphOptions(paragraph).children || [])]
              : getParagraphOptions(paragraph).children || [new TextRun('')],
          })
        );
      }

      usedLeadingParagraph = true;
      continue;
    }

    const extraBlocks = await tiptapNodeToDocx(child, noteId, dataDir, {
      listLevel: level,
    });
    extraBlocks.forEach((block) => {
      if (block instanceof Paragraph) {
        blocks.push(
          createParagraph({
            ...getParagraphOptions(block),
            indent: { left: 720 * (level + 1) },
          })
        );
      } else {
        blocks.push(block);
      }
    });
  }

  if (!usedLeadingParagraph) {
    const fallbackText = collectDescendantText(node) || '';
    if (kind === 'task') {
      blocks.push(
        createParagraph({
          indent: { left: 720 * (level + 1) },
          children: [prefix, ...withLineBreaks(fallbackText)],
        })
      );
    } else if (kind === 'ordered') {
      blocks.push(
        createParagraph({
          numbering: { reference: 'beaver-numbering', level },
          children: withLineBreaks(fallbackText),
        })
      );
    } else {
      blocks.push(
        createParagraph({
          bullet: { level },
          children: withLineBreaks(fallbackText),
        })
      );
    }
  }

  return blocks;
}

async function tableCellToDocx(node, noteId, dataDir, isHeader = false) {
  const contentBlocks = await Promise.all(
    getNodeChildren(node).map((child) =>
      tiptapNodeToDocx(child, noteId, dataDir)
    )
  );
  const flattened = contentBlocks.flat();
  const children = flattened.length
    ? flattened.map((block) => {
        if (block instanceof Paragraph) {
          if (!isHeader) return block;
          return createParagraph({
            children: withLineBreaks(collectDescendantText(node), {
              bold: true,
            }),
          });
        }
        const fallbackText = collectDescendantText(node);
        return makeFallbackParagraph(fallbackText, {
          children: withLineBreaks(
            fallbackText,
            isHeader ? { bold: true } : {}
          ),
        });
      })
    : [
        makeFallbackParagraph('', {
          children: [new TextRun({ text: '', bold: isHeader })],
        }),
      ];

  return new TableCell({
    width: { size: 25, type: WidthType.PERCENTAGE },
    shading: isHeader ? { fill: 'E8E8E8' } : undefined,
    children,
  });
}

async function tableRowToDocx(node, noteId, dataDir) {
  const cells = [];
  for (const child of getNodeChildren(node)) {
    const isHeader = child.type === 'tableHeader';
    cells.push(await tableCellToDocx(child, noteId, dataDir, isHeader));
  }

  return new TableRow({ children: cells });
}

function appendFootnoteDefinition(node) {
  const number = getFootnoteNumber(node.attrs || {});
  const body = getNodeChildren(node)
    .map((child) => collectDescendantText(child))
    .filter(Boolean)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (!body) return;

  collectedFootnotes.push(
    createParagraph({
      children: [
        new TextRun({ text: `[${number}] `, bold: true }),
        ...withLineBreaks(body),
      ],
    })
  );
}

async function tiptapNodeToDocx(node, noteId, dataDir, context = {}) {
  if (!node) return [];

  switch (node.type) {
    case 'doc': {
      const blocks = [];
      for (const child of getNodeChildren(node)) {
        blocks.push(
          ...(await tiptapNodeToDocx(child, noteId, dataDir, context))
        );
      }
      return blocks;
    }
    case 'paragraph':
      return [await paragraphFromNode(node, noteId, dataDir)];
    case 'heading': {
      const level = Math.min(Math.max(Number(node?.attrs?.level || 1), 1), 4);
      const headingMap = {
        1: HeadingLevel.HEADING_1,
        2: HeadingLevel.HEADING_2,
        3: HeadingLevel.HEADING_3,
        4: HeadingLevel.HEADING_4,
      };
      return [
        await paragraphFromNode(node, noteId, dataDir, {
          paragraphOptions: { heading: headingMap[level] },
        }),
      ];
    }
    case 'bulletList': {
      const blocks = [];
      for (const child of getNodeChildren(node)) {
        blocks.push(
          ...(await convertListItem(child, noteId, dataDir, {
            kind: 'bullet',
            level: context.listLevel || 0,
          }))
        );
      }
      return blocks;
    }
    case 'orderedList': {
      const blocks = [];
      for (const child of getNodeChildren(node)) {
        blocks.push(
          ...(await convertListItem(child, noteId, dataDir, {
            kind: 'ordered',
            level: context.listLevel || 0,
          }))
        );
      }
      return blocks;
    }
    case 'listItem':
      return convertListItem(node, noteId, dataDir, {
        kind: 'bullet',
        level: context.listLevel || 0,
      });
    case 'taskList': {
      const blocks = [];
      for (const child of getNodeChildren(node)) {
        blocks.push(
          ...(await convertListItem(child, noteId, dataDir, {
            kind: 'task',
            level: context.listLevel || 0,
          }))
        );
      }
      return blocks;
    }
    case 'taskItem':
      return convertListItem(node, noteId, dataDir, {
        kind: 'task',
        level: context.listLevel || 0,
      });
    case 'blockquote':
      return paragraphsFromStyledContainer(node, noteId, dataDir, {
        borderColor: '888888',
        fill: null,
        italics: true,
      });
    case 'codeBlock': {
      const code =
        node?.attrs?.content ||
        getNodeChildren(node)
          .map((child) => child?.text || '')
          .join('');

      return [
        createParagraph({
          shading: { fill: 'F5F5F5' },
          children: withLineBreaks(code, {
            font: 'Courier New',
            size: 20,
          }),
        }),
      ];
    }
    case 'horizontalRule':
      return [
        createParagraph({
          border: {
            bottom: {
              color: 'BDBDBD',
              style: BorderStyle.SINGLE,
              size: 12,
            },
          },
        }),
      ];
    case 'image': {
      const image = await loadImageAsBase64(node?.attrs?.src, noteId, dataDir);
      if (!image) {
        const src = node?.attrs?.src || '';
        const label = /^https?:\/\//i.test(src)
          ? src
          : path.basename(src) || node?.attrs?.alt;
        return [makeImagePlaceholder(src, label)];
      }

      const width = Number(node?.attrs?.width) || 480;
      const height = Number(node?.attrs?.height) || 320;
      return [
        createParagraph({
          alignment: AlignmentType.CENTER,
          children: [
            new ImageRun({
              data: image.data,
              type: image.extension,
              transformation: { width, height },
            }),
          ],
        }),
      ];
    }
    case 'table': {
      const rows = [];
      for (const child of getNodeChildren(node)) {
        rows.push(await tableRowToDocx(child, noteId, dataDir));
      }
      return [
        new Table({
          width: { size: 100, type: WidthType.PERCENTAGE },
          rows,
        }),
      ];
    }
    case 'tableRow':
      return [await tableRowToDocx(node, noteId, dataDir)];
    case 'tableHeader':
    case 'tableCell':
      return [
        createParagraph({
          children: withLineBreaks(collectDescendantText(node)),
        }),
      ];
    case 'mathBlock': {
      const content =
        node?.attrs?.content ||
        getNodeChildren(node)
          .map((child) => child?.text || '')
          .join('');
      return [
        createParagraph({
          children: [
            new TextRun('[Math block - rendered in Beaver Notes]'),
            new TextRun({ break: 1 }),
            ...withLineBreaks(`$$\n${content}\n$$`, { font: 'Courier New' }),
          ],
        }),
      ];
    }
    case 'mermaidDiagram':
      return [
        createParagraph({
          children: [
            new TextRun('[Diagram - rendered in Beaver Notes]'),
            new TextRun({ break: 1 }),
            ...withLineBreaks(node?.attrs?.content || '', {
              font: 'Courier New',
            }),
          ],
        }),
      ];
    case 'iframe': {
      const src = node?.attrs?.src || '';
      if (isValidUrl(src)) {
        return [
          createParagraph({
            children: [
              new ExternalHyperlink({
                link: src,
                children: [
                  new TextRun({
                    text: `[Embedded: ${src}]`,
                    color: '0563C1',
                    underline: { type: UnderlineType.SINGLE },
                  }),
                ],
              }),
            ],
          }),
        ];
      }

      return [makeFallbackParagraph(`[Embedded: ${src}]`)];
    }
    case 'fileEmbed': {
      const fileName =
        node?.attrs?.fileName ||
        path.basename(node?.attrs?.src || '') ||
        'Attachment';
      return [makeFallbackParagraph(`[Attached file: ${fileName}]`)];
    }
    case 'footnoteReference': {
      const number = getFootnoteNumber(node.attrs || {});
      return [
        createParagraph({
          children: [
            new TextRun({
              text: `[${number}]`,
              superScript: true,
            }),
          ],
        }),
      ];
    }
    case 'footnotes':
      getNodeChildren(node).forEach((child) => appendFootnoteDefinition(child));
      return [];
    case 'footnote':
      appendFootnoteDefinition(node);
      return [];
    default: {
      const calloutMatch = String(node.type || '').match(
        /^(black|blue|yellow|red|green|purple)Callout$/
      );
      if (calloutMatch) {
        const style = CALLOUT_STYLES[calloutMatch[1]];
        return paragraphsFromStyledContainer(node, noteId, dataDir, {
          borderColor: style.border,
          fill: style.fill,
        });
      }

      const children = getNodeChildren(node);
      if (children.length) {
        const blocks = [];
        for (const child of children) {
          blocks.push(
            ...(await tiptapNodeToDocx(child, noteId, dataDir, context))
          );
        }
        if (blocks.length) return blocks;
      }

      const fallback = collectDescendantText(node);
      return fallback ? [makeFallbackParagraph(fallback)] : [];
    }
  }
}

export async function exportDOCX(noteId, noteTitle, editor) {
  const share = getShareTranslations();
  const storage = useStorage('settings');
  const dataDir = await storage.get('dataDir', '');
  const noteStore = useNoteStore();
  const note = noteStore.data[noteId];

  collectedFootnotes = [];
  footnoteNumbers = new Map();
  footnoteCounter = 1;

  const tiptapJson = editor.getJSON();
  const children = await tiptapNodeToDocx(tiptapJson, noteId, dataDir);

  if (collectedFootnotes.length) {
    children.push(
      createParagraph({
        heading: HeadingLevel.HEADING_2,
        children: [new TextRun('Footnotes')],
      })
    );
    children.push(...collectedFootnotes);
  }

  const doc = new Document({
    creator: 'Beaver Notes',
    title: noteTitle,
    description: note?.labels?.join(', ') || '',
    sections: [
      {
        properties: {},
        children,
      },
    ],
    styles: {
      default: {
        document: {
          run: { font: 'Calibri', size: 24 },
        },
      },
    },
    numbering: {
      config: [
        {
          reference: 'beaver-numbering',
          levels: Array.from({ length: 6 }, (_, level) => ({
            level,
            format: LevelFormat.DECIMAL,
            text: `%${level + 1}.`,
            alignment: AlignmentType.LEFT,
            style: {
              paragraph: {
                indent: {
                  left: 720 * (level + 1),
                  hanging: 260,
                },
              },
            },
          })),
        },
      ],
    },
  });

  const blob = await Packer.toBlob(doc);
  const arrayBuffer = await blob.arrayBuffer();
  const uint8Array = new Uint8Array(arrayBuffer);

  const { canceled, filePath } = await ipcRenderer.callMain('dialog:save', {
    title: share.exportDataDialogTitle || 'Save as Word document',
    defaultPath: `${sanitize(noteTitle) || 'ExportedNote'}.docx`,
    filters: [{ name: 'Word Document', extensions: ['docx'] }],
  });
  if (canceled || !filePath) return;

  await ipcRenderer.callMain('fs:writeFile', {
    path: filePath,
    data: uint8Array,
  });

  showDialogAlert(
    interpolate(share.exportedDocx || 'Exported "{title}" as Word document.', {
      title: noteTitle || 'note',
    })
  );
}

export { tiptapNodeToDocx, loadImageAsBase64 };
