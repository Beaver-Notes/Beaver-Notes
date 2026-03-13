<template>
  <div
    class="relative min-h-screen overflow-hidden flex items-center justify-center font-sans antialiased select-none"
    :class="isDark ? 'ob-dark' : 'ob-light'"
  >
    <!-- Background -->
    <div class="ob-bg fixed inset-0 z-0" aria-hidden="true"></div>

    <Transition name="ob-page" mode="out-in">
      <!-- ── Welcome ── -->
      <div
        v-if="step === 'welcome'"
        key="welcome"
        class="relative z-10 flex flex-col items-center justify-center min-h-screen w-full p-6"
      >
        <div
          class="flex flex-col items-center gap-6 text-center max-w-md w-full"
        >
          <img
            :src="logoUrl"
            alt="Beaver Notes"
            class="w-20 h-20 object-contain drop-shadow-xl ob-logo"
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
              <ui-button variant="primary" @click="setStep('path')">
                Continue
                <v-remixicon name="riArrowRightLine" />
              </ui-button>
            </div>
          </div>
        </div>

        <!-- Legacy button pinned to bottom centre -->
        <div v-if="state.status?.hasLegacyData" class="fixed bottom-6 z-20">
          <ui-button @click="openMigrationFlow">
            <v-remixicon name="riSendPlaneFill" class="mr-1" />
            Import from Beaver Notes (Legacy)
          </ui-button>
        </div>
      </div>

      <!-- ── Path ── -->
      <div
        v-else-if="step === 'path'"
        key="path"
        class="relative z-10 flex flex-col items-center justify-center min-h-screen w-full p-6"
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
            <ui-button @click="goToStep('welcome')">
              <v-remixicon name="riArrowLeftLine" /> Back
            </ui-button>
          </div>
        </ui-card>
      </div>

      <!-- ── Setup ── -->
      <div
        v-else-if="step === 'setup'"
        key="setup"
        class="relative z-10 flex flex-col items-center justify-center min-h-screen w-full p-6"
      >
        <ui-card class="w-full max-w-lg">
          <div class="flex flex-col items-center gap-2 my-8 text-center">
            <h2 class="text-3xl font-semibold tracking-tight ob-heading-text">
              Your starting defaults
            </h2>
            <p class="ob-body-text">
              These can be changed from Settings at any time.
            </p>
          </div>

          <div class="flex flex-col gap-4">
            <!-- Appearance -->
            <div class="flex flex-col gap-2">
              <p
                class="text-xs font-bold uppercase tracking-widest ob-label-text"
              >
                Appearance
              </p>
              <div
                class="grid grid-cols-3 gap-3 w-full text-neutral-600 dark:text-neutral-300"
              >
                <button
                  v-for="item in themes"
                  :key="item.name"
                  type="button"
                  class="bg-input p-2 rounded-lg transition-all w-full"
                  :class="
                    fresh.theme === item.name ? 'ring-1 ring-primary' : ''
                  "
                  @click="selectTheme(item.name)"
                >
                  <img
                    :src="item.img"
                    :alt="item.label"
                    class="w-full border-2 mb-1 rounded-lg"
                  />
                  <p class="capitalize text-center text-sm ob-heading-text">
                    {{ themeLabels[item.name] || item.label }}
                  </p>
                </button>
              </div>
            </div>

            <!-- Language -->
            <div class="flex flex-col gap-2">
              <p
                class="text-xs font-bold uppercase tracking-widest ob-label-text"
              >
                Language
              </p>
              <ui-select v-model="fresh.language" :options="languages" block />
            </div>

            <!-- Behaviour -->
            <div class="flex flex-col gap-2">
              <p
                class="text-xs font-bold uppercase tracking-widest ob-label-text"
              >
                Behaviour
              </p>
              <ui-card>
                <button
                  class="flex items-center justify-between w-full px-4 py-3 text-left"
                  @click="fresh.spellcheckEnabled = !fresh.spellcheckEnabled"
                >
                  <div>
                    <span class="block text-sm font-semibold ob-heading-text"
                      >Spell check</span
                    >
                    <span class="block text-xs ob-body-text mt-0.5"
                      >Underline mistakes as you type.</span
                    >
                  </div>
                  <ui-switch v-model="fresh.spellcheckEnabled" />
                </button>
                <button
                  class="flex items-center justify-between w-full px-4 py-3 text-left border-t border-neutral-100 dark:border-neutral-800"
                  @click="fresh.openLastEdited = !fresh.openLastEdited"
                >
                  <div>
                    <span class="block text-sm font-semibold ob-heading-text"
                      >Open last edited note</span
                    >
                    <span class="block text-xs ob-body-text mt-0.5"
                      >Resume where you left off.</span
                    >
                  </div>
                  <ui-switch v-model="fresh.openLastEdited" />
                </button>
                <button
                  class="flex items-center justify-between w-full px-4 py-3 text-left border-t border-neutral-100 dark:border-neutral-800"
                  @click="fresh.openAfterCreation = !fresh.openAfterCreation"
                >
                  <div>
                    <span class="block text-sm font-semibold ob-heading-text"
                      >Open note after creation</span
                    >
                    <span class="block text-xs ob-body-text mt-0.5"
                      >Jump into a new note instantly.</span
                    >
                  </div>
                  <ui-switch v-model="fresh.openAfterCreation" />
                </button>
              </ui-card>
            </div>
          </div>

          <div class="mt-5 flex justify-between gap-4">
            <ui-button @click="goToStep('path')">
              <v-remixicon name="riArrowLeftLine" /> Back
            </ui-button>
            <ui-button
              variant="primary"
              :loading="state.savingPreferences"
              @click="prepareFreshWorkspace"
            >
              <template v-if="!state.savingPreferences">
                Continue <v-remixicon name="riArrowRightLine" />
              </template>
            </ui-button>
          </div>
        </ui-card>
      </div>

      <!-- ── Platform ── -->
      <div
        v-else-if="step === 'platform'"
        key="platform"
        class="relative z-10 flex flex-col items-center justify-center min-h-screen w-full p-6"
      >
        <ui-card class="w-full max-w-lg">
          <div class="flex flex-col items-center gap-2 my-8 text-center">
            <h2 class="text-3xl font-semibold tracking-tight ob-heading-text">
              Import from apps
            </h2>
            <p class="ob-body-text">
              Choose which app to migrate from before reviewing the import
              details.
            </p>
          </div>

          <div class="flex flex-col gap-2">
            <!-- Beaver Notes Legacy -->
            <ui-card
              tag="button"
              padding="p-0"
              class="w-full text-left"
              :class="
                migrationPlatform === 'electron' ? 'ring-2 ring-primary' : ''
              "
              @click="selectMigrationPlatform('electron')"
            >
              <div class="flex items-center gap-4 p-4">
                <div
                  class="shrink-0 w-10 h-10 rounded-lg flex items-center justify-center"
                  style="background: rgba(245, 158, 11, 0.12)"
                >
                  <img
                    :src="logoUrl"
                    alt="Beaver Notes"
                    class="w-6 h-6 object-contain"
                  />
                </div>
                <div class="flex-1 min-w-0">
                  <div class="flex items-center gap-2 mb-0.5">
                    <h3 class="font-semibold text-sm ob-heading-text">
                      Beaver Notes
                    </h3>
                    <span
                      class="inline-flex items-center rounded-full bg-amber-500/10 text-amber-700 dark:text-amber-300 text-[0.65rem] font-bold uppercase tracking-wide px-2 py-0.5"
                      >Legacy</span
                    >
                  </div>
                  <p class="text-sm ob-body-text">
                    Bring over your original Beaver Notes workspace.
                  </p>
                </div>
                <v-remixicon
                  v-if="migrationPlatform === 'electron'"
                  name="riCheckLine"
                  class="shrink-0 text-primary"
                />
                <v-remixicon
                  v-else
                  name="riArrowRightLine"
                  class="shrink-0 opacity-30"
                />
              </div>
            </ui-card>

            <!-- Obsidian -->
            <ui-card
              tag="button"
              padding="p-0"
              class="w-full text-left"
              :class="
                migrationPlatform === 'obsidian' ? 'ring-2 ring-primary' : ''
              "
              @click="selectMigrationPlatform('obsidian')"
            >
              <div class="flex items-center gap-4 p-4">
                <div
                  class="shrink-0 w-10 h-10 rounded-lg flex items-center justify-center"
                  style="background: rgba(124, 96, 215, 0.12)"
                >
                  <v-remixicon name="obsidian" class="w-6 h-6 text-[#7C60D7]" />
                </div>
                <div class="flex-1 min-w-0">
                  <h3 class="font-semibold text-sm ob-heading-text">
                    Obsidian
                  </h3>
                  <p class="text-sm ob-body-text">
                    Import your vault's markdown notes and attachments.
                  </p>
                </div>
                <v-remixicon
                  v-if="migrationPlatform === 'obsidian'"
                  name="riCheckLine"
                  class="shrink-0 text-primary"
                />
                <v-remixicon
                  v-else
                  name="riArrowRightLine"
                  class="shrink-0 opacity-30"
                />
              </div>
            </ui-card>

            <!-- Apple Notes -->
            <ui-card
              v-if="isMacOS"
              tag="button"
              padding="p-0"
              class="w-full text-left"
              :class="
                migrationPlatform === 'apple-notes' ? 'ring-2 ring-primary' : ''
              "
              @click="selectMigrationPlatform('apple-notes')"
            >
              <div class="flex items-center gap-4 p-4">
                <div
                  class="shrink-0 w-10 h-10 rounded-lg flex items-center justify-center"
                  style="background: rgba(255, 204, 0, 0.15)"
                >
                  <v-remixicon
                    name="riAppleFill"
                    class="w-5 h-5 text-primary"
                  />
                </div>
                <div class="flex-1 min-w-0">
                  <h3 class="font-semibold text-sm ob-heading-text">
                    Apple Notes
                  </h3>
                  <p class="text-sm ob-body-text">
                    Import notes exported from Apple Notes.
                  </p>
                </div>
                <v-remixicon
                  v-if="migrationPlatform === 'apple-notes'"
                  name="riCheckLine"
                  class="shrink-0 text-primary"
                />
                <v-remixicon
                  v-else
                  name="riArrowRightLine"
                  class="shrink-0 opacity-30"
                />
              </div>
            </ui-card>

            <!-- Bear -->
            <ui-card
              tag="button"
              padding="p-0"
              class="w-full text-left"
              :class="migrationPlatform === 'bear' ? 'ring-2 ring-primary' : ''"
              @click="selectMigrationPlatform('bear')"
            >
              <div class="flex items-center gap-4 p-4">
                <div
                  class="shrink-0 w-10 h-10 rounded-lg flex items-center justify-center"
                  style="background: rgba(234, 88, 12, 0.12)"
                >
                  <v-remixicon name="bear" class="w-6 h-6 text-[#EA581C]" />
                </div>
                <div class="flex-1 min-w-0">
                  <h3 class="font-semibold text-sm ob-heading-text">Bear</h3>
                  <p class="text-sm ob-body-text">
                    Import Bear notes exported as markdown files.
                  </p>
                </div>
                <v-remixicon
                  v-if="migrationPlatform === 'bear'"
                  name="riCheckLine"
                  class="shrink-0 text-primary"
                />
                <v-remixicon
                  v-else
                  name="riArrowRightLine"
                  class="shrink-0 opacity-30"
                />
              </div>
            </ui-card>

            <!-- Simplenote -->
            <ui-card
              tag="button"
              padding="p-0"
              class="w-full text-left"
              :class="
                migrationPlatform === 'simplenote' ? 'ring-2 ring-primary' : ''
              "
              @click="selectMigrationPlatform('simplenote')"
            >
              <div class="flex items-center gap-4 p-4">
                <div
                  class="shrink-0 w-10 h-10 rounded-lg flex items-center justify-center"
                  style="background: rgba(59, 130, 246, 0.12)"
                >
                  <v-remixicon name="simpleNote" />
                </div>
                <div class="flex-1 min-w-0">
                  <h3 class="font-semibold text-sm ob-heading-text">
                    Simplenote
                  </h3>
                  <p class="text-sm ob-body-text">
                    Import notes from a Simplenote JSON export.
                  </p>
                </div>
                <v-remixicon
                  v-if="migrationPlatform === 'simplenote'"
                  name="riCheckLine"
                  class="shrink-0 text-primary"
                />
                <v-remixicon
                  v-else
                  name="riArrowRightLine"
                  class="shrink-0 opacity-30"
                />
              </div>
            </ui-card>

            <!-- Markdown files -->
            <ui-card
              tag="button"
              padding="p-0"
              class="w-full text-left"
              :class="
                migrationPlatform === 'markdown' ? 'ring-2 ring-primary' : ''
              "
              @click="selectMigrationPlatform('markdown')"
            >
              <div class="flex items-center gap-4 p-4">
                <div
                  class="shrink-0 w-10 h-10 rounded-lg flex items-center justify-center bg-neutral-400/10"
                >
                  <v-remixicon
                    name="riMarkdownLine"
                    class="w-6 h-6 text-neutral-600 dark:text-neutral-300"
                  />
                </div>
                <div class="flex-1 min-w-0">
                  <h3 class="font-semibold text-sm ob-heading-text">
                    Markdown files
                  </h3>
                  <p class="text-sm ob-body-text">
                    Import a folder of plain .md files from any source.
                  </p>
                </div>
                <v-remixicon
                  v-if="migrationPlatform === 'markdown'"
                  name="riCheckLine"
                  class="shrink-0 text-primary"
                />
                <v-remixicon
                  v-else
                  name="riArrowRightLine"
                  class="shrink-0 opacity-30"
                />
              </div>
            </ui-card>

            <!-- Evernote -->
            <ui-card
              tag="button"
              padding="p-0"
              class="w-full text-left"
              :class="
                migrationPlatform === 'evernote' ? 'ring-2 ring-primary' : ''
              "
              @click="selectMigrationPlatform('evernote')"
            >
              <div class="flex items-center gap-4 p-4">
                <div
                  class="shrink-0 w-10 h-10 rounded-lg flex items-center justify-center"
                  style="background: rgba(0, 165, 80, 0.12)"
                >
                  <v-remixicon
                    name="riEvernoteFill"
                    class="w-6 h-6 text-[#00A550]"
                  />
                </div>
                <div class="flex-1 min-w-0">
                  <h3 class="font-semibold text-sm ob-heading-text">
                    Evernote
                  </h3>
                  <p class="text-sm ob-body-text">
                    Import notes from an Evernote ENEX export file.
                  </p>
                </div>
                <v-remixicon
                  v-if="migrationPlatform === 'evernote'"
                  name="riCheckLine"
                  class="shrink-0 text-primary"
                />
                <v-remixicon
                  v-else
                  name="riArrowRightLine"
                  class="shrink-0 opacity-30"
                />
              </div>
            </ui-card>

            <!-- Notion -->
            <ui-card
              tag="button"
              padding="p-0"
              class="w-full text-left"
              :class="
                migrationPlatform === 'notion' ? 'ring-2 ring-primary' : ''
              "
              @click="selectMigrationPlatform('notion')"
            >
              <div class="flex items-center gap-4 p-4">
                <div
                  class="shrink-0 w-10 h-10 rounded-lg flex items-center justify-center bg-neutral-900/10 dark:bg-white/10"
                >
                  <v-remixicon
                    name="riNotionFill"
                    class="w-6 h-6 text-neutral-900 dark:text-white"
                  />
                </div>
                <div class="flex-1 min-w-0">
                  <h3 class="font-semibold text-sm ob-heading-text">Notion</h3>
                  <p class="text-sm ob-body-text">
                    Import pages exported from Notion as markdown.
                  </p>
                </div>
                <v-remixicon
                  v-if="migrationPlatform === 'notion'"
                  name="riCheckLine"
                  class="shrink-0 text-primary"
                />
                <v-remixicon
                  v-else
                  name="riArrowRightLine"
                  class="shrink-0 opacity-30"
                />
              </div>
            </ui-card>
          </div>

          <div class="mt-5 flex justify-between gap-4">
            <ui-button @click="goToStep('path')">
              <v-remixicon name="riArrowLeftLine" /> Back
            </ui-button>
            <ui-button
              variant="primary"
              :disabled="!migrationPlatform"
              @click="goToStep('migration')"
            >
              Continue <v-remixicon name="riArrowRightLine" />
            </ui-button>
          </div>
        </ui-card>
      </div>

      <!-- ── Migration ── -->
      <div
        v-else-if="step === 'migration'"
        key="migration"
        class="relative z-10 flex flex-col items-center justify-center min-h-screen w-full p-6"
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
                  <p class="text-sm ob-body-text">
                    {{ migrationSourceCopy }}
                  </p>
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
                (state.status?.legacyDir || state.status?.appDataDir)
              "
              class="bg-input"
            >
              <div class="flex flex-col gap-4 p-4">
                <div v-if="state.status?.legacyDir" class="flex flex-col gap-1">
                  <span
                    class="text-xs font-bold uppercase tracking-widest ob-label-text"
                    >Beaver Notes (Legacy)</span
                  >
                  <code
                    class="text-xs font-mono break-all px-2 py-1.5 rounded-md bg-neutral-100 dark:bg-neutral-800 text-neutral-600 dark:text-neutral-300"
                    >{{ state.status.legacyDir }}</code
                  >
                </div>
                <div
                  v-if="state.status?.appDataDir"
                  class="flex flex-col gap-1"
                >
                  <span
                    class="text-xs font-bold uppercase tracking-widest ob-label-text"
                    >New Beaver Notes</span
                  >
                  <code
                    class="text-xs font-mono break-all px-2 py-1.5 rounded-md bg-neutral-100 dark:bg-neutral-800 text-neutral-600 dark:text-neutral-300"
                    >{{ state.status.appDataDir }}</code
                  >
                </div>
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
              @click="goToStep('platform')"
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
              @click="setStep('finish')"
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
        key="finish"
        class="relative z-10 flex flex-col items-center justify-center min-h-screen w-full p-6"
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
    </Transition>

    <!-- Error toast -->
    <Transition name="ob-toast">
      <div
        v-if="state.error"
        class="fixed bottom-20 left-1/2 -translate-x-1/2 z-50 w-[calc(100%-2rem)] max-w-lg px-4 py-3 rounded-xl text-sm text-center backdrop-blur bg-red-50/80 text-red-700 ring-1 ring-red-200 dark:bg-red-950/40 dark:text-red-300 dark:ring-red-800"
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
import {
  computed,
  nextTick,
  onMounted,
  onUnmounted,
  reactive,
  ref,
  watch,
} from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useTranslations } from '@/composable/useTranslations';
import { useStorage } from '@/composable/storage';
import { useImportExport } from '@/composable/useImportExport';
import { useStore } from '@/store';
import { useNoteStore } from '@/store/note';
import { useFolderStore } from '@/store/folder';
import { useTheme } from '@/composable/theme';
import {
  applyOnboardingFreshPreferences,
  getOnboardingMigrationStatus,
  markOnboardingCompleted,
  ONBOARDING_LANGUAGES,
  ONBOARDING_THEMES,
  openOnboardingWorkspace,
  runOnboardingMigration,
} from '@/utils/onboarding';
import { clipboard, ipcRenderer } from '@/lib/tauri-bridge';
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

export default {
  name: 'AppOnboarding',
  setup() {
    const route = useRoute();
    const router = useRouter();
    const { translations } = useTranslations();
    const settingsStorage = useStorage('settings');
    const store = useStore();
    const noteStore = useNoteStore();
    const folderStore = useFolderStore();
    const theme = useTheme();

    const step = ref('welcome');
    const completionMode = ref('fresh');
    const selectedMode = ref(null);
    const migrationPlatform = ref(null);
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
    const fresh = reactive({
      theme: 'system',
      language: 'en',
      spellcheckEnabled: true,
      openLastEdited: true,
      openAfterCreation: true,
    });

    const themeImages = { light: lightImg, dark: darkImg, system: systemImg };
    const themes = ONBOARDING_THEMES.map((item) => ({
      ...item,
      img: themeImages[item.name],
    }));
    const languages = ONBOARDING_LANGUAGES;
    const themeLabels = computed(() => ({
      light: translations.value.appearence?.light || 'Light',
      dark: translations.value.appearence?.dark || 'Dark',
      system: translations.value.appearence?.system || 'System',
    }));

    const isDark = computed(
      () =>
        fresh.theme === 'dark' ||
        (fresh.theme === 'system' &&
          typeof window !== 'undefined' &&
          window.matchMedia?.('(prefers-color-scheme: dark)').matches)
    );
    const isMacOS = computed(
      () =>
        typeof window !== 'undefined' &&
        window.navigator.platform.toLowerCase().includes('mac')
    );
    const { runImportSource } = useImportExport({
      clipboard,
      folderStore,
      ipcRenderer,
      isMacOS,
      noteStore,
      storage: settingsStorage,
    });

    const prefersReducedMotion = () =>
      typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

    const timers = [];
    const delay = (fn, ms) => {
      const t = setTimeout(fn, ms);
      timers.push(t);
    };

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
    const migrationDetectionCopy = computed(() =>
      state.status?.hasLegacyData
        ? 'Found your legacy workspace and ready to import.'
        : 'No legacy workspace detected on this machine.'
    );
    const migrationSourceHeading = computed(() =>
      migrationPlatform.value === 'electron'
        ? 'Legacy workspace'
        : 'Import source'
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
        return state.status?.hasLegacyData ? 'Ready' : 'Not found';
      }
      if (migrationPlatform.value === 'apple-notes') return 'Direct access';
      return 'Select on start';
    });
    const migrationSourceBadgeClass = computed(() => {
      if (migrationPlatform.value === 'electron') {
        return state.status?.hasLegacyData
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
        return !state.status?.hasLegacyData;
      }
      if (migrationPlatform.value === 'apple-notes') {
        return !isMacOS.value;
      }
      return false;
    });

    const platformLabels = {
      electron: 'Beaver Notes (Legacy)',
      obsidian: 'Obsidian',
      'apple-notes': 'Apple Notes',
      bear: 'Bear',
      simplenote: 'Simplenote',
      markdown: 'Markdown Folder',
      evernote: 'Evernote',
      notion: 'Notion',
    };
    const migrationPlatformLabel = computed(
      () => platformLabels[migrationPlatform.value] || 'legacy'
    );

    const activeFlow = computed(() => {
      if (selectedMode.value === 'fresh')
        return ['welcome', 'path', 'setup', 'finish'];
      if (selectedMode.value === 'migration')
        return ['welcome', 'path', 'platform', 'migration', 'finish'];
      return ['welcome', 'path'];
    });

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
    const openMigrationFlow = () => {
      selectedMode.value = 'migration';
      migrationPlatform.value = 'electron';
      setStep('platform');
    };
    const selectMigrationPlatform = (platform) => {
      migrationPlatform.value = platform;
    };
    const selectTheme = (name) => {
      fresh.theme = name;
      theme.setTheme(name, name === 'system');
    };

    const onMagnet = (e) => {
      const b = e.currentTarget,
        r = b.getBoundingClientRect();
      b.style.transform = `translate(${
        (e.clientX - r.left - r.width / 2) * 0.28
      }px,${(e.clientY - r.top - r.height / 2) * 0.28}px)`;
    };
    const resetMagnet = (e) => {
      e.currentTarget.style.transform = '';
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
            '--cx':
              side === 'l' ? `${18 + r() * 40}vw` : `${-(18 + r() * 40)}vw`,
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

    async function refreshStatus() {
      state.error = '';
      state.status = await getOnboardingMigrationStatus();
    }
    async function prepareFreshWorkspace() {
      state.error = '';
      state.savingPreferences = true;
      try {
        await applyOnboardingFreshPreferences(fresh, { theme });
        selectedMode.value = 'fresh';
        completionMode.value = 'fresh';
        setStep('finish');
      } catch (e) {
        state.error = e?.message || String(e);
      } finally {
        state.savingPreferences = false;
      }
    }
    async function useDefaultPreferences() {
      await prepareFreshWorkspace();
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
        await runOnboardingMigration();
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

    async function copyMigrationIssues() {
      if (!state.migrationIssuesText) return;
      await clipboard.writeText(state.migrationIssuesText);
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
      () => {
        applyRouteEntry();
      },
      { immediate: true }
    );

    onMounted(async () => {
      if (prefersReducedMotion()) {
        logoIn.value = textIn.value = ctaIn.value = true;
      } else {
        delay(() => {
          logoIn.value = true;
        }, 120);
        delay(() => {
          textIn.value = true;
        }, 580);
        delay(() => {
          ctaIn.value = true;
        }, 1020);
      }
      theme.loadTheme();
      try {
        await refreshStatus();
      } catch (e) {
        state.error = e?.message || String(e);
      } finally {
        state.loading = false;
      }
    });
    onUnmounted(() => timers.forEach(clearTimeout));

    return {
      step,
      state,
      fresh,
      confettiPieces,
      themes,
      themeLabels,
      languages,
      logoUrl,
      isDark,
      onboardingSubtitle,
      completionEyebrow,
      completionTitle,
      completionSubtitle,
      migrationDetectionCopy,
      logoIn,
      textIn,
      ctaIn,
      finishIn,
      migrationPlatform,
      migrationPlatformLabel,
      migrationSourceHeading,
      migrationSourceCopy,
      migrationSourceBadge,
      migrationSourceBadgeClass,
      migrationWhatGetsCopied,
      migrationActionDisabled,
      setStep,
      goToStep,
      goToPreviousStep,
      chooseMode,
      openMigrationFlow,
      selectMigrationPlatform,
      selectTheme,
      refreshStatus,
      prepareFreshWorkspace,
      useDefaultPreferences,
      migrateLegacyData,
      runSelectedMigration,
      copyMigrationIssues,
      completeAndOpenWorkspace,
      isMacOS,
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

/* ── Page transitions ── */
.ob-page-enter-active {
  animation: ob-in 0.55s cubic-bezier(0.16, 1, 0.3, 1) 0.05s both;
}
.ob-page-leave-active {
  animation: ob-out 0.35s cubic-bezier(0.4, 0, 1, 1) both;
  position: absolute;
  width: 100%;
}
@keyframes ob-in {
  from {
    opacity: 0;
    transform: translateY(28px) scale(0.98);
    filter: blur(4px);
  }
  to {
    opacity: 1;
    transform: none;
    filter: none;
  }
}
@keyframes ob-out {
  from {
    opacity: 1;
    transform: none;
  }
  to {
    opacity: 0;
    transform: translateY(-16px) scale(0.98);
  }
}

/* ── Welcome entrance ── */
.ob-logo {
  opacity: 0;
  transform: translateY(-32px) scale(0.85);
  transition: opacity 0.6s cubic-bezier(0.16, 1, 0.3, 1),
    transform 0.9s cubic-bezier(0.34, 1.56, 0.64, 1);
}
.ob-logo--in {
  opacity: 1;
  transform: none;
}
.ob-eyebrow {
  transform: translateY(110%);
  transition: transform 0.65s cubic-bezier(0.16, 1, 0.3, 1);
}
.ob-headline--in .ob-eyebrow {
  transform: translateY(0);
}
.ob-title {
  transform: translateY(110%);
  transition: transform 0.75s cubic-bezier(0.16, 1, 0.3, 1) 0.06s;
}
.ob-headline--in .ob-title {
  transform: translateY(0);
}
.ob-below {
  opacity: 0;
  transform: translateY(16px);
  transition: opacity 0.6s ease, transform 0.6s cubic-bezier(0.16, 1, 0.3, 1);
}
.ob-below--in {
  opacity: 1;
  transform: none;
}

/* ── Finish entrance ── */
.ob-finish {
  opacity: 0;
  transform: translateY(20px);
  transition: opacity 0.7s ease, transform 0.7s cubic-bezier(0.16, 1, 0.3, 1);
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
  transform: translateX(-50%) translateY(8px);
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
</style>
