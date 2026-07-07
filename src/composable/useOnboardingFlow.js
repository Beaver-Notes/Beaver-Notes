/**
 * Encapsulates all state, computed properties, and actions for the onboarding
 * wizard. Accepts the dependencies it needs (router, stores, etc.) and returns
 * everything the template requires, keeping the page component a thin shell.
 */
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
import { DEFAULT_UI_FONT_STACK, getSettingSync } from '@/composable/settings';
import {
  applyOnboardingSyncPreferences,
  applyOnboardingFreshPreferences,
  getOnboardingMigrationStatus,
  ONBOARDING_ACCENT_COLORS,
  ONBOARDING_FONTS,
  ONBOARDING_INTERFACE_SIZES,
  markOnboardingCompleted,
  ONBOARDING_LANGUAGES,
  ONBOARDING_THEMES,
  openOnboardingWorkspace,
  probeCustomMigrationPath,
  runOnboardingMigration,
  runOnboardingMigrationFromPath,
} from '@/utils/onboarding/index.js';
import {
  decryptNoteWithPassword,
  encryptNoteWithPassword,
  NOTE_CRYPTO_ERROR,
} from '@/utils/crypto/noteCrypto.js';
import {
  findLegacyLockedNotes,
  unwrapLegacyData,
} from '@/utils/platform/legacyLock.js';
import {
  ONBOARDING_IMPORT_SOURCE_MAP,
  PLATFORM_LABELS,
  PLATFORM_ICONS,
  getMigrationSourceCopy,
  getMigrationWhatGetsCopied,
} from '@/utils/onboarding/platforms.js';
import { ENTRANCE_DELAYS } from '@/utils/onboarding/index.js';
import { openDialog } from '@/lib/native/dialog';
import { backend } from '@/lib/tauri-bridge';
import { readLegacyData, writeLegacyData } from '@/lib/native/app';
import lightImg from '@/assets/images/light.png';
import darkImg from '@/assets/images/dark.png';
import systemImg from '@/assets/images/system.png';
import logoUrl from '@/assets/images/logo-transparent.png';

export function useOnboardingFlow({
  route,
  router,
  store,
  noteStore,
  settingsStorage,
  clipboard,
  runImportSource,
}) {
  const { translations } = useTranslations();
  const theme = useTheme();

  // ── Wizard state ───────────────────────────────────────────────────────────

  const step = ref('welcome');
  const completionMode = ref('fresh');
  const selectedMode = ref(null);
  const migrationPlatform = ref(null);

  const customLegacyPath = ref(null);
  const customLegacyStatus = ref(null);

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
    error: '',
    status: null,
    migrationCurrent: '',
    migrationResult: null,
    migrationIssuesText: '',
    evernoteNotebookName: '',
    legacyHasLockedNotes: false,
    legacyLockedNoteCount: 0,
    legacyPasswordPrompt: false,
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
    autoSync: false,
    soundsEnabled: true,
    spotlightEnabled: false,
  });

  // ── Static config ──────────────────────────────────────────────────────────

  const themeImages = { light: lightImg, dark: darkImg, system: systemImg };
  const themes = ONBOARDING_THEMES.map((item) => ({
    ...item,
    img: themeImages[item.name],
  }));
  const accentColors = ONBOARDING_ACCENT_COLORS;
  const accentColorNames = accentColors.map(({ name }) => name);
  const interfaceSizes = ONBOARDING_INTERFACE_SIZES;
  const fonts = ONBOARDING_FONTS;
  const languages = ONBOARDING_LANGUAGES;

  // ── Computed ───────────────────────────────────────────────────────────────

  const themeLabels = computed(() => ({
    light: translations.value.appearence?.light || 'Light',
    dark: translations.value.appearence?.dark || 'Dark',
    system: translations.value.appearence?.system || 'System',
  }));

  const isDark = computed(() =>
    fresh.theme === 'system' ? theme.isDark() : fresh.theme === 'dark'
  );

  const isMobileRuntime = backend.isMobileRuntime();

  const isMacOS = computed(
    () =>
      typeof window !== 'undefined' &&
      window.navigator.platform.toLowerCase().includes('mac')
  );

  const onboardingSubtitle = computed(
    () =>
      translations.value.onboarding?.subtitle ||
      'Configure everything just the way you like it, or import your existing notes from Beaver Notes (Legacy).'
  );

  const completionEyebrow = computed(() =>
    completionMode.value === 'migration' ? 'Migration complete' : 'All set'
  );
  const completionTitle = computed(() =>
    completionMode.value === 'migration'
      ? 'Your notes are ready'
      : 'Your workspace is ready'
  );
  const completionSubtitle = computed(() =>
    completionMode.value === 'migration'
      ? 'Your data has been copied into the new Beaver Notes app. Everything is ready when you open it.'
      : 'Your defaults are already applied. Open a clean workspace and start writing.'
  );

  const migrationDetectionCopy = computed(() => {
    if (customLegacyStatus.value?.hasLegacyData) {
      return 'Custom folder verified — ready to import.';
    }
    if (customLegacyPath.value && !customLegacyStatus.value?.hasLegacyData) {
      return 'The selected folder does not contain a recognisable Beaver Notes workspace.';
    }
    if (state.status?.hasLegacyData) {
      return 'Found your legacy workspace and ready to import.';
    }
    return 'No legacy workspace detected. If you used the Windows Portable version, click "Browse…" to locate your data folder.';
  });

  const migrationPlatformLabel = computed(
    () => PLATFORM_LABELS[migrationPlatform.value] || 'legacy'
  );

  const migrationPlatformIcon = computed(
    () => PLATFORM_ICONS[migrationPlatform.value] || null
  );

  const migrationSourceHeading = computed(() =>
    migrationPlatform.value === 'electron' ? '' : 'Import source'
  );

  const migrationSourceCopy = computed(() => {
    const copy = getMigrationSourceCopy(migrationPlatform.value);
    if (copy === null) return migrationDetectionCopy.value;
    return copy;
  });

  const migrationSourceBadge = computed(() => {
    if (migrationPlatform.value !== 'electron') return '';
    if (state.status?.hasLegacyData || customLegacyStatus.value?.hasLegacyData)
      return 'Ready';
    return '';
  });

  const migrationSourceBadgeClass = computed(() => {
    if (migrationPlatform.value !== 'electron') return '';
    if (state.status?.hasLegacyData || customLegacyStatus.value?.hasLegacyData)
      return 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400';
    return 'bg-neutral-100 text-neutral-600 dark:bg-neutral-900 dark:text-neutral-400';
  });

  const migrationWhatGetsCopied = computed(() =>
    getMigrationWhatGetsCopied(migrationPlatform.value)
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

  const activeFlow = computed(() => {
    if (selectedMode.value === 'fresh')
      return isMobileRuntime
        ? ['welcome', 'setup', 'sync', 'finish']
        : ['welcome', 'path', 'setup', 'sync', 'finish'];
    if (selectedMode.value === 'migration') {
      const base = ['welcome', 'path', 'platform'];
      if (
        migrationPlatform.value === 'electron' &&
        state.legacyHasLockedNotes
      ) {
        return [...base, 'legacyPassword', 'migration', 'finish'];
      }
      return [...base, 'migration', 'finish'];
    }
    return isMobileRuntime ? ['welcome', 'setup'] : ['welcome', 'path'];
  });

  // ── Navigation ─────────────────────────────────────────────────────────────

  const setStep = (s) => {
    step.value = s;
  };
  const goToStep = (s) => {
    step.value = s;
  };

  const goToPreviousStep = () => {
    const i = activeFlow.value.indexOf(step.value);
    if (i > 0) step.value = activeFlow.value[i - 1];
  };

  const chooseMode = (mode) => {
    selectedMode.value = mode;
    setStep(mode === 'fresh' ? 'setup' : 'platform');
  };

  const startFreshFlow = () => chooseMode('fresh');

  const handlePrimaryContinue = () => {
    if (isMobileRuntime) {
      startFreshFlow();
      return;
    }
    setStep('path');
  };

  const openMigrationFlow = async () => {
    selectedMode.value = 'migration';
    migrationPlatform.value = 'electron';
    const dir = customLegacyPath.value || state.status?.legacyDir;
    if (dir) {
      const lockedInfo = await _detectLockedNotesFromDir(dir);
      state.legacyHasLockedNotes = lockedInfo.hasLocked;
      state.legacyLockedNoteCount = lockedInfo.count;
    }
    setStep('platform');
  };

  const selectMigrationPlatform = async (platform) => {
    migrationPlatform.value = platform;
    if (platform === 'electron') {
      const dir = customLegacyPath.value || state.status?.legacyDir;
      if (dir) {
        const lockedInfo = await _detectLockedNotesFromDir(dir);
        state.legacyHasLockedNotes = lockedInfo.hasLocked;
        state.legacyLockedNoteCount = lockedInfo.count;
      }
    }
  };

  // ── Appearance setters (with DOM side-effects) ─────────────────────────────

  const selectTheme = (name) => {
    fresh.theme = name;
    theme.setTheme(name, name === 'system');
  };

  const selectAccentColor = (color) => {
    fresh.accentColor = color;
    const root = document.documentElement;
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

  // ── Confetti ───────────────────────────────────────────────────────────────

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

  // ── Async actions ──────────────────────────────────────────────────────────

  async function refreshStatus() {
    state.error = '';
    state.status = await getOnboardingMigrationStatus();
    if (state.status?.hasLegacyData && state.status?.legacyDir) {
      const lockedInfo = await _detectLockedNotesFromDir(
        state.status.legacyDir
      );
      state.legacyHasLockedNotes = lockedInfo.hasLocked;
      state.legacyLockedNoteCount = lockedInfo.count;
    }
  }

  async function prepareFreshWorkspace() {
    state.error = '';
    state.savingPreferences = true;
    try {
      await applyOnboardingFreshPreferences(fresh, { theme });
      if (!selectedMode.value) selectedMode.value = 'fresh';
      setStep('sync');
    } catch (e) {
      state.error = e?.message || String(e);
    } finally {
      state.savingPreferences = false;
    }
  }

  async function useDefaultPreferences() {
    await prepareFreshWorkspace();
  }

  async function browseForPortableData() {
    state.error = '';
    try {
      const {
        canceled,
        filePaths: [dir],
      } = await openDialog({
        title: 'Locate Beaver Notes portable data folder',
        properties: ['openDirectory'],
        useScopedStorage: true,
      });
      if (canceled || !dir) return;
      const probed = await probeCustomMigrationPath(dir);
      customLegacyPath.value = dir;
      customLegacyStatus.value = probed;
      if (probed?.hasLegacyData) {
        const lockedInfo = await _detectLockedNotesFromDir(dir);
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
    state.migrationStatus = 'Starting import…';
    state.migrationCurrent = '';
    state.migrationResult = null;
    state.migrationIssuesText = '';

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
            85
          );
          state.migrationStatus =
            steps[
              Math.min(
                Math.floor(state.migrationProgress / 20),
                steps.length - 1
              )
            ];
        }
      }, 300);

      if (customLegacyStatus.value?.hasLegacyData && customLegacyPath.value) {
        await runOnboardingMigrationFromPath(customLegacyPath.value);
      } else {
        await runOnboardingMigration();
      }
      clearInterval(ticker);
      state.migrationProgress = 100;
      state.migrationStatus = 'All done!';
      completionMode.value = 'migration';
      state.migrationDone = true;
    } catch (e) {
      state.error = e?.message || String(e);
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
    state.migrationStatus = 'Starting import…';
    state.migrationCurrent = '';
    state.migrationResult = null;
    state.migrationIssuesText = '';

    try {
      const sourceKey = ONBOARDING_IMPORT_SOURCE_MAP[migrationPlatform.value];
      const result = sourceKey
        ? await runImporterWithProgress(sourceKey, {
            notebookName: state.evernoteNotebookName?.trim() || null,
          })
        : null;

      if (!result) return;

      state.migrationProgress = 100;
      state.migrationStatus = 'All done!';
      state.migrationResult = result;
      state.migrationIssuesText = (result.errors || [])
        .map(
          (issue) =>
            `${issue.title || 'Untitled'}: ${issue.reason || 'Unknown error'}`
        )
        .join('\n');
      completionMode.value = 'migration';
      state.migrationDone = true;
    } catch (e) {
      state.error = e?.message || String(e);
    } finally {
      state.migrating = false;
    }
  }

  async function _detectLockedNotesFromDir(dir) {
    try {
      const content = await readLegacyData(dir);
      if (!content) {
        return { hasLocked: false, count: 0 };
      }
      let parsed;
      try {
        parsed = JSON.parse(content);
      } catch {
        return { hasLocked: false, count: 0 };
      }
      const data = unwrapLegacyData(parsed);
      return findLegacyLockedNotes(data);
    } catch (err) {
      console.error('[onboarding] detection error:', err);
      return { hasLocked: false, count: 0 };
    }
  }

  async function handleLegacyPasswordSubmit(password, passwordStore) {
    state.legacyPasswordLoading = true;
    state.legacyPasswordError = '';
    let migratedCount = 0;

    try {
      const dir = customLegacyPath.value || state.status?.legacyDir;
      const content = await readLegacyData(dir);
      if (!content) {
        state.legacyPasswordPrompt = false;
        return { success: true, migratedCount };
      }

      let parsed;
      try {
        parsed = JSON.parse(content);
      } catch {
        state.legacyPasswordPrompt = false;
        return { success: true, migratedCount };
      }

      const data = unwrapLegacyData(parsed);
      const { notes: lockedNotes } = findLegacyLockedNotes(data);
      if (!lockedNotes.length) {
        state.legacyPasswordPrompt = false;
        return { success: true, migratedCount };
      }

      for (const note of lockedNotes) {
        try {
          const ciphertext = note.content?.content?.[0];
          if (!ciphertext) continue;
          const { plaintext } = await decryptNoteWithPassword(
            ciphertext,
            password
          );
          const v2cipher = await encryptNoteWithPassword(plaintext, password);
          note.content = { type: 'doc', content: [v2cipher] };
          note.isLocked = true;
          note.updatedAt = Date.now();
          migratedCount += 1;
        } catch (err) {
          console.warn(`[onboarding] failed to migrate note ${note.id}:`, err);
        }
      }

      if (migratedCount > 0) {
        await writeLegacyData(dir, JSON.stringify(data, null, 2));
      }
      await passwordStore.setSharedKey(password);
      state.legacyPasswordPrompt = false;
      state.legacyHasLockedNotes = false;
      return { success: true, migratedCount };
    } catch (e) {
      console.error('[onboarding] handleLegacyPasswordSubmit error:', e);
      state.legacyPasswordError = e?.message || NOTE_CRYPTO_ERROR;
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
    state.legacyPasswordPrompt = false;
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
        title: 'Choose a sync folder',
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
    fresh.autoSync = false;
  }

  function toggleAutoSync() {
    if (!fresh.syncPath) return;
    fresh.autoSync = !fresh.autoSync;
  }

  async function finishFreshOnboarding() {
    state.error = '';
    state.savingPreferences = true;
    try {
      await applyOnboardingSyncPreferences(fresh);
      selectedMode.value = 'fresh';
      completionMode.value = 'fresh';
      setStep('finish');
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
      await markOnboardingCompleted(settingsStorage);
      await openOnboardingWorkspace({ store, noteStore, router });
    } catch (e) {
      state.error = e?.message || String(e);
    } finally {
      state.openingWorkspace = false;
    }
  }

  function applyRouteEntry() {
    const mode = route.query.mode;
    const targetStep = route.query.step;
    if (mode !== 'migration') return;
    selectedMode.value = 'migration';
    migrationPlatform.value = 'electron';
    setStep(targetStep === 'migration' ? 'migration' : 'platform');
  }

  // ── Lifecycle ──────────────────────────────────────────────────────────────

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

  watch(
    () => route.query,
    () => applyRouteEntry(),
    { immediate: true }
  );

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
      fresh.selectedFont
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

  // ── Public API ─────────────────────────────────────────────────────────────

  return {
    // State
    step,
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

    // Static config
    themes,
    accentColors,
    interfaceSizes,
    fonts,
    languages,
    logoUrl,

    themeLabels,
    isDark,
    isMobileRuntime,
    isMacOS,
    onboardingSubtitle,
    completionEyebrow,
    completionTitle,
    completionSubtitle,
    migrationDetectionCopy,
    migrationPlatformLabel,
    migrationPlatformIcon,
    migrationSourceHeading,
    migrationSourceCopy,
    migrationWhatGetsCopied,
    migrationActionDisabled,

    // Navigation
    setStep,
    goToStep,
    goToPreviousStep,
    chooseMode,
    startFreshFlow,
    handlePrimaryContinue,
    openMigrationFlow,
    selectMigrationPlatform,

    // Appearance
    selectTheme,
    selectAccentColor,
    selectFont,
    selectLanguage,
    selectSounds,
    selectSpotlight,
    selectZoomLevel,

    refreshStatus,
    prepareFreshWorkspace,
    useDefaultPreferences,
    migrateLegacyData,
    runSelectedMigration,
    browseForPortableData,
    copyMigrationIssues,
    chooseSyncPath,
    clearSyncPath,
    toggleAutoSync,
    finishFreshOnboarding,
    completeAndOpenWorkspace,
    handleLegacyPasswordSubmit,
    handleLegacyPasswordSkip,
    migrationSourceBadge,
    migrationSourceBadgeClass,
  };
}
