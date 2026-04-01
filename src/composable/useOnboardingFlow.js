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
} from '@/utils/onboarding';
import { openDialog } from '@/lib/native/dialog';
import { backend } from '@/lib/tauri-bridge';
import lightImg from '@/assets/images/light.png';
import darkImg from '@/assets/images/dark.png';
import systemImg from '@/assets/images/system.png';
import logoUrl from '@/assets/images/logo-transparent.png';

const ONBOARDING_IMPORT_SOURCE_MAP = {
  obsidian: 'obsidian',
  notion: 'notion',
  bear: 'bear',
  simplenote: 'simplenote',
  markdown: 'genericMd',
  evernote: 'evernote',
  'apple-notes': 'appleNotes',
};

const PLATFORM_LABELS = {
  electron: 'Beaver Notes (Legacy)',
  obsidian: 'Obsidian',
  'apple-notes': 'Apple Notes',
  bear: 'Bear',
  simplenote: 'Simplenote',
  markdown: 'Markdown Folder',
  evernote: 'Evernote',
  notion: 'Notion',
};

export function useOnboardingFlow({
  route,
  router,
  store,
  noteStore,
  settingsStorage,
  clipboard,
  ipcRenderer,
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

  const migrationSourceHeading = computed(() =>
    migrationPlatform.value === 'electron' ? 'Legacy workspace' : 'Import source'
  );

  const migrationSourceCopy = computed(() => {
    switch (migrationPlatform.value) {
      case 'electron':
        return migrationDetectionCopy.value;
      case 'obsidian':
        return 'Choose your Obsidian vault folder when import starts. Notes and folders will come across as-is.';
      case 'apple-notes':
        return 'Beaver Notes will request access to Apple Notes and import directly from the app.';
      case 'bear':
        return 'Choose the folder Bear exported in Markdown format. Tags and images will be imported when available.';
      case 'simplenote':
        return 'Choose the exported notes.json file from Simplenote.';
      case 'markdown':
        return 'Choose any folder of Markdown files. Subfolders become Beaver Notes folders.';
      case 'evernote':
        return 'Choose an ENEX export file. You can optionally map the source notebook into a Beaver Notes folder.';
      case 'notion':
        return 'Choose the unzipped Notion export folder. Markdown pages and exported assets will be imported.';
      default:
        return 'Choose a source before starting the import.';
    }
  });

  const migrationSourceBadge = computed(() => {
    if (migrationPlatform.value === 'electron') {
      if (customLegacyStatus.value?.hasLegacyData) return 'Ready (custom)';
      if (state.status?.hasLegacyData) return 'Ready';
      return 'Not found';
    }
    if (migrationPlatform.value === 'apple-notes') return 'Direct access';
    return 'Select on start';
  });

  const migrationSourceBadgeClass = computed(() => {
    if (migrationPlatform.value === 'electron') {
      const ready =
        state.status?.hasLegacyData || customLegacyStatus.value?.hasLegacyData;
      return ready
        ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
        : 'bg-neutral-100 dark:bg-neutral-800 text-neutral-500';
    }
    return 'bg-blue-500/10 text-blue-700 dark:text-blue-300';
  });

  const migrationWhatGetsCopied = computed(() => {
    if (migrationPlatform.value === 'electron') {
      return 'Notes, folders, labels, settings, note assets, file assets, passwords, and stored sync keys all move into the new workspace.';
    }
    if (migrationPlatform.value === 'simplenote') {
      return 'Notes, tags, and timestamps will be imported into Beaver Notes.';
    }
    return 'Notes, folders, labels, timestamps, and exported attachments will be imported when the source provides them.';
  });

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
    if (selectedMode.value === 'migration')
      return ['welcome', 'path', 'platform', 'migration', 'finish'];
    return isMobileRuntime ? ['welcome', 'setup'] : ['welcome', 'path'];
  });

  // ── Navigation ─────────────────────────────────────────────────────────────

  const setStep = (s) => { step.value = s; };
  const goToStep = (s) => { step.value = s; };

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
    if (isMobileRuntime) { startFreshFlow(); return; }
    setStep('path');
  };

  const openMigrationFlow = () => {
    selectedMode.value = 'migration';
    migrationPlatform.value = 'electron';
    setStep('platform');
  };

  const selectMigrationPlatform = (platform) => {
    migrationPlatform.value = platform;
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

  const selectZoomLevel = (zoomLevel) => {
    fresh.zoomLevel = zoomLevel;
    document.body.style.zoom = String(zoomLevel);
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
    const colors = ['#FF4D6D', '#FFB000', '#FFD93D', '#3DDC97', '#4D96FF', '#9B5DE5', '#FFF', '#FF9A3C'];
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
    delay(() => { confettiPieces.value = []; }, 3800);
  }

  // ── Async actions ──────────────────────────────────────────────────────────

  async function refreshStatus() {
    state.error = '';
    state.status = await getOnboardingMigrationStatus();
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
      const { canceled, filePaths: [dir] } = await openDialog({
        title: 'Locate Beaver Notes portable data folder',
        properties: ['openDirectory'],
      });
      if (canceled || !dir) return;
      const probed = await probeCustomMigrationPath(dir);
      customLegacyPath.value = dir;
      customLegacyStatus.value = probed;
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
      const steps = ['Copying notes…', 'Copying folders…', 'Copying labels…', 'Copying assets…', 'Migrating settings…'];
      const ticker = setInterval(() => {
        if (state.migrationProgress < 85) {
          state.migrationProgress = Math.min(
            state.migrationProgress + Math.floor(Math.random() * 8) + 2,
            85
          );
          state.migrationStatus =
            steps[Math.min(Math.floor(state.migrationProgress / 20), steps.length - 1)];
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
    state.migrationProgress = total ? Math.max(5, Math.round((done / total) * 100)) : 10;
    state.migrationStatus = total ? `Importing ${done} of ${total}…` : 'Importing…';
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
        .map((issue) => `${issue.title || 'Untitled'}: ${issue.reason || 'Unknown error'}`)
        .join('\n');
      completionMode.value = 'migration';
      state.migrationDone = true;
    } catch (e) {
      state.error = e?.message || String(e);
    } finally {
      state.migrating = false;
    }
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
      const { canceled, filePaths: [dir] } = await openDialog({
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
      delay(() => { finishIn.value = true; }, 80);
      launchConfetti();
    }
  });

  watch(() => route.query, () => applyRouteEntry(), { immediate: true });

  onMounted(async () => {
    if (prefersReducedMotion()) {
      logoIn.value = textIn.value = ctaIn.value = true;
    } else {
      delay(() => { logoIn.value = true; }, 120);
      delay(() => { textIn.value = true; }, 580);
      delay(() => { ctaIn.value = true; }, 1020);
    }

    theme.loadTheme();
    fresh.theme = theme.currentTheme.value || fresh.theme;
    fresh.accentColor = getSettingSync('colorScheme') || fresh.accentColor;
    fresh.zoomLevel = parseFloat(getSettingSync('zoomLevel')) || fresh.zoomLevel;
    fresh.selectedFont = getSettingSync('selectedFont') || fresh.selectedFont;
    document.documentElement.style.setProperty('--selected-font', fresh.selectedFont);
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
    step, state, fresh, confettiPieces,
    logoIn, textIn, ctaIn, finishIn,
    migrationPlatform, customLegacyPath, customLegacyStatus,

    // Static config
    themes, accentColors, interfaceSizes, fonts, languages, logoUrl,

    themeLabels, isDark, isMobileRuntime, isMacOS,
    onboardingSubtitle,
    completionEyebrow, completionTitle, completionSubtitle,
    migrationDetectionCopy, migrationPlatformLabel,
    migrationSourceHeading, migrationSourceCopy,
    migrationSourceBadge, migrationSourceBadgeClass,
    migrationWhatGetsCopied, migrationActionDisabled,

    // Navigation
    setStep, goToStep, goToPreviousStep,
    chooseMode, startFreshFlow, handlePrimaryContinue,
    openMigrationFlow, selectMigrationPlatform,

    // Appearance
    selectTheme, selectAccentColor, selectZoomLevel,

    refreshStatus, prepareFreshWorkspace, useDefaultPreferences,
    migrateLegacyData, runSelectedMigration, browseForPortableData,
    copyMigrationIssues, chooseSyncPath, clearSyncPath,
    toggleAutoSync, finishFreshOnboarding, completeAndOpenWorkspace,
  };
}
