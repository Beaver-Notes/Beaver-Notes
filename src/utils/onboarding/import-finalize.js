/**
 * Post-import finalization shared by the Electron legacy migration and the
 * generic importers. Both sub-steps are non-fatal safety nets — callers wrap
 * them in try/catch and continue if they fail. Heavy dependencies (search,
 * link index, security) stay lazy via dynamic imports so they never enter the
 * onboarding chunk until a migration actually runs.
 */

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
