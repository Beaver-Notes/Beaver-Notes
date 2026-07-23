<template>
  <div
    class="ob-shell relative overflow-x-hidden overflow-y-auto flex items-center justify-center antialiased select-none"
    :class="isDark ? 'ob-dark' : 'ob-light'"
    :style="{ fontFamily: 'var(--selected-font, sans-serif)' }"
  >
    <div class="ob-bg fixed inset-0 z-0" aria-hidden="true"></div>
    <div
      class="ob-curtain"
      :class="{ 'ob-curtain--open': curtainOpen }"
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
    <div :key="step" class="ob-page-content relative z-10 w-full">
      <!-- ── Welcome ── -->
      <div
        v-if="step === 'welcome'"
        class="ob-screen flex flex-col items-center justify-center gap-8 mobile:gap-0 w-full mobile:p-1"
      >
        <div
          class="mobile:flex-1 mobile:flex mobile:flex-col mobile:items-center mobile:justify-center w-full"
        >
          <div
            class="flex flex-col items-center gap-6 text-center max-w-md w-full mx-auto"
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
                <h1
                  class="ob-title text-5xl font-bold tracking-tight leading-none text-neutral-800 dark:text-neutral-200"
                >
                  Meet Beaver Notes
                </h1>
              </div>
            </div>

            <div
              class="ob-below flex flex-col items-center gap-4"
              :class="{ 'ob-below--in': ctaIn }"
            >
              <p
                class="text-base leading-relaxed text-neutral-600 dark:text-neutral-400 max-w-sm"
              >
                Lets start by customizing your settings, or use the defaults.
              </p>
            </div>
          </div>
        </div>

        <div
          class="flex flex-wrap mobile:flex-col mobile:w-full mobile:items-stretch mobile:px-4 ob-bottom-nav justify-center gap-3"
        >
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

        <div
          v-if="state.status?.hasLegacyData && !isMobileRuntime"
          class="fixed z-20 bottom-[calc(var(--app-safe-area-bottom)+1.5rem)]"
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
        class="ob-screen flex flex-col items-center justify-center mobile:justify-end w-full"
      >
        <ui-card class="w-full max-w-lg max-h-[80dvh] flex flex-col">
          <div
            class="flex flex-col items-center gap-2 my-8 text-center shrink-0"
          >
            <h2
              class="text-3xl font-semibold tracking-tight text-neutral-800 dark:text-neutral-200"
            >
              How do you want to begin?
            </h2>
            <p class="text-neutral-600 dark:text-neutral-400">
              Start fresh or bring over your notes from another app.
            </p>
          </div>

          <div class="flex flex-col gap-2 overflow-y-auto flex-1 min-h-0">
            <ui-card
              tag="button"
              padding="p-0"
              class="w-full text-left"
              @click="chooseMode('fresh')"
            >
              <div class="flex items-center gap-4 p-4">
                <div
                  class="shrink-0 w-10 h-10 rounded-xl bg-primary/10 text-primary flex items-center justify-center"
                >
                  <v-remixicon name="riStarFill" />
                </div>
                <div class="flex-1 min-w-0">
                  <h3
                    class="font-semibold text-sm text-neutral-800 dark:text-neutral-200"
                  >
                    Start fresh
                  </h3>
                  <p
                    class="text-sm text-neutral-600 dark:text-neutral-400 mt-0.5"
                  >
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
              class="w-full text-left mobile:max-w-full mobile:rounded-t-[1.25rem] mobile:rounded-b-none mobile:border-x-0 mobile:border-b-0 mobile:shadow-sm"
              @click="chooseMode('migration')"
            >
              <div class="flex items-center gap-4 p-4">
                <div
                  class="shrink-0 w-10 h-10 rounded-xl bg-primary/10 text-primary flex items-center justify-center"
                >
                  <v-remixicon name="riSendPlaneFill" />
                </div>
                <div class="flex-1 min-w-0">
                  <h3
                    class="font-semibold text-sm text-neutral-800 dark:text-neutral-200"
                  >
                    Import from apps
                  </h3>
                  <p
                    class="text-sm text-neutral-600 dark:text-neutral-400 mt-0.5"
                  >
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

          <div class="mt-5 shrink-0">
            <ui-button @click="curtainNavigate('welcome')">
              <v-remixicon name="riArrowLeftLine" /> Back
            </ui-button>
          </div>
        </ui-card>
      </div>

      <!-- ── Setup ── -->
      <div
        v-else-if="step === 'setup'"
        class="ob-screen flex flex-col items-center justify-center mobile:justify-end w-full"
      >
        <onboarding-setup-step
          :fresh="fresh"
          :themes="themes"
          :theme-labels="themeLabels"
          :accent-colors="accentColors"
          :interface-sizes="interfaceSizes"
          :fonts="fonts"
          :languages="languages"
          :sounds-enabled="fresh.soundsEnabled"
          :spotlight-enabled="fresh.spotlightEnabled"
          :is-mobile-runtime="isMobileRuntime"
          @select-theme="selectTheme"
          @select-accent="selectAccentColor"
          @update-font="selectFont($event)"
          @update-language="selectLanguage($event)"
          @update-sounds="selectSounds($event)"
          @update-spotlight="selectSpotlight($event)"
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

      <!-- ── Encryption password ── -->
      <div
        v-else-if="step === 'password'"
        class="ob-screen flex flex-col items-center justify-center w-full pt-8 pb-8"
      >
        <onboarding-password-step
          v-model="encryptionPassword"
          :confirm-value="encryptionConfirmPassword"
          :error="encryptionPasswordError"
          :loading="encryptionPasswordLoading"
          @update:confirm-value="encryptionConfirmPassword = $event"
        >
          <template #next>
            <ui-button
              variant="primary"
              :loading="encryptionPasswordLoading"
              @click="setupEncryptionPassword"
            >
              <template v-if="!encryptionPasswordLoading">
                Continue <v-remixicon name="riArrowRightLine" />
              </template>
            </ui-button>
          </template>
        </onboarding-password-step>
      </div>

      <!-- ── Sync ── -->
      <OnboardingSyncStep
        v-else-if="step === 'sync'"
        :sync-path="fresh.syncPath"
        :auto-sync="fresh.autoSync"
        :saving-preferences="state.savingPreferences"
        @choose-sync-path="chooseSyncPath"
        @clear-sync-path="clearSyncPath"
        @toggle-auto-sync="toggleAutoSync"
        @finish-fresh-onboarding="finishFreshOnboarding"
        @back="curtainNavigate('setup')"
      />

      <!-- ── Platform ── -->
      <div
        v-else-if="step === 'platform'"
        class="ob-screen flex flex-col items-center justify-center w-full pt-8 pb-8"
      >
        <onboarding-platform-step
          v-model="migrationPlatform"
          :is-mac-o-s="isMacOS"
          :logo-url="logoUrl"
          @select="selectMigrationPlatform"
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
      <OnboardingMigrationStep
        v-else-if="step === 'migration'"
        :migration-platform-label="migrationPlatformLabel"
        :migration-source-heading="migrationSourceHeading"
        :migration-source-copy="migrationSourceCopy"
        :migration-platform="migrationPlatform"
        :migration-what-gets-copied="migrationWhatGetsCopied"
        :migration-action-disabled="migrationActionDisabled"
        :migrating="state.migrating"
        :migration-done="state.migrationDone"
        :migration-progress="state.migrationProgress"
        :migration-status="state.migrationStatus"
        :migration-current="state.migrationCurrent"
        :migration-result="state.migrationResult"
        :migration-issues-text="state.migrationIssuesText"
        :status="state.status"
        :custom-legacy-path="customLegacyPath"
        :evernote-notebook-name="state.evernoteNotebookName"
        @update:evernote-notebook-name="state.evernoteNotebookName = $event"
        @run-migration="runSelectedMigration"
        @copy-issues="copyMigrationIssues"
        @browse-portable="browseForPortableData"
        @back="curtainNavigate('platform')"
        @continue="goToNextStep"
      />

      <!-- ── Legacy Password ── -->
      <OnboardingLegacyPasswordStep
        v-else-if="step === 'legacyPassword'"
        v-model="legacyPasswordValue"
        :error="state.legacyPasswordError"
        :loading="state.legacyPasswordLoading"
        @submit="submitLegacyPassword"
        @skip="skipLegacyPassword"
        @back="curtainNavigate('platform')"
      />

      <!-- ── Finish ── -->
      <div
        v-else
        class="ob-screen flex flex-col items-center justify-center gap-8 mobile:gap-0 w-full mobile:p-1"
      >
        <div
          class="mobile:flex-1 mobile:flex mobile:flex-col mobile:items-center mobile:justify-center w-full"
        >
          <div
            class="flex flex-col items-center gap-5 text-center max-w-md w-full mx-auto ob-finish"
            :class="{ 'ob-finish--in': finishIn }"
          >
            <img
              :src="logoUrl"
              alt="Beaver Notes"
              class="w-24 h-24 object-contain drop-shadow-xl"
            />
            <div class="flex flex-col items-center gap-2">
              <h1
                class="text-5xl font-bold tracking-tight leading-none text-neutral-800 dark:text-neutral-200"
              >
                Ready, Set, Go!
              </h1>
              <p
                class="text-base leading-relaxed text-neutral-600 dark:text-neutral-400 max-w-sm"
              >
                You've successfully completed the onboarding process. It's time
                to meet your notes.
              </p>
            </div>
          </div>
        </div>

        <div
          class="flex flex-wrap mobile:flex-col mobile:w-full mobile:items-stretch mobile:px-4 ob-bottom-nav justify-center gap-3"
        >
          <ui-button @click="goToPreviousStep">
            <v-remixicon name="riArrowLeftLine" /> Back
          </ui-button>
          <ui-button
            variant="primary"
            :loading="state.openingWorkspace"
            @click="completeAndOpenWorkspace"
          >
            <template v-if="!state.openingWorkspace">
              <v-remixicon name="riCheckLine" class="mr-1" /> Open Beaver Notes
            </template>
          </ui-button>
        </div>
      </div>
    </div>
    <!-- /ob-page-content -->

    <!-- Error toast -->
    <Transition name="ob-toast">
      <div
        v-if="state.error"
        class="fixed left-1/2 -translate-x-1/2 z-50 w-[calc(100%-2rem)] max-w-lg px-4 py-3 rounded-xl text-sm text-center backdrop-blur bg-red-50/80 text-red-700 ring-1 ring-red-200 dark:bg-red-950/40 dark:text-red-300 dark:ring-red-800 bottom-[calc(var(--app-safe-area-bottom)+5rem)]"
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
import { ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useStorage } from '@/composable/storage';
import { useImportExport } from '@/composable/useImportExport';
import { useStore } from '@/store';
import { useNoteStore } from '@/store/note';
import { useFolderStore } from '@/store/folder';
import { usePasswordStore } from '@/store/passwd';
import { backend, clipboard } from '@/lib/tauri-bridge';
import { useSounds } from '@/composable/useSounds';
import { useOnboardingFlow } from '@/composable/useOnboardingFlow';
import OnboardingSetupStep from '@/components/onboarding/OnboardingSetupStep.vue';
import OnboardingPlatformStep from '@/components/onboarding/OnboardingPlatformStep.vue';
import OnboardingSyncStep from '@/components/onboarding/OnboardingSyncStep.vue';
import OnboardingPasswordStep from '@/components/onboarding/OnboardingPasswordStep.vue';
import OnboardingMigrationStep from '@/components/onboarding/OnboardingMigrationStep.vue';
import OnboardingLegacyPasswordStep from '@/components/onboarding/OnboardingLegacyPasswordStep.vue';

const CURTAIN_DURATIONS = {
  close: 1200,
  hold: 900,
  open: 1200,
};

const {
  close: CURTAIN_CLOSE,
  hold: CURTAIN_HOLD,
  open: CURTAIN_OPEN,
} = CURTAIN_DURATIONS;

export default {
  name: 'AppOnboarding',
  components: {
    OnboardingSetupStep,
    OnboardingPlatformStep,
    OnboardingSyncStep,
    OnboardingMigrationStep,
    OnboardingLegacyPasswordStep,
    OnboardingPasswordStep,
  },

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
      runImportSource,
    });

    const curtainOpen = ref(false);
    let curtainLocked = false;
    let hasCurtainPlayed = false;
    const { play } = useSounds();

    const prefersReducedMotion = () =>
      typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

    const passwordStore = usePasswordStore();
    const legacyPasswordValue = ref('');

    async function submitLegacyPassword() {
      if (!legacyPasswordValue.value) return;
      const result = await flow.handleLegacyPasswordSubmit(
        legacyPasswordValue.value,
        passwordStore
      );
      if (result.success) {
        legacyPasswordValue.value = '';
        await curtainNavigate('migration');
      }
    }

    async function skipLegacyPassword() {
      legacyPasswordValue.value = '';
      flow.handleLegacyPasswordSkip();
      await curtainNavigate('migration');
    }

    // ── Intro curtain on first load ────────────────────────────────────
    // Starts closed (covering the screen by default), then opens
    // once with a slow retract animation synced to the intro sound.
    (async function playIntroCurtain() {
      if (prefersReducedMotion()) {
        hasCurtainPlayed = true;
        return;
      }

      curtainLocked = true;

      // Brief pause before the reveal
      await new Promise((r) => setTimeout(r, CURTAIN_HOLD));

      // Play the intro sound as the curtain begins to open
      play('intro');
      curtainOpen.value = true;

      await new Promise((r) => setTimeout(r, CURTAIN_OPEN));
      hasCurtainPlayed = true;
      curtainLocked = false;
    })();

    async function curtainNavigate(targetStep) {
      if (curtainLocked) return;

      const actualStep =
        targetStep === 'migration' && flow.state.legacyHasLockedNotes
          ? 'legacyPassword'
          : targetStep;

      // Curtain only plays on first load — subsequent navigation is instant
      flow.goToStep(actualStep);
    }

    return {
      ...flow,
      curtainOpen,
      curtainNavigate,
      legacyPasswordValue,
      submitLegacyPassword,
      skipLegacyPassword,
    };
  },
};
</script>

<style scoped>
/* ── Background ── */
.ob-light {
  --ob-bg-start: theme('colors.amber.50');
  --ob-bg-end: theme('colors.amber.50');
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

@media (max-width: 767px) {
  .ob-screen {
    padding: 0;
  }

  .ob-bottom-nav {
    padding-bottom: max(
      var(--app-safe-area-bottom, 0px),
      env(safe-area-inset-bottom, 0px),
      1rem
    );
  }
}

/* ── Curtain overlay ────────────────────────────────────────────────────── */

/* Curtain colours (adapt to theme) */
.ob-light .ob-curtain__block {
  background: theme('colors.amber.200');
}
.ob-light .ob-curtain__block:nth-child(2) {
  background: theme('colors.amber.300');
}
.ob-light .ob-curtain__block:nth-child(3) {
  background: theme('colors.amber.200');
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
}

/* Each half occupies 50% of the viewport */
.ob-curtain__half {
  position: relative;
  width: 50%;
  height: 130%;
  top: -15%;
  overflow: hidden;
}

.ob-curtain__half--right {
  transform: scaleX(-1);
}

/* ── Default state: curtain closed (covers the screen) ── */
.ob-curtain__wrapper {
  display: flex;
  flex-direction: row;
  position: absolute;
  inset: 0;
  transform-origin: top right;
  transform: rotate(0deg);
  transition: transform 1.25s cubic-bezier(0.16, 1, 0.3, 1);
  will-change: transform;
}

.ob-curtain__block {
  position: relative;
  width: 33.34%;
  height: 100%;
  flex-shrink: 0;
  transition: width 1.05s cubic-bezier(0.22, 0.8, 0.2, 1);
  will-change: width;
}

/* ── Opening: curtain retracts ── */
.ob-curtain--open .ob-curtain__wrapper {
  transform: rotate(8deg);
}
.ob-curtain--open .ob-curtain__block--3 {
  width: 0;
  transition-delay: 0.1s;
}
.ob-curtain--open .ob-curtain__block--2 {
  width: 0;
  transition-delay: 0.15s;
}
.ob-curtain--open .ob-curtain__block--1 {
  width: 0;
  transition-delay: 0.3s;
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
  .ob-curtain__block {
    transition-duration: 0.01ms !important;
    transition-delay: 0ms !important;
  }
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
