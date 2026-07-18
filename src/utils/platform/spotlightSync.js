import { getSettingSync } from '@/composable/settings';
import { indexItems, deleteItems, deleteDomain } from '@/lib/native/spotsearch';

const DOMAIN = 'notes';

export function isSpotlightEnabled() {
  return getSettingSync('spotlightEnabled');
}

function buildSpotItem(note) {
  if (!note || !note.id) return null;

  const snippet = (note.searchText || note.cardPreview || '').substring(0, 300);

  return {
    id: note.id,
    domain: DOMAIN,
    title: note.title || 'Untitled',
    snippet,
    keywords: note.labels || [],
  };
}

export function indexNoteForSpotlight(note) {
  if (!isSpotlightEnabled()) return;
  if (!note) return;
  if (note.isLocked) {
    deleteNoteFromSpotlight(note.id);
    return;
  }

  const item = buildSpotItem(note);
  if (!item) return;

  indexItems([item]).catch((err) => {
    console.error('[spotlight] failed to index note:', note.id, err);
  });
}

export function deleteNoteFromSpotlight(id) {
  if (!isSpotlightEnabled()) return;
  if (!id) return;

  deleteItems([id]).catch((err) => {
    console.error('[spotlight] failed to remove note:', id, err);
  });
}

export function bulkDeleteFromSpotlight(ids) {
  if (!isSpotlightEnabled()) return;
  if (!ids || ids.length === 0) return;

  deleteItems(ids).catch((err) => {
    console.error('[spotlight] failed to bulk remove notes:', err);
  });
}

export async function reindexAllNotes(notes, force = false) {
  if (!force && !isSpotlightEnabled()) return;

  const allNotes = Object.values(notes);
  const eligible = allNotes.filter(
    (n) => n && n.id && !n.isLocked && !n.decryptionError
  );

  try {
    await deleteDomain(DOMAIN);
  } catch (err) {
    console.error('[spotlight] failed to clear domain:', err);
  }

  const items = eligible.map(buildSpotItem).filter(Boolean);

  if (items.length > 0) {
    try {
      await indexItems(items);
    } catch (err) {
      console.error('[spotlight] failed to reindex notes:', err);
    }
  }
}
