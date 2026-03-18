import { marked } from 'marked';
import { v4 as uuidv4 } from 'uuid';
import { useStorage } from '@/composable/storage';
import { backend, path } from '@/lib/tauri-bridge';
import {
  createMediaFallbackNode,
  sanitizeImageSource,
  sanitizeMediaSource,
} from '@/utils/contentSecurity';

const storage = useStorage('settings');

export const readMarkdownFile = async (filePath) => {
  try {
    const markdown = await backend.invoke('fs:readFile', filePath);
    return markdown;
  } catch (error) {
    console.error(`Error reading file ${filePath}:`, error);
    throw error;
  }
};

export const convertMarkdownToTiptap = async (markdown, id, directoryPath) => {
  const footnoteDefinitions = [];
  const referenceNumberToId = {};

  // Step 1: Extract footnote references and definitions
  const footnoteRegex = /\[\^(\d+)\]:\s+(.*)/g;

  // Extract footnote definitions from markdown
  let match;
  while ((match = footnoteRegex.exec(markdown)) !== null) {
    const referenceNumber = match[1];
    const definition = match[2];
    const uuid = uuidv4();
    referenceNumberToId[referenceNumber] = uuid;
    footnoteDefinitions.push({
      type: 'footnote',
      attrs: {
        id: `fn:${referenceNumber}`,
        'data-id': uuid,
      },
      content: [
        {
          type: 'paragraph',
          content: [{ type: 'text', text: definition }],
        },
      ],
    });
  }

  // Remove footnote definitions from markdown for further processing
  const cleanedMarkdown = markdown.replace(footnoteRegex, '');

  // Step 2: Convert cleaned markdown to HTML
  const html = marked(cleanedMarkdown);
  const json = {
    type: 'doc',
    content: [],
  };

  const parser = new DOMParser();
  const doc = parser.parseFromString(html, 'text/html');

  const convertElementToTiptap = async (element) => {
    if (element.nodeType === Node.TEXT_NODE) {
      const text = element.textContent;

      // Handle inline math
      const inlineMathPattern = /\$([^$]+)\$/g;
      const inlineMathMatches = text.match(inlineMathPattern);
      if (inlineMathMatches) {
        const content = [];
        let lastIndex = 0;

        inlineMathMatches.forEach((match) => {
          const index = text.indexOf(match, lastIndex);
          if (index > lastIndex) {
            content.push({
              type: 'text',
              text: text.substring(lastIndex, index),
            });
          }
          const mathContent = match.slice(1, -1);
          content.push({
            type: 'math_inline',
            content: [{ type: 'text', text: mathContent }],
          });
          lastIndex = index + match.length;
        });

        if (lastIndex < text.length) {
          content.push({ type: 'text', text: text.substring(lastIndex) });
        }

        return { type: 'paragraph', content };
      }

      // Handle footnote references
      const footnotePattern = /\[\^(\d+)\]/g;
      const footnoteMatches = text.match(footnotePattern);
      if (footnoteMatches) {
        const content = [];
        let lastIndex = 0;

        footnoteMatches.forEach((match) => {
          const index = text.indexOf(match, lastIndex);
          if (index > lastIndex) {
            content.push({
              type: 'text',
              text: text.substring(lastIndex, index),
            });
          }
          const referenceNumber = match.slice(2, -1);
          const uuid = referenceNumberToId[referenceNumber];
          content.push({
            type: 'footnoteReference',
            attrs: {
              class: 'footnote-ref',
              'data-id': uuid,
              referenceNumber,
              href: null,
            },
          });
          lastIndex = index + match.length;
        });

        if (lastIndex < text.length) {
          content.push({ type: 'text', text: text.substring(lastIndex) });
        }

        return { type: 'paragraph', content };
      }

      if (text.trim()) {
        return { type: 'text', text };
      }
      return null;
    }

    let content = await Promise.all(
      Array.from(element.childNodes).map(convertElementToTiptap)
    );
    content = content.filter(Boolean);

    switch (element.tagName) {
      case 'P': {
        // Handle block math
        const blockMathPattern = /^\$\$([^$]+)\$\$$/;
        const blockMathMatch = element.textContent.match(blockMathPattern);
        if (blockMathMatch) {
          const mathContent = blockMathMatch[1].trim();
          return {
            type: 'mathBlock',
            attrs: {
              content: mathContent,
              macros: '{\\f: "#1f(#2)"}',
              init: 'true',
            },
          };
        }
        return { type: 'paragraph', content };
      }
      case 'H1':
        return { type: 'heading', attrs: { level: 1 }, content };
      case 'H2':
        return { type: 'heading', attrs: { level: 2 }, content };
      case 'H3':
        return { type: 'heading', attrs: { level: 3 }, content };
      case 'H4':
        return { type: 'heading', attrs: { level: 4 }, content };
      case 'H5':
        return { type: 'heading', attrs: { level: 5 }, content };
      case 'H6':
        return { type: 'heading', attrs: { level: 6 }, content };
      case 'DETAILS': {
        const summaryElement = element.querySelector('summary');
        const summaryContent = summaryElement
          ? await convertElementToTiptap(summaryElement)
          : null;

        const detailsContent = await Promise.all(
          Array.from(element.childNodes)
            .filter((child) => child !== summaryElement) // Exclude the <summary> node
            .map(convertElementToTiptap)
        );

        const nodes = [];
        if (summaryContent) {
          nodes.push({
            type: 'heading',
            attrs: { level: 4, open: true, collapsedContent: null },
            content: summaryContent.content,
          });
        }

        nodes.push(...detailsContent);

        return nodes;
      }
      case 'SUMMARY': {
        // This case might not be needed if SUMMARY is handled within DETAILS
        // but included here for completeness
        const summaryText = element.textContent;
        return {
          type: 'heading',
          attrs: { level: 4, open: true, collapsedContent: null },
          content: [{ type: 'text', text: summaryText }],
        };
      }
      case 'UL': {
        const isTaskList = Array.from(element.childNodes).some(
          (child) =>
            child.nodeType === Node.ELEMENT_NODE &&
            child.querySelector('input[type="checkbox"]')
        );
        if (isTaskList) {
          return {
            type: 'taskList',
            content: await Promise.all(
              Array.from(element.childNodes)
                .filter((child) => child.tagName === 'LI')
                .map(async (li) => {
                  const checkbox = li.querySelector('input[type="checkbox"]');
                  const checked = checkbox ? checkbox.checked : false;
                  return {
                    type: 'taskItem',
                    attrs: { checked },
                    content: [
                      {
                        type: 'paragraph',
                        content: (
                          await Promise.all(
                            Array.from(li.childNodes).map(
                              convertElementToTiptap
                            )
                          )
                        ).filter(Boolean),
                      },
                    ],
                  };
                })
            ),
          };
        }
        return {
          type: 'bulletList',
          content: await Promise.all(
            Array.from(element.childNodes)
              .filter((child) => child.tagName === 'LI')
              .map(async (li) => ({
                type: 'listItem',
                content: [
                  {
                    type: 'paragraph',
                    content: (
                      await Promise.all(
                        Array.from(li.childNodes).map(convertElementToTiptap)
                      )
                    ).filter(Boolean),
                  },
                ],
              }))
          ),
        };
      }
      case 'OL':
        return {
          type: 'orderedList',
          attrs: {
            order: parseInt(element.getAttribute('start') || '1', 10),
          },
          content: await Promise.all(
            Array.from(element.childNodes)
              .filter((child) => child.tagName === 'LI')
              .map(async (li) => ({
                type: 'listItem',
                content: [
                  {
                    type: 'paragraph',
                    content: (
                      await Promise.all(
                        Array.from(li.childNodes).map(convertElementToTiptap)
                      )
                    ).filter(Boolean),
                  },
                ],
              }))
          ),
        };
      case 'LI':
        return { type: 'listItem', content };
      case 'CODE': {
        // Handle inline code
        if (element.parentElement.tagName !== 'PRE') {
          return {
            type: 'text',
            marks: [{ type: 'code' }],
            text: element.textContent,
          };
        } else {
          // Handle code block
          const codeContent = element.textContent;
          const language = element.parentElement.getAttribute('class') || '';

          // Check if this is a Mermaid code block
          if (language.startsWith('language-mermaid')) {
            return {
              type: 'mermaidDiagram',
              attrs: {
                content: codeContent,
                init: '', // Add any initialization settings if needed
              },
            };
          }

          return {
            type: 'codeBlock',
            attrs: { language: language.replace('language-', '') },
            content: [{ type: 'text', text: codeContent }],
          };
        }
      }
      case 'PRE': {
        const codeElement = element.querySelector('code');
        if (codeElement) {
          const codeContent = codeElement.textContent;
          const language = codeElement.getAttribute('class') || '';

          // Check if this is a Mermaid code block
          if (language.startsWith('language-mermaid')) {
            return {
              type: 'mermaidDiagram',
              attrs: {
                content: codeContent,
                init: '', // Add any initialization settings if needed
              },
            };
          }

          return {
            type: 'codeBlock',
            attrs: { language: language.replace('language-', '') },
            content: [{ type: 'text', text: codeContent }],
          };
        }
        return null;
      }
      case 'BLOCKQUOTE':
        return { type: 'blockquote', content };
      case 'STRONG':
        return {
          type: 'text',
          marks: [{ type: 'bold' }],
          text: element.textContent,
        };
      case 'EM':
        return {
          type: 'text',
          marks: [{ type: 'italic' }],
          text: element.textContent,
        };
      case 'S':
        return {
          type: 'text',
          marks: [{ type: 'strike' }],
          text: element.textContent,
        };
      case 'A': {
        const href = element.getAttribute('href') || '';
        const imgElement = element.querySelector('img');

        if (imgElement) {
          return convertElementToTiptap(imgElement);
        }

        if (href.startsWith('http://') || href.startsWith('https://')) {
          return {
            type: 'text',
            marks: [
              {
                type: 'link',
                attrs: {
                  href,
                  target: '_blank',
                  rel: 'noopener noreferrer nofollow',
                },
              },
            ],
            text: element.textContent,
          };
        }

        if (href.startsWith('mailto:')) {
          return {
            type: 'text',
            marks: [
              {
                type: 'link',
                attrs: {
                  href,
                  target: '_blank',
                  rel: 'noopener noreferrer nofollow',
                  class: null,
                },
              },
            ],
            text: element.textContent,
          };
        }

        // Handle file links
        const dataDir = await storage.get('dataDir');
        const fileName = href.split('/').pop();
        const file = path.join(directoryPath, 'file-assets', fileName);
        const assetsPath = path.join(dataDir, 'file-assets', id);
        try {
          await backend.invoke('fs:copy', {
            path: file,
            dest: path.join(assetsPath, fileName),
          });
          return {
            type: 'fileEmbed',
            attrs: {
              src: `file-assets/${id}/${fileName}`,
              fileName,
            },
          };
        } catch (error) {
          console.error(`Error processing file ${fileName}:`, error);
          return null;
        }
      }
      case 'HR':
        return {
          type: 'horizontalRule',
        };
      case 'SUP':
        return {
          type: 'text',
          marks: [{ type: 'superscript' }],
          text: element.textContent,
        };
      case 'SUB':
        return {
          type: 'text',
          marks: [{ type: 'subscript' }],
          text: element.textContent,
        };
      case 'IFRAME':
        return createMediaFallbackNode(
          'iframe',
          { src: element.getAttribute('src') },
          element.parentElement?.tagName?.toLowerCase()
        );
      case 'VIDEO': {
        const src =
          element.getAttribute('src') ||
          element.querySelector('source')?.getAttribute('src') ||
          '';

        // Check if the src starts with http or https
        if (src.startsWith('http://') || src.startsWith('https://')) {
          const safeSrc = sanitizeMediaSource(src);
          return safeSrc
            ? {
                type: 'Video',
                attrs: {
                  src: safeSrc,
                  fileName: null,
                },
              }
            : createMediaFallbackNode('video', { src });
        }

        // Handle local file sources
        const dataDir = await storage.get('dataDir');
        const fileName = src.split('/').pop();
        const file = path.join(directoryPath, 'file-assets', fileName);
        const assetsPath = path.join(dataDir, 'file-assets', id);

        try {
          await backend.invoke('fs:copy', {
            path: file,
            dest: path.join(assetsPath, fileName),
          });
          return {
            type: 'Video',
            attrs: {
              src: `file-assets://${id}/${fileName}`,
              fileName: null,
            },
          };
        } catch (error) {
          console.error(`Error processing file ${fileName}:`, error);
          return null;
        }
      }
      case 'AUDIO': {
        const src =
          element.getAttribute('src') ||
          element.querySelector('source')?.getAttribute('src') ||
          '';

        // Check if the src starts with http or https
        if (src.startsWith('http://') || src.startsWith('https://')) {
          const safeSrc = sanitizeMediaSource(src);
          return safeSrc
            ? {
                type: 'Audio',
                attrs: {
                  src: safeSrc,
                  fileName: null,
                },
              }
            : createMediaFallbackNode('audio', { src });
        }

        const dataDir = await storage.get('dataDir');
        const fileName = src.split('/').pop();
        const file = path.join(directoryPath, 'file-assets', fileName);
        const assetsPath = path.join(dataDir, 'file-assets', id);

        try {
          await backend.invoke('fs:copy', {
            path: file,
            dest: path.join(assetsPath, fileName),
          });
          return {
            type: 'Audio',
            attrs: {
              src: `file-assets://${id}/${fileName}`,
              fileName: null,
            },
          };
        } catch (error) {
          console.error(`Error processing file ${fileName}:`, error);
          return null;
        }
      }
      case 'IMG': {
        const src = element.getAttribute('src') || '';
        const alt = element.getAttribute('alt') || '';

        // Check if the image src is an HTTP or HTTPS URL
        if (src.startsWith('http://') || src.startsWith('https://')) {
          const safeSrc = sanitizeImageSource(src);
          return safeSrc
            ? {
                type: 'image',
                attrs: {
                  src: safeSrc,
                  alt,
                },
              }
            : createMediaFallbackNode('image', { src, alt });
        }

        // Proceed with local file handling for non-HTTP URLs
        const dataDir = await storage.get('dataDir');
        const filename = src.split('/').pop();
        const file = path.join(directoryPath, 'notes-assets', filename);
        const assetsPath = path.join(dataDir, 'notes-assets', id);
        try {
          await backend.invoke('fs:copy', {
            path: file,
            dest: path.join(assetsPath, filename),
          });
          return {
            type: 'image',
            attrs: {
              src: `assets://${id}/${filename}`,
              alt,
            },
          };
        } catch (error) {
          console.error(`Error processing image ${filename}:`, error);
          return null;
        }
      }
      case 'TABLE':
        return {
          type: 'table',
          content: (
            await Promise.all(
              Array.from(element.querySelectorAll('tr')).map(
                async (row, rowIndex) => {
                  const isHeaderRow = rowIndex === 0;
                  return {
                    type: 'tableRow',
                    content: (
                      await Promise.all(
                        Array.from(row.cells).map(async (cell) => {
                          const cellType = isHeaderRow
                            ? 'tableHeader'
                            : 'tableCell';
                          return {
                            type: cellType,
                            attrs: {
                              colspan: cell.colSpan || 1,
                              rowspan: cell.rowSpan || 1,
                            },
                            content: [
                              {
                                type: 'paragraph',
                                content: (
                                  await Promise.all(
                                    Array.from(cell.childNodes).map(
                                      convertElementToTiptap
                                    )
                                  )
                                ).filter(Boolean),
                              },
                            ],
                          };
                        })
                      )
                    ).filter(Boolean),
                  };
                }
              )
            )
          ).filter(Boolean),
        };
      case 'FOOTNOTE': {
        // Skip footnote elements as they are already processed
        return null;
      }
      default:
        return null;
    }
  };

  const bodyContent = await Promise.all(
    Array.from(doc.body.childNodes).map(convertElementToTiptap)
  );

  // Extract and remove the H1 title if present
  let title = '';
  if (
    bodyContent.length > 0 &&
    bodyContent[0].type === 'heading' &&
    bodyContent[0].attrs.level === 1
  ) {
    title = bodyContent
      .shift()
      .content.map((node) => node.text)
      .join('');
  }

  // Flatten the array of nodes in case of nested arrays
  const flattenedBodyContent = bodyContent.flat().filter(Boolean);

  json.content = [...flattenedBodyContent];

  if (footnoteDefinitions.length > 0) {
    json.content.push({
      type: 'footnotes',
      attrs: { class: 'footnotes' },
      content: footnoteDefinitions,
    });
  }
  return { title, content: json };
};
