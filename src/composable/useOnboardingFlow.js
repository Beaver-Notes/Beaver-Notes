import {
  computed,
  nextTick,
  onMounted,
  onUnmounted,
  reactive,
  ref,
  watch,
} from 'vue';
import { useTranslations } from '@/composable/useTranslations';
import { useTheme } from '@/composable/theme';
import { useOnboardingAppearance } from '@/composable/useOnboardingAppearance';
import { DEFAULT_UI_FONT_STACK, getSetting, invalidateSettingMirrors, setSetting } from '@/lib/settings';
import { useAccountStore } from '@/store/account';
import {
  applyOnboardingSyncPreferences,
  getOnboardingMigrationStatus,
  markOnboardingCompleted,
  probeCustomMigrationPath,
  runOnboardingMigration,
  runOnboardingMigrationFromPath,
  ENTRANCE_DELAYS,
} from '@/utils/onboarding/index.js';
import {
  buildImportedSearchIndex,
  secureImportedAssets,
} from '@/utils/onboarding/import-finalize.js';
import { setupEncryption, hasRemoteVaultKeyParams, adoptVaultKey, isKeyLoaded } from '@/utils/crypto/encryption.js';
import { getOnboardingSyncTransport } from '@/utils/onboarding/sync-policy.js';
import { setSyncPath } from '@/utils/sync/path.js';
import { forceSyncNow } from '@/utils/sync';
import {
  detectLegacyLockedNotes,
  validateLegacyLockedPassword,
} from '@/utils/migration/legacyElectron.js';
import {
  ALL_PLATFORMS,
  ONBOARDING_IMPORT_SOURCE_MAP,
  PLATFORM_LABELS,
  getMigrationSourceCopy,
  getMigrationWhatGetsCopied,
  isPlatformVisible,
} from '@/utils/onboarding/platforms.js';
import { isMacOSRuntime } from '@/lib/tauri/runtime';
import { openDialog } from '@/lib/native/dialog';
import { readLegacyData } from '@/lib/native/app';
import { backend } from '@/lib/tauri-bridge';
import logoUrl from '@/assets/images/logo-transparent.png';
import { fetchCloudKeyParams, getFetchedCloudKeyParams, deriveVaultPassphraseProof } from '@/utils/sync/vault-key-params.js';
import { detectRemoteVaultJoin, completeRemoteVaultJoin, adoptWorkspaceKeysFromVault } from '@/utils/onboarding/remote-vault-join.js';
import { useWorkspaceStore } from '@/store/workspace.ts';
import { useCloudWorkspaces } from '@/composable/useCloudWorkspaces';
import { getApiClient } from '@/lib/api/client';
import { loadSessionToken } from '@/lib/account-storage';
import { writeStoresFromWorkspace } from '@/lib/yjs/meta-store.js';

// Steps inside the persistent wizard frame; 'welcome'/'finish' are full-screen hero steps.
const WIZARD_STEPS = ['account', 'sync', 'password', 'import', 'customize'];

export function useOnboardingFlow({
  router,
  clipboard,
  runImportSource,
}) {
  const { translations } = useTranslations();
  const theme = useTheme();
  const accountStore = useAccountStore();

  // Wizard state

  const step = ref('welcome');
  const importPhase = ref('pick');
  const migrationPlatform = ref(null);
  const customLegacyPath = ref(null);
  const customLegacyStatus = ref(null);

  // Legacy locked-notes password: never persisted to state, held only until
  // migrateLegacyData decrypts locked notes; cleared on failure/skip.
  let legacyPassword = '';

  // Forward/backward tracking drives the wizard body's slide direction.
  const navDirection = ref('forward');

  const getLegacyDir = () => customLegacyPath.value || state.status?.legacyDir;

  const logoIn = ref(false);
  const textIn = ref(false);
  const ctaIn = ref(false);
  const finishIn = ref(false);
  const confettiPieces = ref([]);

  const state = reactive({
    loading: true,
    migrating: false,
    migrationDone: false,
    migrationProgress: 0,
    migrationStatus: '',
    savingPreferences: false,
    openingWorkspace: false,
    openingWorkspaceMessage: '',
    error: '',
    status: null,
    migrationCurrent: '',
    migrationResult: null,
    migrationIssuesText: '',
    evernoteNotebookName: '',
    legacyHasLockedNotes: false,
    legacyLockedNoteCount: 0,
    legacyPasswordLoading: false,
    legacyPasswordError: '',
  });

  const fresh = reactive({
    theme: 'system',
    language: 'en',
    spellcheckEnabled: true,
    openLastEdited: true,
    openAfterCreation: true,
    accentColor: 'blue',
    zoomLevel: 1.0,
    selectedFont: DEFAULT_UI_FONT_STACK,
    syncPath: '',
    soundsEnabled: true,
    spotlightEnabled: false,
  });

  const encryptionPassword = ref('');
  const encryptionConfirmPassword = ref('');
  const encryptionPasswordError = ref('');
  const encryptionPasswordLoading = ref(false);

  // Join-existing-vault mode, auto-detected from the chosen sync source.
  const vaultJoinMode = ref(false);

  async function detectVaultJoin() {
    vaultJoinMode.value = false;
    try {
      let detected = false;
      console.warn('[onboarding][vault-detect] starting vault join detection');
      if (accountStore.isAuthenticated) {
        // fetchCloudKeyParams needs an active workspace; not loaded yet on fresh onboarding.
        const workspaceStore = useWorkspaceStore();
        if (!workspaceStore.activeId) {
          try {
            await workspaceStore.retrieve();
          } catch (e) {
            console.warn('[onboarding] workspace retrieve during vault detect failed:', e);
          }
        }
        console.warn('[onboarding][vault-detect] workspaceId:', workspaceStore.activeId);
        detected = await detectRemoteVaultJoin({
          fetchCloudKeyParams,
          hasRemoteVaultKeyParams: async () => hasRemoteVaultKeyParams(),
        }).catch((err) => {
          console.warn('[onboarding][vault-detect] detectRemoteVaultJoin threw:', err);
          return {};
        });
        console.warn('[onboarding][vault-detect] detectRemoteVaultJoin result:', detected);
      } else {
        console.warn('[onboarding][vault-detect] not authenticated, skipping remote detection');
      }
      if (!detected) {
        detected = await hasRemoteVaultKeyParams();
        console.warn('[onboarding][vault-detect] hasRemoteVaultKeyParams fallback:', detected);
      }
      vaultJoinMode.value = detected;
      console.warn('[onboarding][vault-detect] final vaultJoinMode:', vaultJoinMode.value);
    } catch (e) {
      console.warn('[onboarding] vault-join detection failed:', e);
      vaultJoinMode.value = false;
    }
  }

  async function adoptVaultPassword() {
    encryptionPasswordError.value = '';
    const t = translations.value;
    const pw = encryptionPassword.value;
    if (!pw) {
      encryptionPasswordError.value =
        t?.settings?.invalidPassword || 'Please enter the vault password.';
      return;
    }
    encryptionPasswordLoading.value = true;
    try {
      const workspaceId = useWorkspaceStore().activeId;
      const fetched = getFetchedCloudKeyParams();
      console.warn('[onboarding][vault-adopt] workspaceId:', workspaceId, 'vaultJoinMode:', vaultJoinMode.value, 'fetched:', !!fetched, 'fetchedKeys:', fetched ? Object.keys(fetched) : null);
      if (workspaceId && vaultJoinMode.value && fetched) {
        // Wait for session token to be available (may not be saved yet after sign-in)
        let token = null;
        for (let i = 0; i < 20 && !token; i++) {
          token = await loadSessionToken();
          if (!token) await new Promise(r => setTimeout(r, 250));
        }
        if (!token) {
          encryptionPasswordError.value = 'Session token not available. Please try again.';
          return;
        }
        const { challenge } = await getApiClient({ baseUrl: accountStore.serverUrl })
          .createVaultChallenge(workspaceId);
        const result = await completeRemoteVaultJoin({
          workspaceId,
          passphrase: pw,
          proofBlob: fetched.proofBlob,
          paramsBlob: fetched.paramsBlob,
          challenge,
          deriveProof: deriveVaultPassphraseProof,
          verify: (id, proof, challenge) =>
            getApiClient({ baseUrl: accountStore.serverUrl }).verifyVaultPassphrase(id, proof, challenge),
          adopt: adoptVaultKey,
        });
        console.warn('[onboarding][vault-adopt] completeRemoteVaultJoin result:', result?.ok, result?.error);
        if (!result?.ok) {
          encryptionPasswordError.value = result?.error || 'Failed to join this vault.';
          return;
        }
        // Session AEK is now unlocked: recover the joined workspace's key from
        // its passphrase-recoverable envelope and seed the local key cache.
        try {
          const cloud = useCloudWorkspaces();
          const joined = cloud.workspaces.value.find((w) => w.id === workspaceId);
          await adoptWorkspaceKeysFromVault(joined);
        } catch (recoverErr) {
          console.warn('[onboarding][vault-adopt] workspace key recovery skipped:', recoverErr?.message || recoverErr);
        }
        goToNextStep();
        return;
      }
      console.warn('[onboarding][vault-adopt] FALLBACK path — adoptVaultKey with paramsBlob:', !!fetched?.paramsBlob);
      const result = await adoptVaultKey(pw, fetched?.paramsBlob);
      console.warn('[onboarding][vault-adopt] adoptVaultKey result:', result?.ok, result?.error);
      if (!result.ok) {
        encryptionPasswordError.value =
          result.error || 'Failed to join this vault.';
        return;
      }
      goToNextStep();
    } catch (e) {
      encryptionPasswordError.value = e?.message || String(e);
    } finally {
      encryptionPasswordLoading.value = false;
    }
  }

  function startFreshVault() {
    vaultJoinMode.value = false;
    encryptionPassword.value = '';
    encryptionConfirmPassword.value = '';
    encryptionPasswordError.value = '';
  }

  async function setupEncryptionPassword() {
    encryptionPasswordError.value = '';
    const t = translations.value;
    const pw = encryptionPassword.value;
    if (!pw) {
      encryptionPasswordError.value =
        t?.settings?.invalidPassword || 'Please enter a password.';
      return;
    }
    if (pw.length < 8) {
      encryptionPasswordError.value =
        t?.settings?.passwordTooShort ||
        'Password must be at least 8 characters.';
      return;
    }
    if (pw !== encryptionConfirmPassword.value) {
      encryptionPasswordError.value =
        t?.settings?.passwordMismatch || 'Passwords do not match.';
      return;
    }
    encryptionPasswordLoading.value = true;
    try {
      console.warn('[onboarding][encrypt-setup] calling setupEncryption (fresh vault, NOT adopting existing vault)');
      const result = await setupEncryption(pw);
      console.warn('[onboarding][encrypt-setup] setupEncryption result:', result?.ok, result?.error);
      if (!result.ok) {
        encryptionPasswordError.value =
          result.error || 'Failed to set up encryption.';
        return;
      }
      goToNextStep();
    } catch (e) {
      encryptionPasswordError.value = e?.message || String(e);
    } finally {
      encryptionPasswordLoading.value = false;
    }
  }


  const isMobileRuntime = backend.isMobileRuntime();

  const isMacOS = computed(() => isMacOSRuntime());

  const visiblePlatforms = computed(() =>
    ALL_PLATFORMS.filter((platform) =>
      isPlatformVisible(platform, {
        isMacOS: isMacOS.value,
        isTouch: isMobileRuntime,
      }),
    ),
  );

  // Sync step hidden for beta — Beaver Sync not ready yet.
  const activeFlow = computed(() => {
    const flow = ['welcome', 'account', 'password', 'import', 'customize', 'finish'];
    return flow;
  });

  const isCardStep = computed(() => WIZARD_STEPS.includes(step.value));

  const migrationDetectionCopy = computed(() => {
    if (customLegacyStatus.value?.hasLegacyData) {
      return 'Custom folder verified — ready to import.';
    }
    if (customLegacyPath.value && !customLegacyStatus.value?.hasLegacyData) {
      return 'The selected folder does not contain a recognisable Beaver Notes app.';
    }
    if (state.status?.hasLegacyData) {
      return 'Found your legacy app data and ready to import.';
    }
    return 'No legacy app data detected. If you used the Windows Portable version, click "Browse…" to locate your data folder.';
  });

  const migrationPlatformLabel = computed(
    () => PLATFORM_LABELS[migrationPlatform.value] || 'legacy',
  );

  const migrationSourceCopy = computed(() => {
    const copy = getMigrationSourceCopy(migrationPlatform.value);
    if (copy === null) return migrationDetectionCopy.value;
    return copy;
  });

  const migrationWhatGetsCopied = computed(() =>
    getMigrationWhatGetsCopied(migrationPlatform.value),
  );

  const migrationActionDisabled = computed(() => {
    if (!migrationPlatform.value) return true;
    if (migrationPlatform.value === 'electron') {
      return (
        !state.status?.hasLegacyData && !customLegacyStatus.value?.hasLegacyData
      );
    }
    if (migrationPlatform.value === 'apple-notes') return !isMacOS.value;
    return false;
  });

  const migrationSourceBadge = computed(() => {
    if (state.status?.hasLegacyData || customLegacyStatus.value?.hasLegacyData)
      return 'Ready';
    return '';
  });

  const migrationSourceBadgeClass = computed(() => {
    if (state.status?.hasLegacyData || customLegacyStatus.value?.hasLegacyData)
      return 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400';
    return 'bg-neutral-100 text-neutral-600 dark:bg-neutral-900 dark:text-neutral-400';
  });

  const showLegacyLockedPrompt = computed(
    () =>
      importPhase.value === 'confirm' &&
      migrationPlatform.value === 'electron' &&
      state.legacyHasLockedNotes,
  );


  // All nav helpers route through here so slide-direction tracking lives in one place.
  const goToStep = (s) => {
    const oldIndex = activeFlow.value.indexOf(step.value);
    const newIndex = activeFlow.value.indexOf(s);
    if (oldIndex !== -1 && newIndex !== -1) {
      navDirection.value = newIndex >= oldIndex ? 'forward' : 'backward';
    }
    step.value = s;
  };

  const goToPreviousStep = () => {
    const i = activeFlow.value.indexOf(step.value);
    if (i > 0) goToStep(activeFlow.value[i - 1]);
  };

  const goToNextStep = () => {
    const i = activeFlow.value.indexOf(step.value);
    if (i >= 0 && i < activeFlow.value.length - 1)
      goToStep(activeFlow.value[i + 1]);
  };

  async function completeAccountStep() {
    if (accountStore.isAuthenticated) {
      const transport = getOnboardingSyncTransport({
        isAuthenticated: true,
        isPaidPlan: accountStore.isPaidPlan,
      });
      await setSetting('syncTransport', transport);
      if (transport === 'remote') await setSyncPath('');
      await detectVaultJoin();
      // Seed only when a vault key is already unlocked (e.g. re-running
      // onboarding); seeding on first run would encrypt under the throwaway
      // auto-created key and orphan every uploaded artifact.
      if (isKeyLoaded()) {
        try {
          const { useAccountAuth } = await import('@/composable/useAccountAuth');
          useAccountAuth().triggerSeed().catch(() => {});
        } catch {}
      }
    }
    goToNextStep();
  }

  const handlePrimaryContinue = () => {
    goToStep('account');
  };

  const appearance = useOnboardingAppearance({ fresh, state, theme, goToStep });
  const { selectAccentColor, selectZoomLevel } = appearance;


  const resetImport = () => {
    importPhase.value = 'pick';
    migrationPlatform.value = null;
    customLegacyPath.value = null;
    customLegacyStatus.value = null;
    state.legacyHasLockedNotes = false;
    state.legacyLockedNoteCount = 0;
    state.migrationDone = false;
    state.migrationProgress = 0;
    state.migrationStatus = '';
    state.migrationCurrent = '';
    state.migrationResult = null;
    state.migrationIssuesText = '';
    state.evernoteNotebookName = '';
  };

  const skipImport = () => {
    resetImport();
    goToNextStep();
  };

  const backToPick = () => {
    importPhase.value = 'pick';
    migrationPlatform.value = null;
    state.legacyHasLockedNotes = false;
    state.legacyLockedNoteCount = 0;
  };

  async function selectImportSource(platform) {
    migrationPlatform.value = platform;
    importPhase.value = 'confirm';
    if (platform === 'electron') {
      const dir = getLegacyDir();
      if (dir) {
        const lockedInfo = await detectLegacyLockedNotes(dir);
        state.legacyHasLockedNotes = lockedInfo.hasLocked;
        state.legacyLockedNoteCount = lockedInfo.count;
      }
    }
  }

  async function refreshStatus() {
    state.error = '';
    state.status = await getOnboardingMigrationStatus();
    if (state.status?.hasLegacyData && state.status?.legacyDir) {
      const lockedInfo = await detectLegacyLockedNotes(state.status.legacyDir);
      state.legacyHasLockedNotes = lockedInfo.hasLocked;
      state.legacyLockedNoteCount = lockedInfo.count;
    }
  }

  async function browseForPortableData() {
    state.error = '';
    try {
      const {
        canceled,
        filePaths: [dir],
      } = await openDialog({
        title:
          translations.value.onboarding?.locatePortableData ||
          'Locate Beaver Notes portable data folder',
        properties: ['openDirectory'],
        useScopedStorage: true,
      });
      if (canceled || !dir) return;
      const probed = await probeCustomMigrationPath(dir);
      customLegacyPath.value = dir;
      customLegacyStatus.value = probed;
      if (probed?.hasLegacyData) {
        const lockedInfo = await detectLegacyLockedNotes(dir);
        state.legacyHasLockedNotes = lockedInfo.hasLocked;
        state.legacyLockedNoteCount = lockedInfo.count;
      }
    } catch (e) {
      state.error = e?.message || String(e);
    }
  }

  async function migrateLegacyData() {
    state.error = '';
    state.migrating = true;
    state.migrationDone = false;
    state.migrationProgress = 0;
    state.migrationStatus =
      translations.value.onboarding?.startingImport || 'Starting import…';
    state.migrationCurrent = '';
    state.migrationResult = null;
    state.migrationIssuesText = '';
    importPhase.value = 'running';

    // Progress weighted by phase: Rust copy 0-60, Yjs conversion 60-90, finalize 90-100.
    const COPY_WEIGHT = 60;
    const CONVERT_WEIGHT = 30;
    let unlistenProgress = null;

    try {
      unlistenProgress = await backend.listenPayload(
        'migration-progress',
        (payload) => {
          if (payload?.phase !== 'copy') return;
          const { done, total } = payload || {};
          state.migrationProgress = Math.min(
            total > 0 ? Math.round((done / total) * COPY_WEIGHT) : COPY_WEIGHT,
            COPY_WEIGHT,
          );
          state.migrationStatus =
            total > 0
              ? `Migrating data… ${done} of ${total}`
              : 'Migrating data…';
        }
      );

      if (customLegacyStatus.value?.hasLegacyData && customLegacyPath.value) {
        await runOnboardingMigrationFromPath(customLegacyPath.value);
      } else {
        await runOnboardingMigration();
      }
      console.warn('[onboarding] legacy Electron migration (Rust copy) finished');

      // Read the legacy store directly (never via KV); the Rust copy already ran.
      const legacyDir = getLegacyDir();
      state.migrationStatus = 'Reading legacy data…';
      const legacyRaw = legacyDir ? await readLegacyData(legacyDir) : null;
      if (!legacyRaw) {
        throw new Error('No legacy data file found to import.');
      }
      const { unwrapLegacyData } = await import('@/utils/platform/legacyLock');
      const legacyData = unwrapLegacyData(JSON.parse(legacyRaw));

      state.migrationStatus = 'Migrating note content…';
      const { convertLegacyNotesToYjs } = await import(
        '@/utils/onboarding/legacyContentToYjs.js'
      );
      const noteList = Object.entries(legacyData?.notes || {}).map(
        ([id, note]) => ({ ...note, id: note.id || id })
      );

      // Load the workspace doc before converting so a retried migration can
      // detect notes already appended in a prior attempt (non-empty snapshot
      // across ALL note ids, not just the seeded workspace meta).
      const { loadWorkspaceDoc } = await import('@/lib/yjs/workspace-doc.js');
      await loadWorkspaceDoc();
      const allNoteIds = noteList.map((n) => n.id).filter(Boolean);
      let alreadyConvertedIds = new Set();
      if (allNoteIds.length > 0) {
        const { getSnapshots } = await import('@/lib/native/yjs.js');
        const snapshots = await getSnapshots(allNoteIds).catch(() => ({}));
        alreadyConvertedIds = new Set(
          allNoteIds.filter((id) => (snapshots?.[id]?.length ?? 0) > 0)
        );
      }

      const convertResult = await convertLegacyNotesToYjs(noteList, {
        onProgress: (done, total) => {
          state.migrationProgress =
            COPY_WEIGHT + Math.round((done / total) * CONVERT_WEIGHT);
        },
        legacyPassword: legacyPassword || undefined,
        alreadyConvertedIds,
      });
      console.warn(
        '[onboarding] note content conversion complete:',
        JSON.stringify(convertResult)
      );

      // Seed the workspace doc from parsed data; ensure legacy notes carry
      // cardPreview/preview/searchText first so hydration avoids snapshot fallback.
      try {
        const { ensureLegacyNotesPreview } = await import('@/utils/onboarding/legacyContentToYjs.js');
        if (legacyData?.notes) ensureLegacyNotesPreview(legacyData.notes);
      } catch (e) {
        console.warn('[onboarding] preview enrich failed:', e);
      }
      state.migrationStatus = 'Migrating workspace…';
      const { seedWorkspaceDocFromData } = await import('@/lib/yjs/meta-store.js');
      const seedResult = await seedWorkspaceDocFromData(
        legacyData?.notes || {},
        legacyData?.folders || {},
        legacyData?.labels || [],
        legacyData?.labelColors || {},
        legacyData?.deletedIds || {},
        legacyData?.deletedFolderIds || {}
      );
      console.warn(
        '[onboarding] workspace doc seeded from parsed data:',
        JSON.stringify(seedResult)
      );

      // importLegacyPreferences routes syncPath through setSyncPath (invalidating
      // the memoized cache) and skips it for cloud-sync users — no re-assert needed.
      try {
        const { importLegacyPreferences } = await import(
          '@/utils/onboarding/import-preferences.js'
        );
        if (legacyDir) {
          const imported = await importLegacyPreferences(legacyDir);
          console.warn('[onboarding] imported', imported, 'legacy preferences');
        }
      } catch (err) {
        console.warn('[onboarding] preference import failed:', err);
      }

      // Correlated native + frontend state dump, so stranded notes are visible post-import.
      try {
        const { dumpDebugState } = await import('@/lib/debug/bridge.js');
        await dumpDebugState();
      } catch (err) {
        console.warn('[onboarding] debug state dump failed:', err);
      }

      // Build search/link indexes from imported notes (which still carry
      // searchText) — keeps search working without bloating the workspace doc.
      try {
        await buildImportedSearchIndex(legacyData?.notes || {});
      } catch (err) {
        console.warn('[onboarding] search index build after import failed:', err);
      }

      // Re-encrypt any assets written during import (safety net for edge cases)
      state.migrationStatus = 'Securing assets…';
      try {
        await secureImportedAssets();
      } catch (e) {
        console.warn('[onboarding] post-import asset re-encryption failed:', e);
      }

      state.migrationProgress = COPY_WEIGHT + CONVERT_WEIGHT;
      state.migrationStatus =
        translations.value.onboarding?.allDone || 'All done!';
      state.migrationDone = true;
      try {
        await seedFreshFromSettings();
      } catch (err) {
        console.warn('[onboarding] re-seed from imported settings failed:', err);
      }
      // The legacy per-note password is only needed during conversion; clear it
      // as soon as the import succeeds so it is never held in memory longer.
      legacyPassword = '';
      importPhase.value = 'done';
      state.migrationProgress = 100;
    } catch (e) {
      state.error = e?.message || String(e);
      importPhase.value = 'confirm';
    } finally {
      unlistenProgress?.();
      state.migrating = false;
    }
  }

  function handleImportProgress({ done, total, current }) {
    state.migrationProgress = total
      ? Math.max(5, Math.round((done / total) * 100))
      : 10;
    state.migrationStatus = total
      ? `Importing ${done} of ${total}…`
      : 'Importing…';
    state.migrationCurrent = current || '';
  }

  async function runImporterWithProgress(sourceKey, options = {}) {
    return runImportSource(sourceKey, {
      ...options,
      onProgress: ({ done, total, current }) => {
        handleImportProgress({ done, total, current });
        options.onProgress?.({ done, total, current });
      },
    });
  }

  async function runSelectedMigration() {
    if (migrationPlatform.value === 'electron') {
      await migrateLegacyData();
      return;
    }

    state.error = '';
    state.migrating = true;
    state.migrationDone = false;
    state.migrationProgress = 0;
    state.migrationStatus =
      translations.value.onboarding?.startingImport || 'Starting import…';
    state.migrationCurrent = '';
    state.migrationResult = null;
    state.migrationIssuesText = '';
    importPhase.value = 'running';

    try {
      const sourceKey = ONBOARDING_IMPORT_SOURCE_MAP[migrationPlatform.value];
      const result = sourceKey
        ? await runImporterWithProgress(sourceKey, {
            notebookName: state.evernoteNotebookName?.trim() || null,
          })
        : null;

      if (!result) return;

      // Re-encrypt any assets written during import (safety net for edge cases)
      state.migrationStatus = 'Securing assets…';
      try {
        await secureImportedAssets();
      } catch (e) {
        console.warn('[onboarding] post-import asset re-encryption failed:', e);
      }

      state.migrationProgress = 100;
      state.migrationStatus =
        translations.value.onboarding?.allDone || 'All done!';
      state.migrationResult = result;
      state.migrationIssuesText = (result.errors || [])
        .map(
          (issue) =>
            `${issue.title || 'Untitled'}: ${issue.reason || 'Unknown error'}`,
        )
        .join('\n');
      state.migrationDone = true;
      try {
        await seedFreshFromSettings();
      } catch (err) {
        console.warn('[onboarding] re-seed from imported settings failed:', err);
      }
      importPhase.value = 'done';
    } catch (e) {
      state.error = e?.message || String(e);
      importPhase.value = 'confirm';
    } finally {
      state.migrating = false;
    }
  }

  async function handleLegacyPasswordSubmit(password) {
    state.legacyPasswordLoading = true;
    state.legacyPasswordError = '';
    let lockedCount = 0;

    try {
      const dir = getLegacyDir();
      if (!dir) {
        state.legacyHasLockedNotes = false;
        return { success: true, migratedCount: lockedCount };
      }

      // Held for the whole-note conversion in migrateLegacyData, which runs after this step.
      legacyPassword = password;

      // Read-only validation (throws on wrong password); actual decryption +
      // conversion happens once in migrateLegacyData. Config.json never mutated.
      const validation = await validateLegacyLockedPassword(dir, password);
      lockedCount = validation?.count || 0;
      state.legacyHasLockedNotes = false;
      return { success: true, migratedCount: lockedCount };
    } catch (e) {
      console.error('[onboarding] handleLegacyPasswordSubmit error:', e);
      legacyPassword = '';
      state.legacyPasswordError = e?.message || 'Incorrect password';
      return {
        success: false,
        migratedCount: lockedCount,
        error: state.legacyPasswordError,
      };
    } finally {
      state.legacyPasswordLoading = false;
    }
  }

  function handleLegacyPasswordSkip() {
    legacyPassword = '';
    state.legacyPasswordError = '';
    state.legacyHasLockedNotes = false;
  }

  async function copyMigrationIssues() {
    if (!state.migrationIssuesText) return;
    try {
      await clipboard.writeText(state.migrationIssuesText);
    } catch (error) {
      state.error = error?.message || String(error);
    }
  }


  async function chooseSyncPath() {
    state.error = '';
    try {
      const {
        canceled,
        filePaths: [dir],
      } = await openDialog({
        title:
          translations.value.onboarding?.chooseSyncFolder ||
          'Choose a sync folder',
        properties: ['openDirectory'],
        useScopedStorage: true,
      });
      if (canceled || !dir) return;
      fresh.syncPath = dir;
    } catch (error) {
      state.error = error?.message || String(error);
    }
  }

  function clearSyncPath() {
    fresh.syncPath = '';
  }

  async function completeSyncStep() {
    state.error = '';
    state.savingPreferences = true;
    try {
      await applyOnboardingSyncPreferences(fresh);
      await detectVaultJoin();
      goToNextStep();
    } catch (e) {
      state.error = e?.message || String(e);
    } finally {
      state.savingPreferences = false;
    }
  }

  async function completeAndOpenWorkspace() {
    state.error = '';
    state.openingWorkspace = true;
    try {
      await markOnboardingCompleted();
      // Hydrate Pinia stores from the workspace Y.Doc — seeding during
      // onboarding does not populate them automatically. Best-effort only.
      try {
        await writeStoresFromWorkspace();
      } catch (e) {
        console.warn('[onboarding] store hydration failed:', e);
      }
      // First sync: engine is initialized at boot; without this it waits for
      // a manual trigger from Settings or the next launch.
      forceSyncNow().catch(() => {});
      await router.replace('/');
    } catch (e) {
      state.error = e?.message || String(e);
    } finally {
      state.openingWorkspace = false;
      state.openingWorkspaceMessage = '';
    }
  }


  const prefersReducedMotion = () =>
    typeof window !== 'undefined' &&
    window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

  const timers = [];
  const delay = (fn, ms) => {
    const t = setTimeout(fn, ms);
    timers.push(t);
  };

  function launchConfetti() {
    if (prefersReducedMotion()) return;
    const colors = [
      '#FF4D6D',
      '#FFB000',
      '#FFD93D',
      '#3DDC97',
      '#4D96FF',
      '#9B5DE5',
      '#FFF',
      '#FF9A3C',
    ];
    const r = () => Math.random();
    confettiPieces.value = Array.from({ length: 42 }, (_, i) => {
      const side = i % 2 === 0 ? 'l' : 'r';
      return {
        id: `${Date.now()}-${i}`,
        style: {
          '--cw': `${8 + r() * 10}px`,
          '--ch': `${10 + r() * 16}px`,
          '--cc': colors[Math.floor(r() * colors.length)],
          '--cd': `${r() * 320}ms`,
          '--cdur': `${2400 + r() * 1000}ms`,
          '--cy': `${28 + r() * 44}vh`,
          '--cx': side === 'l' ? `${18 + r() * 40}vw` : `${-(18 + r() * 40)}vw`,
          '--co': `${3 + r() * 12}vw`,
          '--cr': `${280 + r() * 720}deg`,
          '--cbr': r() > 0.65 ? '999px' : `${2 + r() * 4}px`,
        },
      };
    });
    delay(() => {
      confettiPieces.value = [];
    }, 3800);
  }


  watch(step, async (next) => {
    if (next === 'finish') {
      finishIn.value = false;
      await nextTick();
      delay(() => {
        finishIn.value = true;
      }, 80);
      launchConfetti();
    }
  });

  const SEED_SETTING_KEYS = [
    'theme',
    'colorScheme',
    'zoomLevel',
    'selectedFont',
    'soundsEnabled',
    'spotlightEnabled',
    'selectedLanguage',
    'directionPreference',
  ];

  async function seedFreshFromSettings() {
    // Imported settings live only in the KV pool during onboarding; drop stale
    // mirrors so getSetting reads the pool (and re-mirrors as a side effect).
    invalidateSettingMirrors(SEED_SETTING_KEYS);

    const themeSetting = await getSetting('theme');
    fresh.theme = themeSetting || fresh.theme;
    fresh.accentColor = (await getSetting('colorScheme')) || fresh.accentColor;
    fresh.zoomLevel =
      parseFloat(await getSetting('zoomLevel')) || fresh.zoomLevel;
    fresh.selectedFont = (await getSetting('selectedFont')) || fresh.selectedFont;
    fresh.language = (await getSetting('selectedLanguage')) || fresh.language;
    fresh.soundsEnabled =
      (await getSetting('soundsEnabled')) ?? fresh.soundsEnabled;
    fresh.spotlightEnabled =
      (await getSetting('spotlightEnabled')) ?? fresh.spotlightEnabled;
    document.documentElement.style.setProperty(
      '--selected-font',
      fresh.selectedFont,
    );
    selectAccentColor(fresh.accentColor);
    selectZoomLevel(fresh.zoomLevel);
  }

  onMounted(async () => {
    if (prefersReducedMotion()) {
      logoIn.value = textIn.value = ctaIn.value = true;
    } else {
      delay(() => {
        logoIn.value = true;
      }, ENTRANCE_DELAYS.logo);
      delay(() => {
        textIn.value = true;
      }, ENTRANCE_DELAYS.text);
      delay(() => {
        ctaIn.value = true;
      }, ENTRANCE_DELAYS.cta);
    }

    theme.loadTheme();
    await seedFreshFromSettings();

    try {
      await refreshStatus();
    } catch (e) {      state.error = e?.message || String(e);
    } finally {
      state.loading = false;
    }
  });

  onUnmounted(() => timers.forEach(clearTimeout));

  const trackedSteps = computed(() =>
    activeFlow.value.filter((s) => s !== 'welcome' && s !== 'finish'),
  );

  const showStepProgress = computed(() =>
    trackedSteps.value.includes(step.value),
  );

  const currentStepNumber = computed(() => {
    const index = trackedSteps.value.indexOf(step.value);
    return index !== -1 ? index + 1 : 0;
  });

  const totalStepCount = computed(() => trackedSteps.value.length);

  const stepProgressPercent = computed(() =>
    totalStepCount.value > 0
      ? Math.round((currentStepNumber.value / totalStepCount.value) * 100)
      : 0,
  );

  return {
    // State
    step,
    importPhase,
    state,
    fresh,
    confettiPieces,
    logoIn,
    textIn,
    ctaIn,
    finishIn,
    migrationPlatform,
    customLegacyPath,
    customLegacyStatus,
    navDirection,

    // Static config
    logoUrl,
    ...appearance,

    isMobileRuntime,
    isMacOS,
    isCardStep,
    visiblePlatforms,
    migrationPlatformLabel,
    migrationSourceCopy,
    migrationWhatGetsCopied,
    migrationActionDisabled,
    migrationSourceBadge,
    migrationSourceBadgeClass,
    showLegacyLockedPrompt,

    // Navigation
    goToStep,
    goToPreviousStep,
    goToNextStep,
    completeAccountStep,
    handlePrimaryContinue,
    skipImport,
    backToPick,
    selectImportSource,

    // Actions
    refreshStatus,
    runSelectedMigration,
    browseForPortableData,
    copyMigrationIssues,
    chooseSyncPath,
    clearSyncPath,
    completeSyncStep,
    completeAndOpenWorkspace,
    handleLegacyPasswordSubmit,
    handleLegacyPasswordSkip,

    // Encryption password
    encryptionPassword,
    encryptionConfirmPassword,
    encryptionPasswordError,
    encryptionPasswordLoading,
    setupEncryptionPassword,
    vaultJoinMode,
    detectVaultJoin,
    adoptVaultPassword,
    startFreshVault,

    // Step progress
    trackedSteps,
    showStepProgress,
    currentStepNumber,
    totalStepCount,
    stepProgressPercent,
  };
}
