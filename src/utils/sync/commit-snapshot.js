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

/** Capture a note's content/title as HTML from the active Yjs doc; null if unloaded or empty. */
export async function captureNoteSnapshot(noteId) {
  const doc = getActiveDoc(noteId);
  if (!doc) return null;

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

    let title = '';
    try {
      const titleFrag = doc.getXmlFragment('title');
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
      } else {
        try {
          const ytext = doc.getText('title');
          title = ytext.toString() || '';
        } catch {}
      }
    } catch {
      try {
        const ytext = doc.getText('title');
        title = ytext.toString() || '';
      } catch {}
    }

    if (!content && !title) return null;
    return { content, title };
  } catch (err) {
    console.warn('[commit-snapshot] failed to capture:', err?.message);
    return null;
  }
}
