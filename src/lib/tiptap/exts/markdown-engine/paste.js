import { Extension } from '@tiptap/core';
import { getSchema } from '@tiptap/core';
import { Plugin, PluginKey } from 'prosemirror-state';
import { DOMParser as ProseMirrorDOMParser } from 'prosemirror-model';
import { ySyncPluginKey } from '@tiptap/y-tiptap';
import MarkdownIt from 'markdown-it';
import { extensions, CollapseHeading, heading } from '@/lib/tiptap';
import { sanitizeImportedHtml } from '@/utils/note/contentSecurity.js';
import { isImageOnlyHtml } from './image-only-html';

// Pastes larger than this stream in chunks instead of converting one huge
// document synchronously (see streamInsertMarkdown below).
const PASTE_STREAM_THRESHOLD = 40_000;
const PASTE_CHUNK_TARGET = 24_000;
// Large HTML pastes (web pages, exports) stream by top-level blocks: convert
// once, insert in batches, yield between batches so input/render stay alive.
const HTML_STREAM_BLOCK_THRESHOLD = 150;
const HTML_STREAM_BATCH = 150;

// Task: generateJSON rebuilt the schema (and a fresh DOM parser) on every
// call — including once per markdown chunk. Build the paste schema and
// parser once and reuse them; output is identical (same extensions, same
// prosemirror parser). Lazy init: this module loads during '@/lib/tiptap'’s
// own evaluation (markdown-engine cycle), so the schema is built on first
// use, after the extension list is fully initialized.
let pasteParser = null;

function ensurePasteParser() {
  if (!pasteParser) {
    pasteParser = ProseMirrorDOMParser.fromSchema(
      getSchema([...extensions, CollapseHeading, heading]),
    );
  }
  return pasteParser;
}

function htmlToJSON(html) {
  const dom = new window.DOMParser().parseFromString(html, 'text/html');
  return ensurePasteParser().parse(dom).toJSON();
}

/**
 * One undo step for a streamed paste: the UndoManager groups consecutive
 * transactions within its captureTimeout, so a stopCapturing() before the
 * first insert makes the whole paste a single undoable entry, separate from
 * the user's prior typing.
 */
function stopUndoCapture(editor) {
  try {
    editor.extensionStorage?.yUndo?.undoManager?.stopCapturing();
  } catch {
    // Undo exposure is best-effort; pasting must never fail because of it.
  }
}

/**
 * Split markdown into conversion chunks at blank lines, never inside a code
 * fence. Fenced code blocks may contain blank lines, so fence state is tracked
 * line by line; everything else splits on the first blank line after the
 * target size. Loose lists that span a blank line become two adjacent lists —
 * visually identical in the editor.
 */
function splitMarkdownChunks(text, targetSize) {
  const chunks = [];
  let current = [];
  let currentLength = 0;
  let fence = null;
  for (const line of text.split('\n')) {
    const fenceMatch = /^\s*(`{3,}|~{3,})/.exec(line);
    if (fenceMatch) {
      if (!fence) fence = fenceMatch[1][0].repeat(fenceMatch[1].length);
      else if (line.trim().startsWith(fence)) fence = null;
    }
    current.push(line);
    currentLength += line.length + 1;
    if (!fence && line.trim() === '' && currentLength >= targetSize) {
      chunks.push(current.join('\n'));
      current = [];
      currentLength = 0;
    }
  }
  if (current.length) chunks.push(current.join('\n'));
  return chunks.filter((chunk) => chunk.trim().length > 0);
}

/**
 * Convert + insert markdown chunk by chunk, yielding to the event loop
 * between chunks so input, scrolling and the persistence flush stay alive
 * during multi-second pastes.
 */
async function streamInsertMarkdown(editor, md, normalizedText) {
  const chunks = splitMarkdownChunks(normalizedText, PASTE_CHUNK_TARGET);
  stopUndoCapture(editor);
  for (let i = 0; i < chunks.length; i++) {
    const parsedHtml = md.render(chunks[i]);
    const json = htmlToJSON(parsedHtml);
    if (i === 0) {
      const unwrapped =
        json.type === 'doc' && json.content?.length === 1 && json.content[0].type === 'paragraph'
          ? json.content[0].content || []
          : json;
      editor.commands.insertContent(unwrapped);
    } else {
      editor.commands.insertContent(json);
    }
    // Yield: lets input events, the persistence timer and rendering run.
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

/**
 * Stream a large converted HTML document by top-level blocks: one
 * insertContentAt per batch with a yield between batches, mirroring
 * streamInsertMarkdown. The whole paste stays one undo step via
 * stopUndoCapture (UndoManager captureTimeout groups the batches).
 *
 * Selection drift: the user can type or click between batches, so each batch
 * after the first is inserted at a Yjs relative position captured at the
 * paste start and re-anchored at the end of the previously inserted batch —
 * mapped through whatever the user did in between. Without this, batch two
 * lands wherever the cursor drifted to.
 */
function getYjsBinding(editor) {
  try {
    // ySyncPluginKey state wraps the ProsemirrorBinding: { type, doc, binding }
    // — the binding carries the pm↔y mapping the position helpers need.
    const state = ySyncPluginKey.getState(editor.state);
    const binding = state?.binding;
    if (!binding?.type || !binding.doc || !binding.mapping) return null;
    return binding;
  } catch {
    return null;
  }
}

export async function streamInsertHtml(editor, json) {
  const blocks = json.content || [];
  stopUndoCapture(editor);
  const binding = getYjsBinding(editor);
  const { absolutePositionToRelativePosition, relativePositionToAbsolutePosition } =
    await import('@tiptap/y-tiptap');

  let relCursor = null;
  if (binding) {
    try {
      relCursor = absolutePositionToRelativePosition(
        editor.state.selection.from,
        binding.type,
        binding.mapping,
      );
    } catch {
      relCursor = null;
    }
  }

  for (let i = 0; i < blocks.length; i += HTML_STREAM_BATCH) {
    const batch = blocks.slice(i, i + HTML_STREAM_BATCH);
    if (relCursor && binding) {
      const pos = relativePositionToAbsolutePosition(
        binding.doc,
        binding.type,
        relCursor,
        binding.mapping,
      );
      if (pos === null) {
        // The anchor was deleted or moved out of the fragment (user wiped the
        // region mid-paste): fall back to the current selection.
        editor.commands.insertContent(batch);
      } else {
        editor.commands.insertContentAt(pos, batch, { updateSelection: true });
      }
    } else {
      editor.commands.insertContent(batch);
    }
    // Re-anchor at the end of the inserted batch (insertContentAt moves the
    // selection there), so the next batch appends after this one.
    if (binding) {
      try {
        relCursor = absolutePositionToRelativePosition(
          editor.state.selection.to,
          binding.type,
          binding.mapping,
        );
      } catch {
        relCursor = null;
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

export const Paste = Extension.create({
  name: 'paste',
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey('Paste'),
        props: {
          handleDOMEvents: {
            paste: (view, event) => {
              const { editor } = this;
              if (!editor) return false;

              const clipboardData = event.clipboardData;
              if (!clipboardData) return false;

              const html = clipboardData.getData('text/html');
              const text = clipboardData.getData('text/plain');

              const { state } = view;
              const { $from } = state.selection;
              const isInCodeBlock = $from.parent.type.name === 'codeBlock';

              if (isInCodeBlock && text) {
                event.preventDefault();
                editor.commands.insertContent(text);
                return true;
              }

              const insertIntelligently = (json) => {
                if (
                  json.type === 'doc' &&
                  json.content?.length === 1 &&
                  json.content[0].type === 'paragraph'
                ) {
                  return editor.commands.insertContent(
                    json.content[0].content || []
                  );
                }
                return editor.commands.insertContent(json);
              };

              if (html) {
                // "Copy image" (Chrome) places both image/png and text/html
                // (<img src=…>) on the clipboard: defer to the image plugin so
                // the bytes are stored as an asset instead of a remote
                // hotlink. Wrapped-img copies (<p><img>, a lone wrapper div,
                // stray <br>/comments/&nbsp;) defer too — one <img> anywhere
                // and no real text. But mixed desktop-app copies (Excel "Copy
                // as Picture", PowerPoint, LibreOffice) carry real text around
                // the image, and dropping it here would lose the text — keep
                // the HTML path for those.
                if (
                  clipboardData.files?.length === 1 &&
                  clipboardData.files[0].type.startsWith('image/')
                ) {
                  if (isImageOnlyHtml(html)) return false;
                }
                event.preventDefault();
                const doc = sanitizeImportedHtml(html);
                const container = doc.body;

                container.querySelectorAll('a').forEach((link) => {
                  link.querySelectorAll('span').forEach((span) => {
                    const textNode = document.createTextNode(
                      span.textContent || ''
                    );
                    span.parentNode.replaceChild(textNode, span);
                    for (const attr of span.attributes) {
                      if (attr.name.startsWith('data-')) {
                        link.setAttribute(
                          attr.name,
                          attr.value.replace(/&nbsp;/g, ' ')
                        );
                      }
                    }
                  });
                });

                container.innerHTML = container.innerHTML.replace(
                  /&nbsp;/g,
                  ' '
                );

                try {
                  // Parse the sanitized container directly through the cached
                  // paste parser (no serialize/reparse, no schema rebuild).
                  const json = ensurePasteParser().parse(container).toJSON();
                  if (
                    json.type === 'doc' &&
                    (json.content?.length || 0) > HTML_STREAM_BLOCK_THRESHOLD
                  ) {
                    // Fire-and-forget: the handler stays synchronous (PM treats
                    // any truthy return as handled); preventDefault already ran.
                    void streamInsertHtml(editor, json);
                  } else {
                    insertIntelligently(json);
                  }
                } catch (error) {
                  console.error('Error generating JSON from HTML:', error);
                  return false;
                }
                return true;
              }

              // 3. Handle Plain Text / Markdown Paste
              if (text) {
                event.preventDefault();
                try {
                  // FIX: Removed the .replace(/\n/g, '  \n') which was forcing hard breaks
                  const md = new MarkdownIt({ breaks: true });
                  const normalizedText = text.replace(/\r\n?/g, '\n');

                  // Large pastes are streamed: converting one multi-megabyte
                  // document synchronously blocked the main thread for seconds
                  // (and starved the persistence flush behind it). Splitting at
                  // blank lines outside code fences keeps every structure
                  // intact, and a yield between chunks keeps typing and input
                  // responsive while the rest streams in.
                  if (normalizedText.length > PASTE_STREAM_THRESHOLD) {
                    void streamInsertMarkdown(editor, md, normalizedText);
                    return true;
                  }

                  const parsedHtml = md.render(normalizedText);
                  const json = generateJSON(parsedHtml, [
                    ...extensions,
                    CollapseHeading,
                    heading,
                  ]);

                  insertIntelligently(json);
                } catch (error) {
                  console.error('Error processing markdown:', error);
                  return false;
                }
                return true;
              }

              return false;
            },
          },
        },
      }),
    ];
  },
});
