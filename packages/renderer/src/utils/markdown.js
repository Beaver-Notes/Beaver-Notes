import { ref } from 'vue';
import { useNoteStore } from '@/store/note';
import { marked } from 'marked';
import { v4 as uuidv4 } from 'uuid';
import { useStorage } from '@/composable/storage';

const storage = useStorage('settings');
const { path, ipcRenderer } = window.electron;

const notes = ref([]);
const labels = ref('');
const isBookmarked = ref(false);
const isArchived = ref(false);

const readMarkdownFile = async (filePath) => {
  try {
    const markdown = await ipcRenderer.callMain('fs:readFile', filePath);
    return markdown;
  } catch (error) {
    console.error(`Error reading file ${filePath}:`, error);
    throw error;
  }
};

const convertMarkdownToTiptap = async (markdown, id, directoryPath) => {
  const html = marked(markdown);
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
                  const checked = checkbox.checked;
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
        const href = element.getAttribute('href');
        const imgElement = element.querySelector('img');
        const isYouTube =
          href.includes('youtube.com') || href.includes('youtu.be');

        if (imgElement) {
          const src = imgElement.getAttribute('src');
          if (src.includes('img.youtube.com')) {
            const videoId = href.split('watch?v=')[1];
            const embedUrl = `https://www.youtube.com/embed/${videoId}`;
            return {
              type: 'iframe',
              attrs: {
                src: embedUrl,
                frameborder: 0,
                allowfullscreen: true,
              },
            };
          }
        }

        if (isYouTube) {
          const videoId =
            href.split('v=')[1]?.split('&')[0] || href.split('/').pop();
          const embedUrl = `https://www.youtube.com/embed/${videoId}`;
          return {
            type: 'iframe',
            attrs: {
              src: embedUrl,
              frameborder: 0,
              allowfullscreen: true,
            },
          };
        }

        if (href.startsWith('http://') || href.startsWith('https://')) {
          return {
            type: 'text',
            marks: [{ type: 'link', attrs: { href } }],
            text: element.textContent,
          };
        } else {
          // Handle file links
          const dataDir = await storage.get('dataDir');
          const fileName = href.split('/').pop();
          const file = path.join(directoryPath, 'file-assets', fileName);
          const assetsPath = path.join(dataDir, 'file-assets', id);
          try {
            await ipcRenderer.callMain('fs:copy', {
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
      }
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
      case 'IFRAME': {
        const src = element.getAttribute('src');
        return {
          type: 'iframe',
          attrs: {
            src,
            frameborder: element.getAttribute('frameborder') || 0,
            allowfullscreen: element.hasAttribute('allowfullscreen'),
          },
        };
      }
      case 'VIDEO': {
        const src = element.querySelector('source')?.getAttribute('src');
        if (src) {
          return {
            type: 'iframe',
            attrs: {
              src,
              frameborder: 0,
              allowfullscreen: false,
            },
          };
        }
        return null;
      }
      case 'AUDIO': {
        const src = element.querySelector('source')?.getAttribute('src');
        if (src) {
          return {
            type: 'iframe',
            attrs: {
              src,
              frameborder: 0,
              allowfullscreen: false,
            },
          };
        }
        return null;
      }
      case 'IMG': {
        const src = element.getAttribute('src');
        const alt = element.getAttribute('alt');

        // Check if the image src is an HTTP or HTTPS URL
        if (src.startsWith('http://') || src.startsWith('https://')) {
          // If it is, simply return the src without copying the image
          return {
            type: 'image',
            attrs: {
              src,
              alt,
            },
          };
        }

        // Proceed with local file handling for non-HTTP URLs
        const dataDir = await storage.get('dataDir');
        const filename = src.split('/').pop();
        const file = path.join(directoryPath, 'notes-assets', filename);
        const assetsPath = path.join(dataDir, 'notes-assets', id);
        try {
          await ipcRenderer.callMain('fs:copy', {
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
              Array.from(element.querySelectorAll('tr')).map(async (row) => ({
                type: 'tableRow',
                content: (
                  await Promise.all(
                    Array.from(row.cells).map(async (cell) => ({
                      type: 'tableCell',
                      content: (
                        await Promise.all(
                          Array.from(cell.childNodes).map(
                            convertElementToTiptap
                          )
                        )
                      ).filter(Boolean),
                    }))
                  )
                ).filter(Boolean),
              }))
            )
          ).filter(Boolean),
        };
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

  // Filter out null values
  const filteredBodyContent = bodyContent.filter(Boolean);

  json.content = [...filteredBodyContent];

  return { title, content: json };
};

export const processDirectory = async (directoryPath) => {
  notes.value = [];
  const noteStore = useNoteStore();

  try {
    const files = await ipcRenderer.callMain('fs:readdir', directoryPath);

    for (const fileName of files) {
      if (fileName === '.DS_Store') {
        console.log(`Skipping .DS_Store file`);
        continue; // Skip processing .DS_Store file
      }

      const filePath = path.join(directoryPath, fileName);

      if (fileName.toLowerCase().endsWith('.md')) {
        const markdown = await readMarkdownFile(filePath);
        console.log('Markdown:', markdown);

        const id = uuidv4();
        const { title, content } = await convertMarkdownToTiptap(
          markdown,
          id,
          directoryPath
        );

        // Automatically add notes
        const labelArray = labels.value.split(',').map((label) => label.trim());
        const newNote = {
          id,
          title: title || fileName.replace('.md', ''),
          content,
          labels: labelArray,
          isBookmarked: isBookmarked.value,
          isArchived: isArchived.value,
        };

        try {
          await noteStore.add(newNote);
          console.log('Note added:', newNote);
        } catch (error) {
          console.error('Error adding note to store:', error);
        }

        notes.value.push(newNote);
      } else {
        console.log(`Skipping file: ${filePath}`);
      }
    }
  } catch (error) {
    console.error('Error listing directory:', error);
  }
};
