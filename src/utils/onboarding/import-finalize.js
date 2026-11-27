/** Post-import finalization for legacy and generic importers. Non-fatal safety nets, lazy deps stay out of onboarding chunk. */

export async function buildImportedSearchIndex(notesOverride) {
  const { useNoteStore } = await import('@/store/note');
  const { buildSearchIndex, getSearchIndexJSON } = await import(
    '@/utils/note/search.js'
  );
  const {
    rebuildLinkIndexFromAll,
    getLinkIndexJSON,
  } = await import('@/store/note/backlinks.ts');
  const { commands } = await import('@/lib/tauri/bindings');

  // Source from the caller-provided notes (frontend-led import) or the
  // in-memory note store; never read KV, which no longer holds note content.
  const notes =
    notesOverride ||
    Object.fromEntries(
      Object.entries(useNoteStore().data).filter(([id, n]) => n?.id === id)
    );
  buildSearchIndex(notes);
  rebuildLinkIndexFromAll(notes);

  const signatures = {};
  for (const n of Object.values(notes)) {
    if (n?.id) signatures[n.id] = n.updatedAt;
  }
  await commands.indexSave(
    getSearchIndexJSON(),
    getLinkIndexJSON(),
    JSON.stringify(signatures)
  );
}

export async function secureImportedAssets() {
  const { migrateAssetEncryption } = await import('@/lib/native/security.js');
  await migrateAssetEncryption();
}
