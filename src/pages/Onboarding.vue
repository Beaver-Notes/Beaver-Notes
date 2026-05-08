<template>
  <div
    class="ob-shell relative overflow-x-hidden overflow-y-auto flex items-center justify-center antialiased select-none"
    :class="isDark ? 'ob-dark' : 'ob-light'"
    :style="{ fontFamily: 'var(--selected-font, sans-serif)' }"
  >
    <!-- Background -->
    <div class="ob-bg fixed inset-0 z-0" aria-hidden="true"></div>

    <!-- ── Curtain overlay ── -->
    <div
      class="ob-curtain"
      :class="{ 'ob-curtain--visible': curtainVisible }"
      aria-hidden="true"
    >
      <div class="ob-curtain__half ob-curtain__half--left">
        <div class="ob-curtain__wrapper">
          <div class="ob-curtain__block ob-curtain__block--1"></div>
          <div class="ob-curtain__block ob-curtain__block--2"></div>
          <div class="ob-curtain__block ob-curtain__block--3"></div>
        </div>
      </div>
      <div class="ob-curtain__half ob-curtain__half--right">
        <div class="ob-curtain__wrapper">
          <div class="ob-curtain__block ob-curtain__block--1"></div>
          <div class="ob-curtain__block ob-curtain__block--2"></div>
          <div class="ob-curtain__block ob-curtain__block--3"></div>
        </div>
      </div>
    </div>

    <!-- Page content (no built-in Transition — curtain handles it) -->
    <div class="ob-page-content relative z-10 w-full" :key="step">
      <!-- ── Welcome ── -->
      <div
        v-if="step === 'welcome'"
        class="ob-screen flex flex-col items-center justify-center w-full"
      >
        <div
          class="flex flex-col items-center gap-6 text-center max-w-md w-full"
        >
          <img
            :src="logoUrl"
            alt="Beaver Notes"
            class="w-24 h-24 object-contain ob-logo"
            :class="{ 'ob-logo--in': logoIn }"
          />

          <div
            class="ob-headline flex flex-col items-center gap-1"
            :class="{ 'ob-headline--in': textIn }"
          >
            <div class="overflow-hidden pb-0.5">
              <p
                class="ob-eyebrow text-[0.68rem] font-bold uppercase tracking-[0.18em] ob-label-text"
              >
                Welcome to
              </p>
            </div>
            <div class="overflow-hidden pb-0.5">
              <h1
                class="ob-title text-5xl font-bold tracking-tight leading-none ob-heading-text"
              >
                Beaver Notes
              </h1>
            </div>
          </div>

          <div
            class="ob-below flex flex-col items-center gap-4"
            :class="{ 'ob-below--in': ctaIn }"
          >
            <p class="text-base leading-relaxed ob-body-text max-w-sm">
              {{ onboardingSubtitle }}
            </p>
            <div class="flex flex-wrap justify-center gap-3">
              <ui-button
                :loading="state.savingPreferences"
                @click="useDefaultPreferences"
              >
                <template v-if="!state.savingPreferences">
                  <v-remixicon name="riMagicLine" class="mr-1" />
                  Use defaults
                </template>
              </ui-button>
              <ui-button variant="primary" @click="handlePrimaryContinue">
                Continue <v-remixicon name="riArrowRightLine" />
              </ui-button>
            </div>
          </div>
        </div>

        <div
          v-if="state.status?.hasLegacyData && !isMobileRuntime"
          class="ob-floating-action fixed z-20"
        >
          <ui-button @click="openMigrationFlow">
            <v-remixicon name="riSendPlaneFill" class="mr-1" />
            Import from Beaver Notes (Legacy)
          </ui-button>
        </div>
      </div>

      <!-- ── Path ── -->
      <div
        v-else-if="step === 'path'"
        class="ob-screen flex flex-col items-center justify-center w-full"
      >
        <ui-card class="w-full max-w-lg">
          <div class="flex flex-col items-center gap-2 my-8 text-center">
            <h2 class="text-3xl font-semibold tracking-tight ob-heading-text">
              How do you want to begin?
            </h2>
            <p class="ob-body-text">
              Build a fresh workspace or bring over your notes from another app.
            </p>
          </div>

          <div class="flex flex-col gap-2">
            <ui-card
              tag="button"
              padding="p-0"
              class="w-full text-left"
              @click="chooseMode('fresh')"
            >
              <div class="flex items-center gap-4 p-4">
                <div
                  class="shrink-0 w-10 h-10 rounded-lg bg-primary/10 text-primary flex items-center justify-center"
                >
                  <v-remixicon name="riStarFill" />
                </div>
                <div class="flex-1 min-w-0">
                  <h3 class="font-semibold text-sm ob-heading-text">
                    Start fresh
                  </h3>
                  <p class="text-sm ob-body-text mt-0.5">
                    Pick your theme, language, and a few app defaults before
                    opening Beaver Notes.
                  </p>
                </div>
                <v-remixicon
                  name="riArrowRightLine"
                  class="shrink-0 opacity-30"
                />
              </div>
            </ui-card>

            <ui-card
              tag="button"
              padding="p-0"
              class="w-full text-left"
              @click="chooseMode('migration')"
            >
              <div class="flex items-center gap-4 p-4">
                <div
                  class="shrink-0 w-10 h-10 rounded-lg bg-primary/10 text-primary flex items-center justify-center"
                >
                  <v-remixicon name="riSendPlaneFill" />
                </div>
                <div class="flex-1 min-w-0">
                  <h3 class="font-semibold text-sm ob-heading-text">
                    Import from apps
                  </h3>
                  <p class="text-sm ob-body-text mt-0.5">
                    Copy notes, folders, labels, etc. from your previous notes
                    app.
                  </p>
                </div>
                <v-remixicon
                  name="riArrowRightLine"
                  class="shrink-0 opacity-30"
                />
              </div>
            </ui-card>
          </div>

          <div class="mt-5">
            <ui-button @click="curtainNavigate('welcome')">
              <v-remixicon name="riArrowLeftLine" /> Back
            </ui-button>
          </div>
        </ui-card>
      </div>

      <!-- ── Setup ── -->
      <div
        v-else-if="step === 'setup'"
        class="ob-screen flex flex-col items-center justify-center w-full"
      >
        <onboarding-setup-step
          :fresh="fresh"
          :themes="themes"
          :theme-labels="themeLabels"
          :accent-colors="accentColors"
          :interface-sizes="interfaceSizes"
          :fonts="fonts"
          :languages="languages"
          @select-theme="selectTheme"
          @select-accent="selectAccentColor"
          @select-zoom="selectZoomLevel"
          @update-font="selectFont($event)"
          @update-language="selectLanguage($event)"
        >
          <template #back>
            <ui-button
              @click="curtainNavigate(isMobileRuntime ? 'welcome' : 'path')"
            >
              <v-remixicon name="riArrowLeftLine" /> Back
            </ui-button>
          </template>
          <template #next>
            <ui-button
              variant="primary"
              :loading="state.savingPreferences"
              @click="prepareFreshWorkspace"
            >
              <template v-if="!state.savingPreferences">
                Continue <v-remixicon name="riArrowRightLine" />
              </template>
            </ui-button>
          </template>
        </onboarding-setup-step>
      </div>

      <!-- ── Sync ── -->
      <div
        v-else-if="step === 'sync'"
        class="ob-screen flex flex-col items-center justify-center w-full"
      >
        <ui-card class="w-full max-w-lg">
          <div class="flex flex-col items-center gap-2 my-8 text-center">
            <h2 class="text-3xl font-semibold tracking-tight ob-heading-text">
              Sync folder
            </h2>
            <p class="ob-body-text">
              Optionally keep Beaver Notes synced with a folder you control.
            </p>
          </div>

          <div class="flex flex-col gap-3">
            <ui-card class="bg-input">
              <div class="flex flex-col gap-3 p-4">
                <div class="flex items-center justify-between gap-3">
                  <div>
                    <p
                      class="text-xs font-bold uppercase tracking-widest ob-label-text mb-1"
                    >
                      Folder
                    </p>
                    <p class="text-sm ob-body-text">
                      {{
                        fresh.syncPath
                          ? 'Beaver Notes will use this folder for sync data.'
                          : 'Choose a folder if you want to enable sync later.'
                      }}
                    </p>
                  </div>
                  <ui-button variant="secondary" @click="chooseSyncPath">
                    {{ fresh.syncPath ? 'Change' : 'Choose folder' }}
                  </ui-button>
                </div>

                <div
                  v-if="fresh.syncPath"
                  class="rounded-lg bg-neutral-100 px-3 py-2 text-xs break-all text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300"
                >
                  {{ fresh.syncPath }}
                </div>

                <div v-if="fresh.syncPath" class="flex gap-3">
                  <ui-button variant="secondary" @click="clearSyncPath"
                    >Clear</ui-button
                  >
                </div>
              </div>
            </ui-card>

            <ui-card class="bg-input">
              <button
                class="flex items-center justify-between w-full px-4 py-3 text-left"
                @click="toggleAutoSync"
              >
                <div>
                  <span class="block text-sm font-semibold ob-heading-text"
                    >Automatic sync</span
                  >
                  <span class="block text-xs ob-body-text mt-0.5">
                    Sync changes automatically when a folder is configured.
                  </span>
                  <span
                    v-if="!fresh.syncPath"
                    class="block text-xs ob-body-text mt-1 opacity-80"
                  >
                    Choose a sync folder first to enable this.
                  </span>
                </div>
                <ui-switch
                  v-model="fresh.autoSync"
                  :disabled="!fresh.syncPath"
                />
              </button>
            </ui-card>
          </div>

          <div class="mt-5 flex justify-between gap-4">
            <ui-button @click="curtainNavigate('setup')">
              <v-remixicon name="riArrowLeftLine" /> Back
            </ui-button>
            <div class="flex gap-3">
              <ui-button @click="finishFreshOnboarding">Skip for now</ui-button>
              <ui-button
                variant="primary"
                :loading="state.savingPreferences"
                @click="finishFreshOnboarding"
              >
                <template v-if="!state.savingPreferences">
                  Continue <v-remixicon name="riArrowRightLine" />
                </template>
              </ui-button>
            </div>
          </div>
        </ui-card>
      </div>

      <!-- ── Platform ── -->
      <div
        v-else-if="step === 'platform'"
        class="ob-screen ob-screen--scroll flex flex-col items-center justify-start w-full"
      >
        <onboarding-platform-step
          v-model="migrationPlatform"
          :is-mac-o-s="isMacOS"
          :logo-url="logoUrl"
        >
          <template #back>
            <ui-button @click="curtainNavigate('path')">
              <v-remixicon name="riArrowLeftLine" /> Back
            </ui-button>
          </template>
          <template #next>
            <ui-button
              variant="primary"
              :disabled="!migrationPlatform"
              @click="curtainNavigate('migration')"
            >
              Continue <v-remixicon name="riArrowRightLine" />
            </ui-button>
          </template>
        </onboarding-platform-step>
      </div>

      <!-- ── Migration ── -->
      <div
        v-else-if="step === 'migration'"
        class="ob-screen flex flex-col items-center justify-center w-full"
      >
        <ui-card class="w-full max-w-lg">
          <div class="flex flex-col items-center gap-2 my-8 text-center">
            <h2 class="text-3xl font-semibold tracking-tight ob-heading-text">
              Import your {{ migrationPlatformLabel }} workspace
            </h2>
            <p class="ob-body-text max-w-sm">
              Your original workspace stays untouched. Notes, folders, labels,
              settings, and assets will be copied into the new app.
            </p>
          </div>

          <div class="flex flex-col gap-2">
            <ui-card class="bg-input">
              <div class="flex items-center justify-between gap-4 p-4">
                <div>
                  <p
                    class="text-xs font-bold uppercase tracking-widest ob-label-text mb-1"
                  >
                    {{ migrationSourceHeading }}
                  </p>
                  <p class="text-sm ob-body-text">{{ migrationSourceCopy }}</p>
                </div>
                <span
                  class="shrink-0 rounded-full px-3 py-1 text-xs font-semibold"
                  :class="migrationSourceBadgeClass"
                >
                  {{ migrationSourceBadge }}
                </span>
              </div>
            </ui-card>

            <ui-card
              v-if="migrationPlatform === 'evernote' && !state.migrating"
              class="bg-input"
            >
              <div class="flex flex-col gap-2 p-4">
                <p
                  class="text-xs font-bold uppercase tracking-widest ob-label-text"
                >
                  Evernote notebook
                </p>
                <ui-input
                  v-model="state.evernoteNotebookName"
                  placeholder="Notebook name (optional)"
                  class="w-full"
                />
              </div>
            </ui-card>

            <ui-card
              v-if="state.migrating || state.migrationDone"
              class="bg-input"
            >
              <div class="flex flex-col gap-3 p-4">
                <div class="flex items-center justify-between">
                  <p
                    class="text-xs font-bold uppercase tracking-widest ob-label-text"
                  >
                    {{ state.migrationDone ? 'Import complete' : 'Importing…' }}
                  </p>
                  <span class="text-xs font-bold text-primary"
                    >{{ state.migrationProgress }}%</span
                  >
                </div>
                <div
                  class="h-1.5 rounded-full bg-neutral-100 dark:bg-neutral-800 overflow-hidden"
                >
                  <div
                    class="h-full rounded-full bg-primary transition-all duration-300 ease-out"
                    :style="{ width: state.migrationProgress + '%' }"
                  ></div>
                </div>
                <p class="text-xs ob-body-text">{{ state.migrationStatus }}</p>
                <p
                  v-if="state.migrationCurrent"
                  class="text-xs ob-body-text opacity-80"
                >
                  {{ state.migrationCurrent }}
                </p>
              </div>
            </ui-card>

            <ui-card
              v-if="!state.migrating && !state.migrationDone"
              class="bg-input"
            >
              <div class="flex flex-col gap-1 p-4">
                <p
                  class="text-xs font-bold uppercase tracking-widest ob-label-text mb-1"
                >
                  What gets copied
                </p>
                <p class="text-sm ob-body-text">
                  {{ migrationWhatGetsCopied }}
                </p>
              </div>
            </ui-card>

            <ui-card
              v-if="
                migrationPlatform === 'electron' &&
                (state.status?.legacyDir ||
                  state.status?.appDir ||
                  customLegacyPath)
              "
              class="bg-input"
            >
              <div class="flex flex-col gap-4 p-4">
                <div v-if="customLegacyPath" class="flex flex-col gap-1">
                  <span
                    class="text-xs font-bold uppercase tracking-widest ob-label-text"
                  >
                    Portable data folder
                  </span>
                  <code
                    class="text-xs font-mono break-all px-2 py-1.5 rounded-md bg-neutral-100 dark:bg-neutral-800 text-neutral-600 dark:text-neutral-300"
                  >
                    {{ customLegacyPath }}
                  </code>
                </div>
                <div
                  v-else-if="state.status?.legacyDir"
                  class="flex flex-col gap-1"
                >
                  <span
                    class="text-xs font-bold uppercase tracking-widest ob-label-text"
                  >
                    Beaver Notes (Legacy)
                  </span>
                  <code
                    class="text-xs font-mono break-all px-2 py-1.5 rounded-md bg-neutral-100 dark:bg-neutral-800 text-neutral-600 dark:text-neutral-300"
                  >
                    {{ state.status.legacyDir }}
                  </code>
                </div>
                <div v-if="state.status?.appDir" class="flex flex-col gap-1">
                  <span
                    class="text-xs font-bold uppercase tracking-widest ob-label-text"
                  >
                    New Beaver Notes
                  </span>
                  <code
                    class="text-xs font-mono break-all px-2 py-1.5 rounded-md bg-neutral-100 dark:bg-neutral-800 text-neutral-600 dark:text-neutral-300"
                  >
                    {{ state.status.appDir }}
                  </code>
                </div>
              </div>
            </ui-card>

            <ui-card
              v-if="
                migrationPlatform === 'electron' &&
                !state.status?.hasLegacyData &&
                !state.migrating &&
                !state.migrationDone
              "
              class="bg-input"
            >
              <div class="flex items-center justify-between gap-4 p-4">
                <div>
                  <p
                    class="text-xs font-bold uppercase tracking-widest ob-label-text mb-1"
                  >
                    Windows Portable
                  </p>
                  <p class="text-sm ob-body-text">
                    Using the portable version? Locate your data folder
                    manually.
                  </p>
                </div>
                <ui-button @click="browseForPortableData">Browse…</ui-button>
              </div>
            </ui-card>

            <ui-card
              v-if="state.migrationDone && state.migrationResult"
              class="bg-input"
            >
              <div class="flex flex-col gap-1 p-4">
                <p
                  class="text-xs font-bold uppercase tracking-widest ob-label-text mb-1"
                >
                  Import summary
                </p>
                <p class="text-sm ob-body-text">
                  Imported {{ state.migrationResult.imported || 0 }} notes
                  across {{ state.migrationResult.folders || 0 }} folders.
                </p>
              </div>
            </ui-card>

            <ui-card
              v-if="state.migrationDone && state.migrationIssuesText"
              class="bg-input"
            >
              <div class="flex flex-col gap-3 p-4">
                <div class="flex items-center justify-between gap-3">
                  <p
                    class="text-xs font-bold uppercase tracking-widest ob-label-text"
                  >
                    Issues
                  </p>
                  <ui-button variant="secondary" @click="copyMigrationIssues">
                    Copy to clipboard
                  </ui-button>
                </div>
                <div
                  class="max-h-40 overflow-auto rounded-lg bg-neutral-100 p-3 font-mono text-[11px] whitespace-pre-wrap text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300"
                >
                  {{ state.migrationIssuesText }}
                </div>
              </div>
            </ui-card>
          </div>

          <div class="mt-5 flex justify-between gap-4">
            <ui-button
              :disabled="state.migrating"
              @click="curtainNavigate('platform')"
            >
              <v-remixicon name="riArrowLeftLine" /> Back
            </ui-button>
            <ui-button
              v-if="!state.migrating && !state.migrationDone"
              variant="primary"
              :disabled="migrationActionDisabled"
              @click="runSelectedMigration"
            >
              Start import <v-remixicon name="riArrowRightLine" />
            </ui-button>
            <ui-button
              v-else-if="state.migrationDone"
              variant="primary"
              @click="curtainNavigate('finish')"
            >
              Continue <v-remixicon name="riArrowRightLine" />
            </ui-button>
            <ui-button v-else variant="primary" loading disabled />
          </div>
        </ui-card>
      </div>

      <!-- ── Finish ── -->
      <div
        v-else
        class="ob-screen flex flex-col items-center justify-center w-full"
      >
        <div
          class="flex flex-col items-center gap-5 text-center max-w-md w-full ob-finish"
          :class="{ 'ob-finish--in': finishIn }"
        >
          <img
            :src="logoUrl"
            alt="Beaver Notes"
            class="w-24 h-24 object-contain drop-shadow-xl"
          />
          <div class="flex flex-col items-center gap-2">
            <p
              class="text-xs font-bold uppercase tracking-[0.18em] text-primary"
            >
              {{ completionEyebrow }}
            </p>
            <h1
              class="text-5xl font-bold tracking-tight leading-none ob-heading-text"
            >
              {{ completionTitle }}
            </h1>
            <p class="text-base leading-relaxed ob-body-text max-w-sm">
              {{ completionSubtitle }}
            </p>
          </div>
          <div class="flex flex-wrap justify-center gap-3">
            <ui-button @click="goToPreviousStep">
              <v-remixicon name="riArrowLeftLine" /> Back
            </ui-button>
            <ui-button
              variant="primary"
              :loading="state.openingWorkspace"
              @click="completeAndOpenWorkspace"
            >
              <template v-if="!state.openingWorkspace">
                <v-remixicon name="riCheckLine" class="mr-1" /> Open Beaver
                Notes
              </template>
            </ui-button>
          </div>
        </div>
      </div>
    </div>
    <!-- /ob-page-content -->

    <!-- Error toast -->
    <Transition name="ob-toast">
      <div
        v-if="state.error"
        class="ob-toast-card fixed left-1/2 -translate-x-1/2 z-50 w-[calc(100%-2rem)] max-w-lg px-4 py-3 rounded-xl text-sm text-center backdrop-blur bg-red-50/80 text-red-700 ring-1 ring-red-200 dark:bg-red-950/40 dark:text-red-300 dark:ring-red-800"
      >
        {{ state.error }}
      </div>
    </Transition>

    <!-- Confetti -->
    <div
      v-if="confettiPieces.length"
      class="fixed inset-0 z-50 overflow-hidden pointer-events-none"
      aria-hidden="true"
    >
      <span
        v-for="p in confettiPieces"
        :key="p.id"
        class="ob-confetti__bit absolute bottom-[-24px]"
        :style="p.style"
      ></span>
    </div>
  </div>
</template>

<script>
import { ref, nextTick } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useStorage } from '@/composable/storage';
import { useImportExport } from '@/composable/useImportExport';
import { useStore } from '@/store';
import { useNoteStore } from '@/store/note';
import { useFolderStore } from '@/store/folder';
import { backend, clipboard, ipcRenderer } from '@/lib/tauri-bridge';
import { useOnboardingFlow } from '@/composable/useOnboardingFlow';
import OnboardingSetupStep from '@/components/onboarding/OnboardingSetupStep.vue';
import OnboardingPlatformStep from '@/components/onboarding/OnboardingPlatformStep.vue';

/*
 * Curtain animation durations (ms) — keep in sync with CSS variables
 * CURTAIN_CLOSE : time for blocks to expand (cover the screen)
 * CURTAIN_HOLD  : brief pause at full cover before content swaps
 * CURTAIN_OPEN  : time for blocks to retract (reveal the screen)
 */
const CURTAIN_CLOSE = 800; // rotateIn + blockOut
const CURTAIN_HOLD = 120; // pause at peak coverage
const CURTAIN_OPEN = 800; // rotateOut + blockIn

export default {
  name: 'AppOnboarding',
  components: { OnboardingSetupStep, OnboardingPlatformStep },

  setup() {
    const route = useRoute();
    const router = useRouter();
    const settingsStorage = useStorage('settings');
    const store = useStore();
    const noteStore = useNoteStore();
    const folderStore = useFolderStore();
    const isMacOS =
      typeof window !== 'undefined' &&
      window.navigator.platform.toLowerCase().includes('mac');

    const { runImportSource } = useImportExport({
      clipboard,
      folderStore,
      ipcRenderer,
      isMacOS,
      noteStore,
      storage: settingsStorage,
    });

    const flow = useOnboardingFlow({
      route,
      router,
      store,
      noteStore,
      settingsStorage,
      clipboard,
      ipcRenderer,
      runImportSource,
    });

    // ── Curtain state ────────────────────────────────────────────────────────
    const curtainVisible = ref(false);
    let curtainLocked = false;
    let hasCurtainPlayed = false;

    /**
     * curtainNavigate(targetStep)
     *
     * 1. Close curtain (blocks sweep in)           → CURTAIN_CLOSE ms
     * 2. At peak coverage swap the step            → CURTAIN_HOLD  ms
     * 3. Open curtain (blocks retract)             → CURTAIN_OPEN  ms
     *
     * The curtain animation only plays the first time; after that it falls
     * back to plain goToStep() so returning to previous steps feels instant.
     */
    async function curtainNavigate(targetStep) {
      if (curtainLocked) return;

      if (hasCurtainPlayed) {
        flow.goToStep(targetStep);
        return;
      }

      curtainLocked = true;

      // Phase 1: close
      curtainVisible.value = true;

      await new Promise((r) => setTimeout(r, CURTAIN_CLOSE + CURTAIN_HOLD));

      // Phase 2: swap content while screen is covered
      flow.goToStep(targetStep);
      await nextTick();

      // Keep the curtain closed a little longer so the browser can paint
      // the newly mounted step before we start opening.
      await new Promise((r) => setTimeout(r, CURTAIN_HOLD));

      // Phase 3: open
      curtainVisible.value = false;

      await new Promise((r) => setTimeout(r, CURTAIN_OPEN));
      hasCurtainPlayed = true;
      curtainLocked = false;
    }

    return {
      ...flow,
      curtainVisible,
      curtainNavigate,
    };
  },
};
</script>

<style scoped>
/* ── Contrast tokens ── */
.ob-light .ob-heading-text {
  color: #1a1a1a;
}
.ob-light .ob-body-text {
  color: #555555;
}
.ob-light .ob-label-text {
  color: #888888;
}
.ob-dark .ob-heading-text {
  color: #f0f0f0;
}
.ob-dark .ob-body-text {
  color: #a0a0a0;
}
.ob-dark .ob-label-text {
  color: #6b6b6b;
}

/* ── Background ── */
.ob-light {
  --ob-bg-start: #fde8b0;
  --ob-bg-end: #fff8ee;
}
.ob-dark {
  --ob-bg-start: #1e0e02;
  --ob-bg-end: #3d2008;
}
.ob-bg {
  background: linear-gradient(
    180deg,
    var(--ob-bg-start) 0%,
    var(--ob-bg-end) 100%
  );
}

.ob-shell {
  min-height: 100dvh;
  padding-top: var(--app-safe-area-top);
  padding-right: var(--app-safe-area-right);
  padding-bottom: var(--app-safe-area-bottom);
  padding-left: var(--app-safe-area-left);
}
.ob-screen {
  min-height: calc(
    100dvh - var(--app-safe-area-top) - var(--app-safe-area-bottom)
  );
  padding: 1.5rem;
}
.ob-screen--scroll {
  padding-top: 2rem;
  padding-bottom: 2rem;
}
.ob-floating-action {
  bottom: calc(var(--app-safe-area-bottom) + 1.5rem);
}
.ob-toast-card {
  bottom: calc(var(--app-safe-area-bottom) + 5rem);
}

/* ── Curtain overlay ────────────────────────────────────────────────────── */

/* Curtain colours (adapt to theme) */
.ob-light .ob-curtain__block {
  background: #e8d5a3;
}
.ob-light .ob-curtain__block:nth-child(2) {
  background: #d4bc87;
}
.ob-light .ob-curtain__block:nth-child(3) {
  background: #e8d5a3;
}
.ob-dark .ob-curtain__block {
  background: #2e1a06;
}
.ob-dark .ob-curtain__block:nth-child(2) {
  background: #3d2408;
}
.ob-dark .ob-curtain__block:nth-child(3) {
  background: #2e1a06;
}

.ob-curtain {
  position: fixed;
  inset: 0;
  z-index: 9999;
  display: flex;
  pointer-events: none;
  /* curtain is always mounted; animation classes drive the motion */
}

/* Each half occupies 50% of the viewport */
.ob-curtain__half {
  position: relative;
  width: 50%;
  height: 130%; /* extra height so rotated blocks never show gaps */
  top: -15%;
  overflow: hidden;
}

/* Mirror the right side */
.ob-curtain__half--right {
  transform: scaleX(-1);
}

/* Rotating wrapper — houses the three blocks side-by-side */
.ob-curtain__wrapper {
  display: flex;
  flex-direction: row;
  position: absolute;
  inset: 0;
  transform-origin: top right;
  /* default state: rotated away, blocks hidden */
  transform: rotate(8deg);
}

.ob-curtain__block {
  position: relative;
  width: 0;
  height: 100%;
  flex-shrink: 0;
}

/* ── Closing animation (curtain sweeps in) ── */
.ob-curtain--visible .ob-curtain__wrapper {
  animation: ob-curtain-rotate-in 0.8s cubic-bezier(0.22, 1, 0.36, 1) 0s both;
}

.ob-curtain--visible .ob-curtain__block--3 {
  animation: ob-curtain-block-out 0.7s ease-in-out 0s both;
}
.ob-curtain--visible .ob-curtain__block--2 {
  animation: ob-curtain-block-out 0.7s ease-in-out 0.1s both;
}
.ob-curtain--visible .ob-curtain__block--1 {
  animation: ob-curtain-block-out 0.7s ease-in-out 0.2s both;
}

/* ── Opening animation (curtain retracts) ── */
/* We use a separate wrapper class to avoid fighting Vue's reactivity */
.ob-curtain:not(.ob-curtain--visible) .ob-curtain__wrapper {
  animation: ob-curtain-rotate-out 0.8s cubic-bezier(0.22, 1, 0.36, 1) 0s
    both;
}
.ob-curtain:not(.ob-curtain--visible) .ob-curtain__block--3 {
  animation: ob-curtain-block-in 0.7s ease-in-out 0s both;
}
.ob-curtain:not(.ob-curtain--visible) .ob-curtain__block--2 {
  animation: ob-curtain-block-in 0.7s ease-in-out 0.1s both;
}
.ob-curtain:not(.ob-curtain--visible) .ob-curtain__block--1 {
  animation: ob-curtain-block-in 0.7s ease-in-out 0.2s both;
}

/* ── Keyframes ── */
@keyframes ob-curtain-rotate-in {
  from {
    transform: rotate(8deg);
  }
  to {
    transform: rotate(0deg);
  }
}
@keyframes ob-curtain-rotate-out {
  from {
    transform: rotate(0deg);
  }
  to {
    transform: rotate(8deg);
  }
}
@keyframes ob-curtain-block-out {
  from {
    width: 0;
  }
  to {
    width: 33.34%;
  }
}
@keyframes ob-curtain-block-in {
  from {
    width: 33.34%;
  }
  to {
    width: 0;
  }
}

/* ── Welcome entrance ── */
.ob-logo {
  opacity: 0;
  transform: translateY(-14px) scale(0.985);
  transition: opacity 0.28s ease, transform 0.4s cubic-bezier(0.22, 1, 0.36, 1);
}
.ob-logo--in {
  opacity: 1;
  transform: none;
}
.ob-eyebrow {
  transform: translateY(110%);
  transition: transform 0.42s cubic-bezier(0.22, 1, 0.36, 1);
}
.ob-headline--in .ob-eyebrow {
  transform: translateY(0);
}
.ob-title {
  transform: translateY(110%);
  transition: transform 0.48s cubic-bezier(0.22, 1, 0.36, 1) 0.04s;
}
.ob-headline--in .ob-title {
  transform: translateY(0);
}
.ob-below {
  opacity: 0;
  transform: translateY(10px);
  transition: opacity 0.26s ease, transform 0.34s cubic-bezier(0.22, 1, 0.36, 1);
}
.ob-below--in {
  opacity: 1;
  transform: none;
}

/* ── Finish entrance ── */
.ob-finish {
  opacity: 0;
  transform: translateY(12px);
  transition: opacity 0.3s ease, transform 0.38s cubic-bezier(0.22, 1, 0.36, 1);
}
.ob-finish--in {
  opacity: 1;
  transform: none;
}

/* ── Toast ── */
.ob-toast-enter-active,
.ob-toast-leave-active {
  transition: opacity 0.25s ease, transform 0.25s ease;
}
.ob-toast-enter-from,
.ob-toast-leave-to {
  opacity: 0;
  transform: translateX(-50%) translateY(4px);
}

/* ── Confetti ── */
.ob-confetti__bit {
  width: var(--cw);
  height: var(--ch);
  background: var(--cc);
  border-radius: var(--cbr);
  opacity: 0;
  animation: ob-pop var(--cdur) cubic-bezier(0.16, 0.82, 0.29, 1) var(--cd)
    forwards;
}
.ob-confetti__bit:nth-child(odd) {
  left: var(--co);
}
.ob-confetti__bit:nth-child(even) {
  right: var(--co);
}
@keyframes ob-pop {
  0% {
    opacity: 0;
    transform: translate(0, 0) rotate(0deg) scale(0.7);
  }
  10% {
    opacity: 1;
  }
  100% {
    opacity: 0;
    transform: translate(var(--cx), calc(-1 * var(--cy))) rotate(var(--cr))
      scale(1);
  }
}

/* ── Reduced motion ── */
@media (prefers-reduced-motion: reduce) {
  .ob-curtain__wrapper,
  .ob-curtain__block,
  .ob-confetti__bit {
    animation-duration: 0.01ms !important;
    animation-delay: 0ms !important;
  }
  .ob-logo,
  .ob-eyebrow,
  .ob-title,
  .ob-below,
  .ob-finish,
  .ob-toast-enter-active,
  .ob-toast-leave-active {
    transition-duration: 0.01ms !important;
  }
}
</style>
