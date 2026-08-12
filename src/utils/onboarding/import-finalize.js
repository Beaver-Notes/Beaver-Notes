/**
 * Post-import finalization shared by the Electron legacy migration and the
 * generic importers. Both sub-steps are non-fatal safety nets — callers wrap
 * them in try/catch and continue if they fail. Heavy dependencies (search,
 * link index, security) stay lazy via dynamic imports so they never enter the
 * onboarding chunk until a migration actually runs.
 */

export async function buildImportedSearchIndex() {
  const { useStorage } = await import('@/lib/storage');
  const { buildSearchIndex, getSearchIndexJSON } = await import(
    '@/utils/note/search.js'
  );
  const {
    rebuildLinkIndexFromAll,
    getLinkIndexJSON,
  } = await import('@/store/note/backlinks.ts');
  const { commands } = await import('@/lib/tauri/bindings');

  const kvNotes = await useStorage('data').get('notes', {});
  buildSearchIndex(kvNotes);
  rebuildLinkIndexFromAll(kvNotes);

  const signatures = {};
  for (const n of Object.values(kvNotes)) {
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
