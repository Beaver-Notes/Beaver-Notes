import { getActiveDoc } from '@/lib/yjs/shared.js';
import * as Y from 'yjs';

let _yXmlToJsonPromise = null;
async function yXmlFragmentToProsemirrorJSON(xmlFragment) {
  if (!_yXmlToJsonPromise) {
    _yXmlToJsonPromise = import('@tiptap/y-tiptap');
  }
  const mod = await _yXmlToJsonPromise;
  return mod.yXmlFragmentToProsemirrorJSON(xmlFragment);
}

let _tiptapPromise = null;
async function getGenerateHTML() {
  if (!_tiptapPromise) {
    _tiptapPromise = Promise.all([
      import('@tiptap/core'),
      import('@/lib/tiptap'),
    ]);
  }
  const [{ generateHTML }, { extensions }] = await _tiptapPromise;
  return (json) => generateHTML(json, extensions);
}

/** Capture a note's content/title as HTML from the active Yjs doc; null if unloaded or empty. */
export async function captureNoteSnapshot(noteId) {
  const doc = getActiveDoc(noteId);
  if (!doc) return null;
  return snapshotFromDoc(doc);
}

/** Capture from cached full-state bytes (background notes with no active doc). */
export async function captureNoteSnapshotFromBytes(noteId, updateBytes) {
  if (!updateBytes || updateBytes.length === 0) return null;
  const doc = new Y.Doc();
  try {
    Y.applyUpdate(doc, updateBytes instanceof Uint8Array ? updateBytes : new Uint8Array(updateBytes));
    return await snapshotFromDoc(doc);
  } catch {
    return null;
  } finally {
    doc.destroy();
  }
}

async function snapshotFromDoc(doc) {
  try {
    const contentFrag = doc.getXmlFragment('content');

    let content = '';
    if (contentFrag.length > 0) {
      const json = await yXmlFragmentToProsemirrorJSON(contentFrag);
      if (json?.content?.length > 0) {
        const generateHTML = await getGenerateHTML();
        content = generateHTML(json);
      }
    }

    // Title-first as Y.Text (useNoteYjs stores it so): whichever accessor runs
    // first binds unintegrated update items, so Text must win over XmlFragment.
    let title = '';
    try {
      const ytext = doc.getText('title');
      title = ytext.toString() || '';
    } catch {}
    if (!title) {
      try {
        const titleFrag = doc.getXmlFragment('title');
        if (titleFrag.length > 0) {
          // Title fragment holds XmlText nodes: extract plain text.
          const json = await yXmlFragmentToProsemirrorJSON(titleFrag);
          if (json?.content) {
            // Structure: { content: [[{ type: 'text', text: '...' }, ...], ...] }
            title = json.content
              .flat()
              .filter((node) => node.type === 'text')
              .map((node) => node.text || '')
              .join('');
          }
        }
      } catch {}
    }

    if (!content && !title) return null;
    return { content, title };
  } catch (err) {
    console.warn('[commit-snapshot] failed to capture:', err?.message);
    return null;
  }
}
