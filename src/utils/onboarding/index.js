import { DEFAULT_UI_FONT_STACK, setSetting } from '@/composable/settings';
import { setStoredZoomLevel } from '@/composable/zoom';
import { backend } from '@/lib/tauri-bridge';
import { enableIndexing } from '@/lib/native/spotsearch';
import { reindexAllNotes } from '@/utils/platform/spotlightSync';
import { getSyncPath, setSyncPath } from '@/utils/sync/path';

// Re-export the legacy/Electron migration helpers under stable onboarding names.
export {
  getLegacyMigrationStatus as getOnboardingMigrationStatus,
  probeLegacyPath as probeCustomMigrationPath,
  runLegacyMigration as runOnboardingMigration,
  runLegacyMigrationFromPath as runOnboardingMigrationFromPath,
} from '@/utils/migration/legacyElectron';

import { ONBOARDING_LANGUAGE_CONFIG } from '@/utils/i18n/languages.js';
export { ONBOARDING_LANGUAGE_CONFIG, ONBOARDING_LANGUAGES } from '@/utils/i18n/languages.js';

export function getLanguageDirection(languageCode) {
  return ONBOARDING_LANGUAGE_CONFIG[languageCode]?.dir || 'ltr';
}

// ─── Animation timing constants ──────────────────────────────────────────────

export const ENTRANCE_DELAYS = {
  logo: 120,
  text: 580,
  cta: 1020,
};

export const CURTAIN_DURATIONS = {
  close: 1200,
  hold: 200,
  open: 1200,
};

// ─── Language / theme config data ────────────────────────────────────────────
// ONBOARDING_LANGUAGE_CONFIG and ONBOARDING_LANGUAGES are re-exported from @/utils/i18n/languages.js

export const ONBOARDING_THEMES = [
  { name: 'light', label: 'Light' },
  { name: 'dark', label: 'Dark' },
  { name: 'system', label: 'System' },
];

export const ONBOARDING_ACCENT_COLORS = [
  { name: 'red', className: 'bg-red-500' },
  { name: 'light', className: 'bg-amber-400' },
  { name: 'green', className: 'bg-emerald-500' },
  { name: 'blue', className: 'bg-blue-400' },
  { name: 'purple', className: 'bg-purple-400' },
  { name: 'pink', className: 'bg-pink-400' },
  { name: 'neutral', className: 'bg-neutral-400' },
];

const ONBOARDING_ACCENT_COLOR_NAMES = ONBOARDING_ACCENT_COLORS.map(
  ({ name }) => name
);

export const ONBOARDING_INTERFACE_SIZES = [
  { value: 1.2, key: '1.2', label: 'Large' },
  { value: 1.1, key: '1.1', label: 'Medium' },
  { value: 1.0, key: '1.0', label: 'Default' },
  { value: 0.9, key: '0.9', label: 'More Space' },
];

export const ONBOARDING_FONTS = [
  { label: 'Default', value: DEFAULT_UI_FONT_STACK, class: '' },
  { label: 'Arimo', value: 'Arimo', class: 'font-arimo' },
  { label: 'Avenir', value: 'avenir', class: 'font-avenir' },
  { label: 'EB Garamond', value: 'EB Garamond', class: 'font-eb-faramond' },
  {
    label: 'Helvetica',
    value: "'Helvetica Neue', sans-serif",
    class: 'font-helvetica',
  },
  {
    label: 'Open Dyslexic',
    value: 'OpenDyslexic',
    class: 'font-open-dyslexic',
  },
  { label: 'Roboto Mono', value: 'Roboto Mono', class: 'font-roboto-mono' },
  { label: 'Ubuntu', value: 'Ubuntu', class: 'font-ubuntu' },
];

// ─── Onboarding actions ──────────────────────────────────────────────────────

export async function applyOnboardingFreshPreferences(preferences, { theme }) {
  const languageCode = preferences.language;
  const direction = getLanguageDirection(languageCode);

  await Promise.all([
    setSetting('theme', preferences.theme),
    setSetting('selectedLanguage', languageCode),
    setSetting('directionPreference', direction),
    setSetting('colorScheme', preferences.accentColor),
    setSetting('selectedFont', preferences.selectedFont),
    setSetting('spellcheckEnabled', preferences.spellcheckEnabled),
    setSetting('openLastEdited', preferences.openLastEdited),
    setSetting('openAfterCreation', preferences.openAfterCreation),
    setSetting('soundsEnabled', preferences.soundsEnabled),
    setSetting('spotlightEnabled', preferences.spotlightEnabled),
  ]);

  if (backend.isAppleRuntime() && preferences.spotlightEnabled) {
    try {
      await enableIndexing(true);
      const { useNoteStore } = await import('@/store/note');
      const noteStore = useNoteStore();
      await reindexAllNotes(noteStore.data, true);
    } catch (e) {
      console.error('[onboarding] Failed to enable Spotlight:', e);
    }
  }

  theme.setTheme(preferences.theme, preferences.theme === 'system');
  setStoredZoomLevel(preferences.zoomLevel, { syncDocument: true });
  document.documentElement.dir = direction;
  document.documentElement.lang = languageCode;
  document.documentElement.style.setProperty(
    '--selected-font',
    preferences.selectedFont
  );

  const root = document.documentElement;
  root.classList.forEach((cls) => {
    if (ONBOARDING_ACCENT_COLOR_NAMES.includes(cls)) {
      root.classList.remove(cls);
    }
  });
  root.classList.add(preferences.accentColor);
}

export async function applyOnboardingSyncPreferences(preferences) {
  await setSyncPath(preferences.syncPath || '');
}

export async function markOnboardingCompleted(settingsStorage) {
  await settingsStorage.set('onboardingCompleted', true);
}

export async function openOnboardingWorkspace({ store, noteStore, router }) {
  await getSyncPath();

  // Derive/restore the encryption key before reading any Yjs data, mirroring
  // useAppShell's initializeWorkspace. Note blobs are encrypted at rest when
  // the vault is enabled, so decoding them without the key would feed
  // ciphertext to the Yjs decoder (which aborts on invalid UTF-8) or fail
  // closed server-side.
  const { tryRestoreKeyFromSafeStorage, encryptionIsConfigured, isKeyLoaded } =
    await import('@/utils/crypto/encryption.js');
  await tryRestoreKeyFromSafeStorage();
  if ((await encryptionIsConfigured()) && !isKeyLoaded()) {
    // Vault configured on this device but the key couldn't be restored (e.g.
    // safe storage unavailable). Defer the workspace load to the shell's
    // encryption gate, which appears right after onboarding completes and
    // re-runs the init once unlocked.
    await router.replace('/');
    return;
  }

  // Consolidate legacy asset directories (notes-assets/ + file-assets/ → assets/)
  // AFTER key restoration so encrypt_asset() can write encrypted files.
  const { consolidateAssets } = await import('@/utils/migration/consolidateAssets.js');
  await consolidateAssets();

  // Re-encrypt any assets that were written during import (Phase 4) before the
  // encryption manifest existed. consolidateAssets() only handles files in legacy
  // dirs; this covers files already in assets/ that were copied unencrypted.
  if (await encryptionIsConfigured()) {
    try {
      const { migrateAssetEncryption } = await import('@/lib/native/security.js');
      await migrateAssetEncryption();
    } catch (e) {
      console.warn('[onboarding] post-import asset re-encryption failed:', e);
    }
  }

  // Initialize the workspace Y.Doc — same sequence as useAppShell's
  // initializeWorkspace so Pinia gets hydrated from Yjs.
  const { loadWorkspaceDoc, observeWorkspace } = await import('@/composable/useWorkspaceYjs.js');
  const { writeStoresFromWorkspace } = await import('@/composable/meta-yjs-store.js');

  await loadWorkspaceDoc();
  observeWorkspace(writeStoresFromWorkspace);
  await writeStoresFromWorkspace();

  // One-time batch migration: move existing note content from KV → Yjs
  const { migrateNotesContent } = await import('./yjs-migration.js');
  await migrateNotesContent();

  if (backend.isMobileRuntime?.()) {
    await router.replace('/');
    return;
  }

  // Initialize the sync engine and pull remote data BEFORE navigating so
  // notes from the sync folder / cloud are already visible on first render.
  // The engine must exist before forceSyncNow() can do anything; without it
  // the old code silently skipped the pull (engine was null).
  try {
    const { useAccountStore } = await import('@/store/account');
    const { useWorkspaceStore } = await import('@/store/workspace.ts');
    if (useAccountStore().isAuthenticated) {
      await useWorkspaceStore().retrieve();
    }
  } catch (err) {
    console.warn('[onboarding] pre-sync workspace retrieve failed:', err);
  }
  initAppSync();
  const engine = getSyncEngine();
  if (engine) {
    try {
      await engine.forceSyncNow();
    } catch (e) {
      console.warn('[onboarding] initial sync pull failed:', e);
    }
    // The first sync cycle may fail to decrypt because
    // persistSecureBlobInBackground (called by adoptVaultKey) is
    // fire-and-forget and the passphrase blob might not be in safe
    // storage yet.  Retry once after a short delay.
    setTimeout(() => engine.forceSyncNow().catch(() => {}), 2000);
  }

  const [latestNote] = [...noteStore.notes].sort(
    (a, b) => (b.updatedAt || 0) - (a.updatedAt || 0)
  );

  await router.replace(latestNote ? `/note/${latestNote.id}` : '/');
}
