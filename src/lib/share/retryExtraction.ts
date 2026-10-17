// src/lib/share/retryExtraction.ts
import { useNoteStore } from '@/store/note';
import type { NoteData } from '@/store/note/index';
import { extractFromUrl, extractedToNote } from './extractContent';
import { htmlToTiptap } from './htmlToTiptap';

// Brief-vs-reality: NoteData (src/store/note/index.ts) has no
// pendingExtraction field and Task 8's saveAll never sets one — the offline
// URL is preserved in the note body instead. add/update accept
// Record<string, any> and hydrateNote spreads unknown fields through, so a
// note CAN carry an optional pendingExtraction URL in-memory; type it here so
// vue-tsc passes without touching the shared NoteData interface.
type PendingNote = NoteData & { pendingExtraction?: string | null };

// Pure flag check shared by the launch retry, the store action and the card chip.
export function hasPendingExtraction(note: NoteData | null | undefined): boolean {
  if (!note || typeof note !== 'object') return false;
  const url = (note as PendingNote).pendingExtraction;
  return typeof url === 'string' && url.length > 0;
}

function isPending(note: NoteData): note is PendingNote & { pendingExtraction: string } {
  return hasPendingExtraction(note);
}

// Retry rewrites the whole note body (new-note semantics), so it takes the
// importer path; legacy htmlToTiptap only when Defuddle found no markdown.
async function extractedToContent(url: string): Promise<{ title: string; content: any }> {
  const extracted = await extractFromUrl(url);
  if (extracted.markdown) return extractedToNote(extracted, url);
  return { title: extracted.title, content: htmlToTiptap(extracted.contentHtml) };
}

// Single-note retry for the card chip (store action delegates here so the
// launch loop and manual retry share one implementation). Notifies on both
// outcomes; failure keeps the flag so the chip stays.
export async function retrySingleExtraction(noteId: string): Promise<boolean> {
  const noteStore = useNoteStore();
  const note = noteStore.data[noteId] as PendingNote | undefined;
  const url = note && typeof note.pendingExtraction === 'string' ? note.pendingExtraction : '';
  if (!note || !url) return false;
  const { notify } = await import('@/lib/native/app');
  const announce = (title: string, body: string) => notify({ title, body }).catch(() => {});
  try {
    const extracted = await extractedToContent(url);
    const { writeNoteContentToYjs } = await import('@/utils/note/contentToYjs.js');
    await writeNoteContentToYjs(noteId, extracted.content);
    await noteStore.update(noteId, {
      title: note.title || extracted.title,
      content: extracted.content,
      pendingExtraction: null,
    });
    await announce('Extraction complete', note.title || extracted.title || 'Beaver Notes');
    return true;
  } catch {
    // still offline — keep the flag, chip stays
    await announce('Still offline — will retry', 'Tap the note card chip to try again');
    return false;
  }
}

export async function retryPendingExtractions(): Promise<void> {
  const noteStore = useNoteStore();
  const pending = Object.values(noteStore.data).filter(isPending);
  for (const note of pending) {
    try {
      const extracted = await extractedToContent(note.pendingExtraction);
      // Brief-vs-reality: note content lives in per-note Yjs docs and
      // update() only touches in-memory state + meta + search index — the
      // editor binds the Yjs doc, so write there too (same util add() uses).
      const { writeNoteContentToYjs } = await import('@/utils/note/contentToYjs.js');
      await writeNoteContentToYjs(note.id, extracted.content);
      await noteStore.update(note.id, {
        title: note.title || extracted.title,
        content: extracted.content,
        pendingExtraction: null,
      });
    } catch {
      // still offline — keep the flag, try again next launch
    }
  }
}
