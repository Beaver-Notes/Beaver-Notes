import { getSettingSync } from '@/composable/settings';
import { indexItems, deleteItems, deleteDomain } from '@/lib/native/spotsearch';

const DOMAIN = 'notes';
const LOG_PREFIX = '[spotlight]';

function log(...args) {
  console.log(LOG_PREFIX, ...args);
}

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
    log('note locked, removing from index:', note.id);
    deleteNoteFromSpotlight(note.id);
    return;
  }

  const item = buildSpotItem(note);
  if (!item) return;

  log('indexing note:', note.id, `"${item.title}"`);
  indexItems([item]).catch((err) => {
    log('failed to index note:', note.id, err);
  });
}

export function deleteNoteFromSpotlight(id) {
  if (!isSpotlightEnabled()) return;
  if (!id) return;

  log('removing note from index:', id);
  deleteItems([id]).catch((err) => {
    log('failed to remove note:', id, err);
  });
}

export function bulkDeleteFromSpotlight(ids) {
  if (!isSpotlightEnabled()) return;
  if (!ids || ids.length === 0) return;

  log('removing notes from index:', ids.length);
  deleteItems(ids).catch((err) => {
    log('failed to bulk remove notes:', err);
  });
}

export async function reindexAllNotes(notes, force = false) {
  if (!force && !isSpotlightEnabled()) return;

  const allNotes = Object.values(notes);
  const eligible = allNotes.filter(
    (n) => n && n.id && !n.isLocked && !n.decryptionError
  );

  log(
    `reindexing ${eligible.length} of ${allNotes.length} notes (clearing domain first)`
  );

  try {
    await deleteDomain(DOMAIN);
  } catch (err) {
    log('failed to clear domain:', err);
  }

  const items = eligible.map(buildSpotItem).filter(Boolean);

  if (items.length > 0) {
    try {
      await indexItems(items);
    } catch (err) {
      log('failed to reindex notes:', err);
    }
  }
}
