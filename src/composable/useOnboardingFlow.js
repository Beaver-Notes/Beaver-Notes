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
import { DEFAULT_UI_FONT_STACK, getSettingSync, setSetting } from '@/composable/settings';
import { useAccountStore } from '@/store/account';
import {
  applyOnboardingSyncPreferences,
  applyOnboardingFreshPreferences,
  getOnboardingMigrationStatus,
  ONBOARDING_FONTS,
  markOnboardingCompleted,
  ONBOARDING_LANGUAGES,
  ONBOARDING_THEMES,
  probeCustomMigrationPath,
  runOnboardingMigration,
  runOnboardingMigrationFromPath,
  ENTRANCE_DELAYS,
} from '@/utils/onboarding/index.js';
import { setupEncryption, hasRemoteVaultKeyParams, adoptVaultKey } from '@/utils/crypto/encryption.js';
import { getOnboardingSyncTransport } from '@/utils/onboarding/sync-policy.js';
import { setSyncPath } from '@/utils/sync/path.js';
import {
  detectLegacyLockedNotes,
  migrateLegacyLockedNotes,
} from '@/utils/migration/legacyElectron.js';
import {
  ALL_PLATFORMS,
  ONBOARDING_IMPORT_SOURCE_MAP,
  PLATFORM_LABELS,
  getMigrationSourceCopy,
  getMigrationWhatGetsCopied,
} from '@/utils/onboarding/platforms.js';
import { openDialog } from '@/lib/native/dialog';
import { backend } from '@/lib/tauri-bridge';
import lightImg from '@/assets/images/light.png';
import darkImg from '@/assets/images/dark.png';
import systemImg from '@/assets/images/system.png';
import logoUrl from '@/assets/images/logo-transparent.png';
import { fetchCloudKeyParams, getFetchedCloudKeyParams, deriveVaultPassphraseProof } from '@/utils/sync/vault-key-params.js';
import { detectRemoteVaultJoin, completeRemoteVaultJoin } from '@/utils/onboarding/remote-vault-join.js';
import { useWorkspaceStore } from '@/store/workspace.ts';
import { getApiClient } from '@/lib/api/client';
import { loadSessionToken } from '@/composable/useAccountStorage';

// Steps that live inside the persistent wizard frame (fixed card / bottom
// sheet). 'welcome' and 'finish' are full-screen hero steps and are not
// part of this set.
const WIZARD_STEPS = ['customize', 'password', 'import', 'account', 'sync'];

export function useOnboardingFlow({
  router,
  store,
  noteStore,
  settingsStorage,
  clipboard,
  runImportSource,
}) {
  const { translations } = useTranslations();
  const theme = useTheme();
  const accountStore = useAccountStore();

  //  Wizard state

  const step = ref('welcome');
  const importPhase = ref('pick');
  const migrationPlatform = ref(null);
  const customLegacyPath = ref(null);
  const customLegacyStatus = ref(null);

  // Tracks whether the last navigation moved forward or backward through
  // the flow, so the wizard body can slide the right direction.
  const navDirection = ref('forward');

  const getLegacyDir = () => customLegacyPath.value || state.status?.legacyDir;

  // Entrance animation flags
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

  // Fresh-start preference selections
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

  //  Encryption password state
  const encryptionPassword = ref('');
  const encryptionConfirmPassword = ref('');
  const encryptionPasswordError = ref('');
  const encryptionPasswordLoading = ref(false);

  //  Join-existing-vault state (auto-detected from the chosen sync source)
  const vaultJoinMode = ref(false);

  async function detectVaultJoin() {
    vaultJoinMode.value = false;
    try {
      let detected = false;
      if (accountStore.isAuthenticated) {
        detected = await detectRemoteVaultJoin({
          fetchCloudKeyParams,
          hasRemoteVaultKeyParams: async () => hasRemoteVaultKeyParams(),
        }).catch(() => {});
      }
      if (!detected) {
        detected = await hasRemoteVaultKeyParams();
      }
      vaultJoinMode.value = detected;
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
        if (!result?.ok) {
          encryptionPasswordError.value = result?.error || 'Failed to join this vault.';
          return;
        }
        goToNextStep();
        return;
      }
      const result = await adoptVaultKey(pw, fetched?.paramsBlob);
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
      const result = await setupEncryption(pw);
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

  //  Static config

  const themeImages = { light: lightImg, dark: darkImg, system: systemImg };
  const themes = ONBOARDING_THEMES.map((item) => ({
    ...item,
    img: themeImages[item.name],
  }));
  const fonts = ONBOARDING_FONTS;
  const languages = ONBOARDING_LANGUAGES;

  //  Computed

  const themeLabels = computed(() => ({
    light: translations.value.appearance?.light || 'Light',
    dark: translations.value.appearance?.dark || 'Dark',
    system: translations.value.appearance?.system || 'System',
  }));

  const isDark = computed(() =>
    fresh.theme === 'system' ? theme.isDark() : fresh.theme === 'dark',
  );

  const isMobileRuntime = backend.isMobileRuntime();

  const isMacOS = computed(
    () =>
      typeof window !== 'undefined' &&
      window.navigator.platform.toLowerCase().includes('mac'),
  );

  const visiblePlatforms = computed(() =>
    ALL_PLATFORMS.filter((platform) => !platform.macOnly || isMacOS.value),
  );

  // Paid accounts use cloud sync directly and do not need a folder selection.
  const activeFlow = computed(() => {
    const flow = ['welcome', 'customize', 'password', 'import', 'account', 'finish'];
    if (!accountStore.canUseCloudSync) flow.splice(4, 0, 'sync');
    return flow;
  });

  // True while the current step lives inside the persistent wizard frame
  // (fixed card on desktop / bottom sheet on mobile), as opposed to the
  // full-screen welcome/finish hero steps.
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

  //  Navigation

  // Every other nav helper routes through this, so direction tracking
  // (used to pick the slide-in animation) lives in one place.
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
    }
    goToNextStep();
  }

  const handlePrimaryContinue = () => {
    goToStep('customize');
  };

  //  Import

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

    try {
      const steps = [
        'Copying notes…',
        'Copying folders…',
        'Copying labels…',
        'Copying assets…',
        'Migrating settings…',
      ];
      const ticker = setInterval(() => {
        if (state.migrationProgress < 85) {
          state.migrationProgress = Math.min(
            state.migrationProgress + Math.floor(Math.random() * 8) + 2,
            85,
          );
          state.migrationStatus =
            steps[
              Math.min(
                Math.floor(state.migrationProgress / 20),
                steps.length - 1,
              )
            ];
        }
      }, 300);

      if (customLegacyStatus.value?.hasLegacyData && customLegacyPath.value) {
        await runOnboardingMigrationFromPath(customLegacyPath.value);
      } else {
        await runOnboardingMigration();
      }

      // One-time batch migration: move existing note content from KV → Yjs
      state.migrationStatus = 'Migrating note content…';
      const { migrateNotesContent } = await import('@/utils/onboarding/yjs-migration.js');
      await migrateNotesContent();

      // Re-encrypt any assets written during import (safety net for edge cases)
      state.migrationStatus = 'Securing assets…';
      try {
        const { migrateAssetEncryption } = await import('@/lib/native/security.js');
        await migrateAssetEncryption();
      } catch (e) {
        console.warn('[onboarding] post-import asset re-encryption failed:', e);
      }

      clearInterval(ticker);
      state.migrationProgress = 100;
      state.migrationStatus =
        translations.value.onboarding?.allDone || 'All done!';
      state.migrationDone = true;
      importPhase.value = 'done';
    } catch (e) {
      state.error = e?.message || String(e);
      importPhase.value = 'confirm';
    } finally {
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
        const { migrateAssetEncryption } = await import('@/lib/native/security.js');
        await migrateAssetEncryption();
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
      importPhase.value = 'done';
    } catch (e) {
      state.error = e?.message || String(e);
      importPhase.value = 'confirm';
    } finally {
      state.migrating = false;
    }
  }

  async function handleLegacyPasswordSubmit(password, passwordStore) {
    state.legacyPasswordLoading = true;
    state.legacyPasswordError = '';
    let migratedCount = 0;

    try {
      const dir = getLegacyDir();
      if (!dir) {
        state.legacyHasLockedNotes = false;
        return { success: true, migratedCount };
      }

      migratedCount = await migrateLegacyLockedNotes(dir, password, (pw) =>
        passwordStore.setAppPassword(pw),
      );
      state.legacyHasLockedNotes = false;
      return { success: true, migratedCount };
    } catch (e) {
      console.error('[onboarding] handleLegacyPasswordSubmit error:', e);
      state.legacyPasswordError = e?.message || 'Incorrect password';
      return {
        success: false,
        migratedCount,
        error: state.legacyPasswordError,
      };
    } finally {
      state.legacyPasswordLoading = false;
    }
  }

  function handleLegacyPasswordSkip() {
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

  //  Fresh preferences

  async function applyFreshAndGo(target) {
    state.error = '';
    state.savingPreferences = true;
    try {
      await applyOnboardingFreshPreferences(fresh, { theme });
      goToStep(target);
    } catch (e) {
      state.error = e?.message || String(e);
    } finally {
      state.savingPreferences = false;
    }
  }

  async function prepareFreshWorkspace() {
    await applyFreshAndGo('password');
  }

  async function useDefaultPreferences() {
    await applyFreshAndGo('password');
  }

  //  Appearance

  const selectTheme = (name) => {
    fresh.theme = name;
    theme.setTheme(name, name === 'system');
  };

  const selectAccentColor = (color) => {
    fresh.accentColor = color;
    const root = document.documentElement;
    const accentColorNames = [
      'red',
      'light',
      'green',
      'blue',
      'purple',
      'pink',
      'neutral',
    ];
    root.classList.forEach((cls) => {
      if (accentColorNames.includes(cls)) root.classList.remove(cls);
    });
    root.classList.add(color);
  };

  const selectFont = (font) => {
    fresh.selectedFont = font;
    document.documentElement.style.setProperty('--selected-font', font);
  };

  const selectLanguage = (language) => {
    fresh.language = language;
  };

  const selectSounds = (value) => {
    fresh.soundsEnabled = value;
  };

  const selectSpotlight = (value) => {
    fresh.spotlightEnabled = value;
  };

  const selectZoomLevel = (zoomLevel) => {
    fresh.zoomLevel = zoomLevel;
  };

  //  Sync

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
      await router.replace('/');
    } catch (e) {
      state.error = e?.message || String(e);
    } finally {
      state.openingWorkspace = false;
      state.openingWorkspaceMessage = '';
    }
  }

  //  Confetti

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

  //  Lifecycle

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
    fresh.theme = theme.currentTheme.value || fresh.theme;
    fresh.accentColor = getSettingSync('colorScheme') || fresh.accentColor;
    fresh.zoomLevel =
      parseFloat(getSettingSync('zoomLevel')) || fresh.zoomLevel;
    fresh.selectedFont = getSettingSync('selectedFont') || fresh.selectedFont;
    fresh.soundsEnabled =
      getSettingSync('soundsEnabled') ?? fresh.soundsEnabled;
    fresh.spotlightEnabled =
      getSettingSync('spotlightEnabled') ?? fresh.spotlightEnabled;
    document.documentElement.style.setProperty(
      '--selected-font',
      fresh.selectedFont,
    );
    selectAccentColor(fresh.accentColor);
    selectZoomLevel(fresh.zoomLevel);

    try {
      await refreshStatus();
    } catch (e) {
      state.error = e?.message || String(e);
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
    themes,
    fonts,
    languages,
    logoUrl,

    themeLabels,
    isDark,
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

    // Appearance
    selectTheme,
    selectAccentColor,
    selectFont,
    selectLanguage,
    selectSounds,
    selectSpotlight,
    selectZoomLevel,

    // Actions
    refreshStatus,
    prepareFreshWorkspace,
    useDefaultPreferences,
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
