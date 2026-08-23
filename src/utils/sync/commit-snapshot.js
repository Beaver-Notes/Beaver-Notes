import { getActiveDoc } from '@/lib/yjs/shared.js';

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

/**
 * Capture a note's current content as an HTML snapshot from the active Yjs doc.
 * Returns null if the doc is not loaded or empty.
 * @param {string} noteId
 * @returns {Promise<{ content: string, title: string } | null>}
 */
export async function captureNoteSnapshot(noteId) {
  const doc = getActiveDoc(noteId);
  if (!doc) return null;

  try {
    const contentFrag = doc.getXmlFragment('content');
    const titleFrag = doc.getXmlFragment('title');

    let content = '';
    if (contentFrag.length > 0) {
      const json = await yXmlFragmentToProsemirrorJSON(contentFrag);
      if (json?.content?.length > 0) {
        const generateHTML = await getGenerateHTML();
        content = generateHTML(json);
      }
    }

    let title = '';
    if (titleFrag.length > 0) {
      // Title XmlFragment contains XmlText nodes — extract plain text
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

    if (!content && !title) return null;
    return { content, title };
  } catch (err) {
    console.warn('[commit-snapshot] failed to capture:', err?.message);
    return null;
  }
}
