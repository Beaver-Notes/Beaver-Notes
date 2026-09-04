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

    <!-- Coarse key stays wizard across steps so frame never remounts, only content slides. -->
    <div
      :key="topLevelKey"
      class="ob-page-content relative z-10 w-full px-5 sm:px-0"
    >
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
            <ui-beaver-character
              class="w-48 h-auto ob-logo"
              :class="{ 'ob-logo--in': logoIn }"
              :state="['searching', 'cursorTrack']"
              :auto="false"
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
                Let's get set up: sign in, secure your notes, then import and
                customize.
              </p>
            </div>
          </div>
        </div>

        <div
          class="flex flex-wrap mobile:flex-col mobile:w-full mobile:items-stretch mobile:px-4 ob-bottom-nav justify-center gap-3"
        >
          <ui-button
            variant="primary"
            data-testid="onboarding-welcome-continue"
            @click="handlePrimaryContinue"
          >
            Continue <v-remixicon name="riArrowRightLine" />
          </ui-button>
        </div>
      </div>

      <ui-modal
        v-else-if="isCardStep"
        :model-value="true"
        persist
        content-class="max-w-lg ob-wizard-card"
      >
        <div class="flex flex-col max-h-[75dvh] mobile:max-h-[80dvh]">
          <!-- Mobile-only progress, pinned to the top of the sheet -->
          <div
            v-if="showStepProgress"
            class="hidden mobile:block mb-3 shrink-0"
          >
            <div
              class="flex items-center justify-between text-xs font-semibold text-neutral-500 dark:text-neutral-400 mb-1.5"
            >
              <span>Step {{ currentStepNumber }} of {{ totalStepCount }}</span>
            </div>
            <div
              class="h-1.5 w-full rounded-full bg-neutral-200 dark:bg-neutral-800 overflow-hidden"
            >
              <div
                class="h-full bg-primary rounded-full transition-all duration-300 ease-out"
                :style="{ width: stepProgressPercent + '%' }"
              ></div>
            </div>
          </div>

          <div class="flex-1 min-h-0 overflow-y-auto px-1">
            <Transition
              :name="
                navDirection === 'forward' ? 'ob-slide-fwd' : 'ob-slide-back'
              "
              mode="out-in"
            >
              <div
                :key="step + '::' + (importPhase || '')"
                class="flex flex-col gap-3"
              >
                <!-- Customize -->
                <template v-if="step === 'customize'">
                  <div
                    class="flex flex-col items-center gap-1.5 text-center mb-1"
                  >
                    <h2
                      class="text-xl font-semibold tracking-tight text-neutral-800 dark:text-neutral-200"
                    >
                      Your starting defaults
                    </h2>
                    <p class="text-neutral-600 dark:text-neutral-400">
                      Changed your mind? You can change these from Settings at
                      any time.
                    </p>
                  </div>

                  <div class="flex flex-col gap-2">
                    <p
                      class="text-sm font-medium text-neutral-800 dark:text-neutral-200"
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
                        class="bg-neutral-100 dark:bg-neutral-800 p-2 transition-all w-full rounded-xl"
                        :class="
                          fresh.theme === item.name ? 'ring-1 ring-primary' : ''
                        "
                        @click="selectTheme(item.name)"
                      >
                        <img
                          :src="item.img"
                          :alt="item.label"
                          class="w-full border-2 mb-1 rounded-xl"
                        />
                        <p
                          class="text-sm font-semibold text-neutral-600 dark:text-neutral-300"
                        >
                          {{ themeLabels[item.name] || item.label }}
                        </p>
                      </button>
                    </div>
                  </div>

                  <div class="flex flex-row items-center justify-center gap-4">
                    <p
                      class="text-sm font-medium text-neutral-800 dark:text-neutral-200 w-full justify-center"
                    >
                      Accent color
                    </p>
                    <div class="w-full justify-center flex gap-2 right-0">
                      <button
                        class="bg-red-500 p-2 w-8 h-8 rounded-full focus:ring-primary transition"
                        :class="{
                          'ring-2 ring-primary border':
                            fresh.accentColor === 'red',
                        }"
                        @click="selectAccentColor('red')"
                      ></button>
                      <button
                        class="bg-amber-400 p-2 w-8 h-8 rounded-full focus:ring-primary transition"
                        :class="{
                          'ring-2 ring-primary border':
                            fresh.accentColor === 'light',
                        }"
                        @click="selectAccentColor('light')"
                      ></button>
                      <button
                        class="bg-emerald-500 p-2 w-8 h-8 rounded-full focus:ring-primary transition"
                        :class="{
                          'ring-2 ring-primary border':
                            fresh.accentColor === 'green',
                        }"
                        @click="selectAccentColor('green')"
                      ></button>
                      <button
                        class="bg-blue-400 p-2 w-8 h-8 rounded-full focus:ring-primary transition"
                        :class="{
                          'ring-2 ring-primary border':
                            fresh.accentColor === 'blue',
                        }"
                        @click="selectAccentColor('blue')"
                      ></button>
                      <button
                        class="bg-purple-400 p-2 w-8 h-8 rounded-full focus:ring-primary transition"
                        :class="{
                          'ring-2 ring-primary border':
                            fresh.accentColor === 'purple',
                        }"
                        @click="selectAccentColor('purple')"
                      ></button>
                      <button
                        class="bg-pink-400 p-2 w-8 h-8 rounded-full focus:ring-primary transition"
                        :class="{
                          'ring-2 ring-primary border':
                            fresh.accentColor === 'pink',
                        }"
                        @click="selectAccentColor('pink')"
                      ></button>
                      <button
                        class="bg-neutral-400 p-2 w-8 h-8 rounded-full focus:ring-primary transition"
                        :class="{
                          'ring-2 ring-primary border':
                            fresh.accentColor === 'neutral',
                        }"
                        @click="selectAccentColor('neutral')"
                      ></button>
                    </div>
                  </div>

                  <div class="flex flex-col gap-2">
                    <p
                      class="text-sm font-medium text-neutral-800 dark:text-neutral-200"
                    >
                      Language
                    </p>
                    <ui-select
                      :options="languages"
                      block
                      :model-value="fresh.language"
                      @update:model-value="selectLanguage"
                    />
                  </div>

                  <div class="flex flex-col gap-2">
                    <p
                      class="text-sm font-medium text-neutral-800 dark:text-neutral-200"
                    >
                      App font
                    </p>
                    <ui-select
                      :model-value="fresh.selectedFont"
                      class="w-full ob-font-select"
                      :search="true"
                      @update:model-value="selectFont"
                    >
                      <option
                        v-for="font in fonts"
                        :key="font.value"
                        :value="font.value"
                        :class="font.class"
                      >
                        {{ font.label }}
                      </option>
                    </ui-select>
                  </div>

                  <div class="space-y-1">
                    <div
                      class="flex flex-row gap-3 items-center justify-between"
                    >
                      <div class="min-w-0 flex-1">
                        <p
                          class="text-sm font-medium text-neutral-800 dark:text-neutral-200"
                        >
                          Enable sounds
                        </p>
                        <p
                          class="mt-0.5 text-xs leading-relaxed text-neutral-500 dark:text-neutral-400"
                        >
                          Enable sounds for interactions around the app.
                        </p>
                      </div>
                      <ui-switch
                        :model-value="fresh.soundsEnabled"
                        @update:model-value="selectSounds"
                      />
                    </div>
                    <div
                      v-if="isMobileRuntime"
                      class="flex flex-row gap-3 items-center justify-between"
                    >
                      <div class="min-w-0 flex-1">
                        <p
                          class="text-sm font-medium text-neutral-800 dark:text-neutral-200"
                        >
                          Spotlight indexing
                        </p>
                        <p
                          class="mt-0.5 text-xs leading-relaxed text-neutral-500 dark:text-neutral-400"
                        >
                          Let iOS / macOS Spotlight index your notes so they can
                          be found via system search.
                        </p>
                      </div>
                      <ui-switch
                        :model-value="fresh.spotlightEnabled"
                        @update:model-value="selectSpotlight"
                      />
                    </div>
                  </div>
                </template>

                <!-- Import -->
                <template v-else-if="step === 'import'">
                  <template v-if="importPhase === 'pick'">
                    <div
                      class="flex flex-col items-center gap-2 text-center mb-2"
                    >
                      <h2
                        class="text-2xl font-semibold tracking-tight text-neutral-800 dark:text-neutral-200"
                      >
                        Import from apps
                      </h2>
                      <p class="text-neutral-600 dark:text-neutral-400">
                        Bring your notes from another app, or skip for now.
                      </p>
                    </div>

                    <ui-card
                      v-for="platform in visiblePlatforms"
                      :key="platform.id"
                      tag="button"
                      padding="p-0"
                      class="w-full text-left shrink-0"
                      @click="selectImportSource(platform.id)"
                    >
                      <div class="flex items-center gap-4 p-4">
                        <div
                          class="shrink-0 w-10 h-10 rounded-xl flex items-center justify-center"
                          :style="
                            platform.iconBg
                              ? { background: platform.iconBg }
                              : {}
                          "
                          :class="platform.iconClass || ''"
                        >
                          <img
                            v-if="platform.useLogoImg"
                            :src="logoUrl"
                            alt="Beaver Notes"
                            class="w-6 h-6 object-contain"
                          />
                          <v-remixicon
                            v-else
                            :name="platform.icon"
                            :class="platform.iconColor || ''"
                          />
                        </div>
                        <div class="flex-1 min-w-0">
                          <div class="flex items-center gap-2 mb-0.5">
                            <h3
                              class="font-semibold text-sm text-neutral-800 dark:text-neutral-200"
                            >
                              {{ platform.label }}
                            </h3>
                            <span
                              v-if="platform.badge"
                              class="inline-flex items-center rounded-full bg-amber-500/10 text-amber-700 dark:text-amber-300 text-[0.65rem] font-bold uppercase tracking-wide px-2 py-0.5"
                              >{{ platform.badge }}</span
                            >
                            <span
                              v-if="
                                platform.id === 'electron' &&
                                migrationSourceBadge
                              "
                              :class="migrationSourceBadgeClass"
                              class="inline-flex items-center rounded-full text-[0.65rem] font-bold uppercase tracking-wide px-2 py-0.5"
                              >{{ migrationSourceBadge }}</span
                            >
                          </div>
                          <p
                            class="text-sm text-neutral-600 dark:text-neutral-400"
                          >
                            {{ platform.description }}
                          </p>
                        </div>
                        <v-remixicon
                          name="riArrowRightLine"
                          class="shrink-0 opacity-30"
                        />
                      </div>
                    </ui-card>
                  </template>

                  <template v-else-if="importPhase === 'confirm'">
                    <div
                      class="flex flex-col items-center gap-2 text-center mb-2 px-2"
                    >
                      <h2
                        class="text-2xl font-semibold tracking-tight text-neutral-800 dark:text-neutral-200"
                      >
                        Import your notes from {{ migrationPlatformLabel }}
                      </h2>
                      <p
                        class="text-neutral-600 dark:text-neutral-400 max-w-sm"
                      >
                        Your original data stays untouched. Notes, folders,
                        labels, settings, and assets will be copied over.
                      </p>
                    </div>

                    <template v-if="showLegacyLockedPrompt">
                      <div class="flex flex-col gap-3 p-4">
                        <p
                          class="text-sm font-semibold text-neutral-800 dark:text-neutral-200"
                        >
                          Enter your old password
                        </p>
                        <p
                          class="text-sm text-neutral-600 dark:text-neutral-400"
                        >
                          Your imported notes are locked. Enter your old Beaver
                          Notes password to decrypt and re-encrypt them with the
                          new system.
                        </p>
                        <ui-input
                          v-model="legacyPasswordValue"
                          :password="true"
                          placeholder="Old password"
                          class="w-full"
                          @keyup.enter="submitLegacyPassword"
                        />
                        <p
                          v-if="state.legacyPasswordError"
                          class="text-xs text-red-500 dark:text-red-400"
                        >
                          {{ state.legacyPasswordError }}
                        </p>
                      </div>
                    </template>

                    <template v-else>
                      <div class="flex flex-col gap-2">
                        <p
                          class="text-sm text-neutral-600 dark:text-neutral-400"
                        >
                          {{ migrationSourceCopy }}
                        </p>

                        <ui-card
                          v-if="migrationPlatform === 'evernote'"
                          class="bg-input"
                        >
                          <div class="flex flex-col gap-2 p-4">
                            <p
                              class="text-xs font-bold uppercase tracking-widest text-neutral-500 dark:text-neutral-500"
                            >
                              Evernote notebook
                            </p>
                            <ui-input
                              :value="state.evernoteNotebookName"
                              placeholder="Notebook name (optional)"
                              class="w-full"
                              @input="state.evernoteNotebookName = $event"
                            />
                          </div>
                        </ui-card>

                        <ui-card class="bg-input">
                          <div class="flex flex-col gap-1 p-4">
                            <p
                              class="text-xs font-bold uppercase tracking-widest text-neutral-500 dark:text-neutral-500 mb-1"
                            >
                              What gets copied
                            </p>
                            <p
                              class="text-sm text-neutral-600 dark:text-neutral-400"
                            >
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
                            <div
                              v-if="customLegacyPath"
                              class="flex flex-col gap-1"
                            >
                              <span
                                class="text-xs font-bold uppercase tracking-widest text-neutral-500 dark:text-neutral-500"
                              >
                                Portable data folder
                              </span>
                              <code
                                class="text-xs font-mono break-all px-2 py-1.5 rounded-lg bg-neutral-100 dark:bg-neutral-900 text-neutral-600 dark:text-neutral-300"
                              >
                                {{ customLegacyPath }}
                              </code>
                            </div>
                            <div
                              v-else-if="state.status?.legacyDir"
                              class="flex flex-col gap-1"
                            >
                              <span
                                class="text-xs font-bold uppercase tracking-widest text-neutral-500 dark:text-neutral-500"
                              >
                                Beaver Notes (Legacy)
                              </span>
                              <code
                                class="text-xs font-mono break-all px-2 py-1.5 rounded-lg bg-neutral-100 dark:bg-neutral-900 text-neutral-600 dark:text-neutral-300"
                              >
                                {{ state.status.legacyDir }}
                              </code>
                            </div>
                            <div
                              v-if="state.status?.appDir"
                              class="flex flex-col gap-1"
                            >
                              <span
                                class="text-xs font-bold uppercase tracking-widest text-neutral-500 dark:text-neutral-500"
                              >
                                New Beaver Notes
                              </span>
                              <code
                                class="text-xs font-mono break-all px-2 py-1.5 rounded-lg bg-neutral-100 dark:bg-neutral-900 text-neutral-600 dark:text-neutral-300"
                              >
                                {{ state.status.appDir }}
                              </code>
                            </div>
                          </div>
                        </ui-card>

                        <ui-card
                          v-if="
                            migrationPlatform === 'electron' &&
                            !state.status?.hasLegacyData
                          "
                          class="bg-input"
                        >
                          <div
                            class="flex items-center justify-between gap-4 p-4"
                          >
                            <div>
                              <p
                                class="text-xs font-bold uppercase tracking-widest text-neutral-500 dark:text-neutral-500 mb-1"
                              >
                                Windows Portable
                              </p>
                              <p
                                class="text-sm text-neutral-600 dark:text-neutral-400"
                              >
                                Using the portable version? Locate your data
                                folder manually.
                              </p>
                            </div>
                            <ui-button @click="browseForPortableData">{{
                              tr.browseForData || 'Browse…'
                            }}</ui-button>
                          </div>
                        </ui-card>
                      </div>
                    </template>
                  </template>

                  <template v-else-if="importPhase === 'running'">
                    <div
                      class="flex flex-col items-center gap-2 text-center mb-2"
                    >
                      <h2
                        class="text-2xl font-semibold tracking-tight text-neutral-800 dark:text-neutral-200"
                      >
                        Importing from {{ migrationPlatformLabel }}
                      </h2>
                    </div>
                    <ui-card class="bg-input">
                      <div class="flex flex-col gap-3 p-4">
                        <div class="flex items-center justify-between">
                          <p
                            class="text-xs font-bold uppercase tracking-widest text-neutral-500 dark:text-neutral-500"
                          >
                            Importing…
                          </p>
                          <span class="text-xs font-bold text-primary"
                            >{{ state.migrationProgress }}%</span
                          >
                        </div>
                        <div
                          class="h-1.5 rounded-full bg-neutral-100 dark:bg-neutral-900 overflow-hidden"
                        >
                          <div
                            class="h-full rounded-full bg-primary transition-all duration-300 ease-out"
                            :style="{ width: state.migrationProgress + '%' }"
                          ></div>
                        </div>
                        <p
                          class="text-xs text-neutral-600 dark:text-neutral-400"
                        >
                          {{ state.migrationStatus }}
                        </p>
                        <p
                          v-if="state.migrationCurrent"
                          class="text-xs text-neutral-600 dark:text-neutral-400 opacity-80"
                        >
                          {{ state.migrationCurrent }}
                        </p>
                      </div>
                    </ui-card>
                  </template>

                  <template v-else-if="importPhase === 'done'">
                    <div
                      class="flex flex-col items-center gap-2 text-center mb-2"
                    >
                      <h2
                        class="text-2xl font-semibold tracking-tight text-neutral-800 dark:text-neutral-200"
                      >
                        Import complete
                      </h2>
                      <p
                        class="text-neutral-600 dark:text-neutral-400 max-w-sm"
                      >
                        Your notes from {{ migrationPlatformLabel }} are ready.
                      </p>
                    </div>

                    <ui-card class="bg-input">
                      <div class="flex flex-col gap-3 p-4">
                        <div class="flex items-center justify-between">
                          <p
                            class="text-xs font-bold uppercase tracking-widest text-neutral-500 dark:text-neutral-500"
                          >
                            Import complete
                          </p>
                          <span class="text-xs font-bold text-primary"
                            >{{ state.migrationProgress }}%</span
                          >
                        </div>
                        <div
                          class="h-1.5 rounded-full bg-neutral-100 dark:bg-neutral-900 overflow-hidden"
                        >
                          <div
                            class="h-full rounded-full bg-primary transition-all duration-300 ease-out"
                            :style="{ width: state.migrationProgress + '%' }"
                          ></div>
                        </div>
                        <p
                          class="text-xs text-neutral-600 dark:text-neutral-400"
                        >
                          {{ state.migrationStatus }}
                        </p>
                      </div>
                    </ui-card>

                    <ui-card v-if="state.migrationResult" class="bg-input">
                      <div class="flex flex-col gap-1 p-4">
                        <p
                          class="text-xs font-bold uppercase tracking-widest text-neutral-500 dark:text-neutral-500 mb-1"
                        >
                          Import summary
                        </p>
                        <p
                          class="text-sm text-neutral-600 dark:text-neutral-400"
                        >
                          Imported
                          {{ state.migrationResult.imported || 0 }} notes across
                          {{ state.migrationResult.folders || 0 }} folders.
                        </p>
                      </div>
                    </ui-card>

                    <ui-card v-if="state.migrationIssuesText" class="bg-input">
                      <div class="flex flex-col gap-3 p-4">
                        <div class="flex items-center justify-between gap-3">
                          <p
                            class="text-xs font-bold uppercase tracking-widest text-neutral-500 dark:text-neutral-500"
                          >
                            Issues
                          </p>
                          <ui-button
                            variant="secondary"
                            @click="copyMigrationIssues"
                            >{{
                              tr.copyToClipboard || 'Copy to clipboard'
                            }}</ui-button
                          >
                        </div>
                        <div
                          class="max-h-40 overflow-auto rounded-lg bg-neutral-100 p-3 font-mono text-[11px] whitespace-pre-wrap text-neutral-600 dark:bg-neutral-900 dark:text-neutral-300"
                        >
                          {{ state.migrationIssuesText }}
                        </div>
                      </div>
                    </ui-card>
                  </template>
                </template>

                <!-- Account -->
                <template v-else-if="step === 'account'">
                  <template v-if="accountStore.isAuthenticated">
                    <div
                      class="flex flex-col items-center gap-3 text-center mb-1 px-2"
                    >
                      <div
                        class="shrink-0 w-12 h-12 rounded-xl bg-primary/10 text-primary flex items-center justify-center"
                      >
                        <v-remixicon name="riUserLine" size="24" />
                      </div>
                      <h2
                        class="text-2xl font-semibold tracking-tight text-neutral-800 dark:text-neutral-200"
                      >
                        You're signed in
                      </h2>
                      <p
                        class="text-sm text-neutral-600 dark:text-neutral-400 truncate"
                      >
                        {{
                          accountStore.profile?.email ||
                          accountStore.profile?.username ||
                          translations.account?.signedInAs ||
                          'Signed in'
                        }}
                      </p>
                    </div>

                    <!-- Seeding Progress -->
                    <div
                      v-if="accountStore.seedStatus === 'seeding'"
                      class="mt-4 p-4 rounded-xl bg-primary/5 border border-primary/20"
                    >
                      <div class="flex items-center gap-3 mb-3">
                        <div class="animate-spin">
                          <v-remixicon
                            name="riLoader4Line"
                            class="text-primary"
                            size="20"
                          />
                        </div>
                        <p
                          class="text-sm font-medium text-neutral-800 dark:text-neutral-200"
                        >
                          Setting up cloud sync...
                        </p>
                      </div>
                      <div class="space-y-2">
                        <div
                          class="flex justify-between text-xs text-neutral-600 dark:text-neutral-400"
                        >
                          <span>{{ seedPhaseLabel }}</span>
                          <span
                            >{{ accountStore.seedProgress.uploaded }} /
                            {{ accountStore.seedProgress.total }}</span
                          >
                        </div>
                        <div
                          class="h-1.5 rounded-full bg-neutral-200 dark:bg-neutral-700 overflow-hidden"
                        >
                          <div
                            class="h-full rounded-full bg-primary transition-all duration-300 ease-out"
                            :style="{ width: seedProgressPercent + '%' }"
                          ></div>
                        </div>
                      </div>
                    </div>

                    <div
                      v-else-if="accountStore.seedStatus === 'done'"
                      class="mt-4 p-3 rounded-xl bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800"
                    >
                      <div class="flex items-center gap-2 justify-center">
                        <v-remixicon
                          name="riCheckLine"
                          class="text-green-600 dark:text-green-400"
                          size="18"
                        />
                        <p
                          class="text-sm font-medium text-green-700 dark:text-green-300"
                        >
                          Cloud sync ready
                        </p>
                      </div>
                    </div>

                    <div
                      v-else-if="accountStore.seedStatus === 'error'"
                      class="mt-4 p-3 rounded-xl bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800"
                    >
                      <div class="flex items-center gap-2 justify-center">
                        <v-remixicon
                          name="riErrorWarningLine"
                          class="text-red-600 dark:text-red-400"
                          size="18"
                        />
                        <p
                          class="text-sm font-medium text-red-700 dark:text-red-300"
                        >
                          Sync setup failed. You can retry from Settings.
                        </p>
                      </div>
                    </div>
                  </template>

                  <template v-else>
                    <div
                      class="flex flex-col items-center gap-2 text-center mb-1 px-2"
                    >
                      <div
                        class="shrink-0 w-12 h-12 rounded-xl bg-primary/10 text-primary flex items-center justify-center"
                      >
                        <v-remixicon name="riUserLine" size="24" />
                      </div>
                      <h2
                        class="text-2xl font-semibold tracking-tight text-neutral-800 dark:text-neutral-200"
                      >
                        {{
                          translations.account?.onboardingTitle ||
                          'Sign in (optional)'
                        }}
                      </h2>
                      <p
                        class="text-sm text-neutral-600 dark:text-neutral-400 max-w-sm leading-relaxed"
                      >
                        {{
                          translations.account?.onboardingBody ||
                          'A Beaver Account lets your notes follow you across devices with end-to-end encrypted cloud sync. Local-only mode stays fully working without one.'
                        }}
                      </p>
                    </div>

                    <div class="flex flex-col gap-2">
                      <p
                        class="text-xs font-semibold uppercase tracking-wide text-neutral-500 dark:text-neutral-400"
                      >
                        {{ translations.account?.server || 'Server' }}
                      </p>
                      <ui-input
                        v-model="draftServerUrl"
                        class="w-full"
                        :placeholder="defaultServerUrl"
                      />
                      <p class="text-xs text-neutral-400 dark:text-neutral-500">
                        {{
                          translations.account?.serverHint ||
                          'Default works with Beaver Cloud. Change this for a self-hosted instance.'
                        }}
                      </p>
                    </div>

                    <ul
                      class="space-y-2 text-sm text-neutral-700 dark:text-neutral-300"
                    >
                      <li class="flex items-start gap-3">
                        <v-remixicon
                          name="riShieldCheckLine"
                          class="mt-0.5 text-primary"
                          size="18"
                        />
                        <span>{{
                          translations.account?.onboardingBulletPrivacy ||
                          'Zero-knowledge encryption: the server only sees encrypted blobs.'
                        }}</span>
                      </li>
                      <li class="flex items-start gap-3">
                        <v-remixicon
                          name="riFingerprintLine"
                          class="mt-0.5 text-primary"
                          size="18"
                        />
                        <span>{{
                          translations.account?.onboardingBulletAuth ||
                          'Sign in with a passkey or a password. QuickConnect works across devices.'
                        }}</span>
                      </li>
                      <li class="flex items-start gap-3">
                        <v-remixicon
                          name="riStarLine"
                          class="mt-0.5 text-primary"
                          size="18"
                        />
                        <span>{{
                          translations.account?.onboardingBulletFree ||
                          'A free account keeps your notes on this device only. Cloud sync is part of Basic and up.'
                        }}</span>
                      </li>
                    </ul>

                    <div class="flex flex-col gap-2">
                      <ui-input
                        v-model="passkeyEmail"
                        type="email"
                        class="w-full"
                        :placeholder="
                          translations.account?.emailPlaceholder ||
                          'Email (optional)'
                        "
                        :aria-label="
                          translations.account?.emailPlaceholder ||
                          'Email (optional)'
                        "
                      />
                      <div class="flex gap-2">
                        <ui-button
                          class="flex-1"
                          :loading="accountStore.busy"
                          :disabled="accountStore.busy"
                          @click="handleSignInWithPasskey"
                        >
                          <v-remixicon name="riFingerprintLine" class="mr-1" />
                          {{ translations.account?.signIn || 'Sign in' }}
                        </ui-button>
                        <ui-button
                          class="flex-1"
                          variant="primary"
                          :loading="accountStore.busy"
                          :disabled="accountStore.busy"
                          @click="handleSignUpWithPasskey"
                        >
                          {{
                            translations.account?.createAccount ||
                            'Create account'
                          }}
                        </ui-button>
                      </div>

                      <div
                        class="border-t border-neutral-200 dark:border-neutral-700 pt-3"
                      >
                        <button
                          class="text-xs font-semibold uppercase tracking-wide text-neutral-500 dark:text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200 transition-colors cursor-pointer"
                          @click="showPasswordAuth = !showPasswordAuth"
                        >
                          {{ showPasswordAuth ? '↑' : '↓' }}
                          {{
                            translations.account?.withPassword ||
                            'Or sign in with password'
                          }}
                        </button>
                        <div
                          v-if="showPasswordAuth"
                          class="mt-2 flex flex-col gap-2"
                        >
                          <ui-input
                            v-model="signInEmail"
                            type="email"
                            class="w-full"
                            :placeholder="
                              translations.account?.emailPlaceholder || 'Email'
                            "
                          />
                          <ui-input
                            v-model="signInPassword"
                            :password="true"
                            class="w-full"
                            :placeholder="
                              translations.account?.passwordPlaceholder ||
                              'Password'
                            "
                            @keyup.enter="handleSignInWithPassword"
                          />
                          <div class="flex items-center justify-between">
                            <button
                              class="text-xs text-primary hover:underline"
                              type="button"
                              @click="showForgot = !showForgot"
                            >
                              {{
                                trAccount.forgotPassword || 'Forgot password?'
                              }}
                            </button>
                            <span
                              v-if="forgotMessage"
                              class="text-xs"
                              :class="
                                forgotSent ? 'text-green-600' : 'text-amber-600'
                              "
                              >{{ forgotMessage }}</span
                            >
                          </div>
                          <div
                            v-if="showForgot"
                            class="flex flex-col gap-2 border rounded-xl p-3 bg-neutral-50 dark:bg-neutral-800"
                          >
                            <ui-input
                              v-model="forgotEmail"
                              type="email"
                              :placeholder="
                                trAccount.forgotEmailPlaceholder ||
                                'Email for reset link'
                              "
                              class="w-full"
                            />
                            <ui-button
                              variant="secondary"
                              :loading="forgotBusy"
                              @click="handleForgot"
                              >{{
                                trAccount.sendResetLink || 'Send reset link'
                              }}</ui-button
                            >
                            <p class="text-xs text-neutral-500">
                              {{
                                trAccount.inboxHint ||
                                'If an account exists for that email, you will receive a password reset link. Check your inbox (and spam folder).'
                              }}
                            </p>
                          </div>
                          <ui-input
                            v-model="signUpUsername"
                            class="w-full"
                            :placeholder="
                              trAccount.displayNamePlaceholder ||
                              'Display name (optional)'
                            "
                            maxlength="50"
                          />
                          <div class="flex gap-2">
                            <ui-button
                              class="flex-1"
                              :loading="accountStore.busy"
                              :disabled="accountStore.busy"
                              @click="handleSignInWithPassword"
                            >
                              {{
                                translations.account?.signInWithPassword ||
                                'Sign in'
                              }}
                            </ui-button>
                            <ui-button
                              class="flex-1"
                              variant="primary"
                              :loading="accountStore.busy"
                              :disabled="accountStore.busy"
                              @click="handleSignUpWithPassword"
                            >
                              {{
                                translations.account?.createAccount ||
                                'Create account'
                              }}
                            </ui-button>
                          </div>
                        </div>
                      </div>

                      <p
                        v-if="accountStore.error"
                        class="text-sm text-red-500"
                        role="alert"
                      >
                        {{ accountStore.error }}
                      </p>

                      <div
                        class="border-t border-neutral-200 dark:border-neutral-700 pt-3"
                      >
                        <button
                          class="text-xs font-semibold uppercase tracking-wide text-neutral-500 dark:text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200 transition-colors cursor-pointer"
                          @click="showRecovery = !showRecovery"
                        >
                          {{ showRecovery ? '↑' : '↓' }}
                          {{
                            trAuth.recoverPrompt ||
                            tr.recoverAccount ||
                            'Lost access? Recover with code'
                          }}
                        </button>
                        <div
                          v-if="showRecovery"
                          class="mt-2 flex flex-col gap-2"
                        >
                          <ui-input
                            v-model="recoverEmail"
                            type="email"
                            class="w-full"
                            :placeholder="trAccount.emailPlaceholder || 'Email'"
                          />
                          <ui-input
                            v-model="recoverCode"
                            class="w-full font-mono text-xs"
                            :placeholder="
                              trAuth.recoveryCodePlaceholder ||
                              '64-char recovery code'
                            "
                          />
                          <p class="text-xs text-amber-600 dark:text-amber-400">
                            {{
                              trAccount.recoveryHint ||
                              'Restores ACCOUNT access only. E2E data needs vault passphrase.'
                            }}
                          </p>
                          <ui-button
                            class="w-full"
                            variant="secondary"
                            :loading="recoverBusy"
                            @click="handleRecover"
                            >{{
                              tr.recoverAccount ||
                              trAuth.recoverAccount ||
                              'Recover account'
                            }}</ui-button
                          >
                          <p
                            v-if="recoverMessage"
                            class="text-xs"
                            :class="
                              recoverSuccess ? 'text-green-600' : 'text-red-500'
                            "
                          >
                            {{ recoverMessage }}
                          </p>
                        </div>
                      </div>
                    </div>
                  </template>
                </template>

                <!-- Sync -->
                <template v-else-if="step === 'sync'">
                  <div
                    class="flex flex-col items-center gap-2 text-center mb-1"
                  >
                    <h2
                      class="text-2xl font-semibold tracking-tight text-neutral-800 dark:text-neutral-200"
                    >
                      Sync folder
                    </h2>
                    <p class="text-neutral-600 dark:text-neutral-400">
                      Select a folder to sync your data with. You can skip this
                      for now and set it up later.
                    </p>
                  </div>

                  <div class="flex flex-col p-4">
                    <div class="flex items-center justify-between gap-3">
                      <div>
                        <p
                          class="text-sm font-medium text-neutral-800 dark:text-neutral-200"
                        >
                          Folder
                        </p>
                        <p
                          class="text-sm text-neutral-600 dark:text-neutral-400"
                        >
                          {{
                            fresh.syncPath
                              ? 'Beaver Notes syncs with this folder.'
                              : 'Choose a folder to sync with.'
                          }}
                        </p>
                      </div>
                      <ui-button @click="chooseSyncPath">{{
                        fresh.syncPath ? 'Change' : 'Choose folder'
                      }}</ui-button>
                    </div>

                    <div
                      v-if="fresh.syncPath"
                      class="flex items-center justify-between gap-3 mt-3"
                    >
                      <div
                        class="rounded-lg bg-neutral-100 px-3 py-2 text-xs break-all text-neutral-600 dark:bg-neutral-900 dark:text-neutral-300"
                      >
                        {{ fresh.syncPath }}
                      </div>
                      <ui-button icon variant="danger" @click="clearSyncPath">
                        <v-remixicon name="riDeleteBin6Line" />
                      </ui-button>
                    </div>

                    <ui-input
                      v-model="fresh.syncPath"
                      class="mt-3"
                      data-testid="onboarding-sync-path"
                      placeholder="Or type a folder path"
                    />
                  </div>
                </template>

                <!-- Password -->
                <template v-else-if="step === 'password'">
                  <div
                    class="flex flex-col items-center gap-2 text-center mb-1"
                  >
                    <h2
                      data-testid="vault-join-heading"
                      class="text-2xl font-semibold tracking-tight text-neutral-800 dark:text-neutral-200"
                    >
                      {{
                        vaultJoinMode
                          ? 'Join existing vault'
                          : translations.settings?.encryptionPassphrase ||
                            'Encryption passphrase'
                      }}
                    </h2>
                    <p class="text-neutral-600 dark:text-neutral-400">
                      {{
                        vaultJoinMode
                          ? 'This sync source has an existing encrypted vault. Enter its password to join.'
                          : translations.onboarding?.passwordDescription ||
                            'Encryption is built into Beaver Notes. Set a passphrase to protect every note and asset on this device.'
                      }}
                    </p>
                  </div>

                  <template v-if="!vaultJoinMode">
                    <ui-input
                      v-model="encryptionPassword"
                      password
                      :placeholder="
                        translations.settings?.password || 'Passphrase'
                      "
                    />

                    <div
                      class="h-1 rounded-full bg-neutral-200 dark:bg-neutral-700 overflow-hidden"
                    >
                      <div
                        class="h-full rounded-full transition-all duration-300"
                        :class="strengthBarClass"
                        :style="{ width: strengthPercent + '%' }"
                      />
                    </div>
                    <p class="text-xs" :class="strengthTextClass">
                      {{ strengthLabel }}
                    </p>

                    <ui-input
                      v-model="encryptionConfirmPassword"
                      password
                      :placeholder="
                        translations.onboarding?.confirmPassword ||
                        'Confirm passphrase'
                      "
                    />

                    <p class="text-sm">
                      {{
                        translations.onboarding?.passwordWarning ||
                        'This passphrase cannot be recovered if forgotten. Store it in a password manager.'
                      }}
                    </p>
                  </template>

                  <template v-else>
                    <ui-input
                      v-model="encryptionPassword"
                      password
                      data-testid="vault-join-password"
                      :placeholder="
                        translations.settings?.password || 'Vault password'
                      "
                      autofocus
                    />

                    <button
                      class="mt-1 text-xs text-primary hover:underline"
                      type="button"
                      data-testid="vault-start-fresh"
                      :disabled="encryptionPasswordLoading"
                      @click="startFreshVault"
                    >
                      {{
                        translations.onboarding?.startFresh ||
                        'Start fresh with a new vault instead'
                      }}
                    </button>
                  </template>

                  <p
                    v-if="encryptionPasswordError"
                    class="text-xs text-red-500 dark:text-red-400 text-center"
                  >
                    {{ encryptionPasswordError }}
                  </p>
                </template>
              </div>
            </Transition>
          </div>

          <div class="mt-5 flex items-center justify-between gap-3 shrink-0">
            <ui-button
              :disabled="step === 'import' && importPhase === 'running'"
              @click="wizardBack"
            >
              <v-remixicon name="riArrowLeftLine" /> Back
            </ui-button>

            <div
              v-if="showStepProgress"
              class="mobile:hidden min-w-[96px] max-w-[180px] flex-1 mx-2"
            >
              <div
                class="h-1.5 w-full rounded-full bg-neutral-200 dark:bg-neutral-800 overflow-hidden"
              >
                <div
                  class="h-full bg-primary rounded-full transition-all duration-300 ease-out"
                  :style="{ width: stepProgressPercent + '%' }"
                ></div>
              </div>
            </div>

            <div class="flex gap-2">
              <ui-button
                v-for="btn in footerButtons"
                :key="btn.key"
                :variant="btn.variant"
                :disabled="btn.disabled"
                :loading="btn.loading"
                :data-testid="btn.testid"
                @click="btn.onClick"
              >
                <template v-if="!btn.loading">
                  {{ btn.label }}
                  <v-remixicon v-if="btn.icon" :name="btn.icon" />
                </template>
              </ui-button>
            </div>
          </div>
        </div>
      </ui-modal>

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
            <ui-beaver-character
              class="w-48 h-auto"
              :state="['greeting']"
              :auto="false"
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

        <div class="flex flex-col items-center gap-3">
          <Transition name="ob-toast">
            <p
              v-if="state.openingWorkspaceMessage"
              class="text-sm text-neutral-500 dark:text-neutral-400"
            >
              {{ state.openingWorkspaceMessage }}
            </p>
          </Transition>
          <div
            class="flex flex-wrap mobile:flex-col mobile:w-full mobile:items-stretch mobile:px-4 ob-bottom-nav justify-center gap-3"
          >
            <ui-button
              @click="goToPreviousStep"
              :disabled="state.openingWorkspace"
            >
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
import { computed, ref, watch, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { useStorage } from '@/lib/storage';
import { useStore } from '@/store';
import { useNoteStore } from '@/store/note';
import { useFolderStore } from '@/store/folder';
import { useAccountStore } from '@/store/account';
import { clipboard } from '@/lib/tauri-bridge';
import { useSounds } from '@/composable/useSounds';
import { useTranslations } from '@/composable/useTranslations';
import { useSettingsAccount } from '@/composable/useSettingsAccount';
import { useOnboardingFlow } from '@/composable/useOnboardingFlow';
import { isMacOSRuntime } from '@/lib/tauri/runtime';
import { CURTAIN_DURATIONS } from '@/utils/onboarding/index.js';

const { hold: CURTAIN_HOLD, open: CURTAIN_OPEN } = CURTAIN_DURATIONS;

export default {
  name: 'AppOnboarding',

  setup() {
    const router = useRouter();
    const settingsStorage = useStorage('settings');
    const store = useStore();
    const noteStore = useNoteStore();
    const folderStore = useFolderStore();
    const isMacOS = isMacOSRuntime();

    const { translations } = useTranslations();
    const tr = computed(() => translations.value?.onboarding || {});
    const trAccount = computed(() => translations.value.account || {});
    const trAuth = computed(() => translations.value?.auth || {});
    function fmt(k, params) {
      const raw = tr.value[k] ?? k;
      if (!params) return raw;
      return Object.entries(params).reduce(
        (s, [kk, v]) => s.replace(`{${kk}}`, String(v)),
        raw,
      );
    }
    const accountStore = useAccountStore();

    // Lazy-load useImportExport (tiptap, marked, ~13MB) only when import is triggered
    const importExportRef = ref(null);
    async function runImportSource(...args) {
      if (!importExportRef.value) {
        const { useImportExport } =
          await import('@/utils/import/import-export');
        importExportRef.value = useImportExport({
          clipboard,
          folderStore,
          isMacOS,
          noteStore,
          storage: settingsStorage,
        });
      }
      return importExportRef.value.runImportSource(...args);
    }

    const flow = useOnboardingFlow({
      router,
      clipboard,
      runImportSource,
    });

    // Keep <html> .dark class in sync with the onboarding's own isDark so
    // Tailwind dark: variants activate for child components (Card, Button, Input, etc.)
    watch(
      () => flow.isDark.value,
      (dark) => {
        document.documentElement.classList.toggle('dark', dark);
      },
      { immediate: true },
    );

    // Recycle the Settings account orchestration; errors surface through the onboarding toast.
    const account = useSettingsAccount({
      dialog: { alert() {}, confirm() {} },
      translations,
      showDialogAlert: (msg) => {
        flow.state.error = msg;
      },
    });

    const seedPhaseLabel = computed(() => {
      const phase = accountStore.seedProgress?.phase;
      if (phase === 'presign') return 'Preparing...';
      if (phase === 'snapshots') return 'Uploading notes...';
      if (phase === 'assets') return 'Uploading assets...';
      if (phase === 'finalizing') return 'Finalizing...';
      if (phase === 'done') return 'Complete';
      return 'Setting up...';
    });

    const seedProgressPercent = computed(() => {
      const { uploaded, total } = accountStore.seedProgress || {};
      if (!total) return 0;
      return Math.min(100, Math.round((uploaded / total) * 100));
    });

    async function ensureServerUrl() {
      const url = (account.draftServerUrl.value || '').trim();
      if (url && url !== accountStore.serverUrl) {
        await account.saveServerUrl();
      }
    }

    const handleSignInWithPasskey = async () => {
      await ensureServerUrl();
      await account.handleSignInWithPasskey();
    };
    const handleSignUpWithPasskey = async () => {
      await ensureServerUrl();
      await account.handleSignUpWithPasskey();
    };
    const handleSignInWithPassword = async () => {
      await ensureServerUrl();
      await account.handleSignInWithPassword();
    };
    const handleSignUpWithPassword = async () => {
      await ensureServerUrl();
      await account.handleSignUpWithPassword();
    };

    const showForgot = ref(false);
    const forgotEmail = ref('');
    const forgotBusy = ref(false);
    const forgotMessage = ref('');
    const forgotSent = ref(false);
    async function handleForgot() {
      forgotMessage.value = '';
      forgotSent.value = false;
      const email = forgotEmail.value.trim() || signInEmail.value.trim();
      if (!email) {
        forgotMessage.value = 'Enter your email.';
        return;
      }
      await ensureServerUrl();
      forgotBusy.value = true;
      try {
        const { requestPasswordReset } = await import('@/lib/api/auth');
        const res = await requestPasswordReset(email, {
          baseUrl: accountStore.serverUrl,
        });
        forgotMessage.value =
          res?.message ||
          'If an account exists for that email, you will receive a password reset link. Check your inbox (and spam folder).';
        forgotSent.value = true;
      } catch (e) {
        forgotMessage.value = e?.message || 'Failed to send reset link.';
      } finally {
        forgotBusy.value = false;
      }
    }
    const showRecovery = ref(false);
    const recoverEmail = ref('');
    const recoverCode = ref('');
    const recoverBusy = ref(false);
    const recoverMessage = ref('');
    const recoverSuccess = ref(false);
    async function handleRecover() {
      recoverMessage.value = '';
      recoverSuccess.value = false;
      const email = recoverEmail.value.trim();
      const code = recoverCode.value.trim();
      if (!email || !code) {
        recoverMessage.value = 'Email and code required.';
        return;
      }
      await ensureServerUrl();
      recoverBusy.value = true;
      try {
        const { recoverAccount } = await import('@/lib/api/auth');
        const { saveSessionToken, saveCachedProfile } =
          await import('@/lib/account-storage');
        const { resetApiClient } = await import('@/lib/api/client');
        const res = await recoverAccount(email, code, {
          baseUrl: accountStore.serverUrl,
        });
        const token = res?.token || res?.sessionToken;
        if (token) {
          await saveSessionToken(token);
          const { getAccount } = await import('@/lib/api/account');
          accountStore.setToken(token);
          accountStore.setStatus('authenticated');
          resetApiClient();
          try {
            const data = await getAccount({ baseUrl: accountStore.serverUrl });
            if (data?.profile) await saveCachedProfile(data.profile);
          } catch {}
          recoverSuccess.value = true;
          recoverMessage.value = 'Recovered! Please enroll a new passkey now.';
          // prompt passkey enroll
          const { passkeyRegisterBegin, passkeyRegisterComplete } =
            await import('@/lib/api/auth');
          const opts = await passkeyRegisterBegin(email, 'Recovered device', {
            baseUrl: accountStore.serverUrl,
          });
          await passkeyRegisterComplete(
            email,
            { baseUrl: accountStore.serverUrl },
            opts,
          );
          recoverMessage.value = 'Passkey enrolled successfully.';
        } else {
          recoverMessage.value =
            res?.message || 'Recovered. Please add a passkey from Settings.';
          recoverSuccess.value = !!res?.requiresPasskeyEnroll;
        }
      } catch (e) {
        recoverMessage.value = e?.message || 'Recovery failed.';
      } finally {
        recoverBusy.value = false;
      }
    }

    const curtainOpen = ref(false);
    const { play } = useSounds();

    const prefersReducedMotion = () =>
      typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

    const legacyPasswordValue = ref('');

    async function submitLegacyPassword() {
      if (!legacyPasswordValue.value) return;
      const result = await flow.handleLegacyPasswordSubmit(
        legacyPasswordValue.value,
      );
      if (result.success) legacyPasswordValue.value = '';
    }

    function skipLegacyPassword() {
      legacyPasswordValue.value = '';
      flow.handleLegacyPasswordSkip();
    }

    // Coarse key stays wizard so frame never remounts, only Transition slides.
    const topLevelKey = computed(() =>
      flow.isCardStep.value ? 'wizard' : flow.step.value,
    );

    // 'confirm' phase steps back to source-picking, not out of import.
    function wizardBack() {
      if (
        flow.step.value === 'import' &&
        flow.importPhase.value === 'confirm'
      ) {
        flow.backToPick();
      } else {
        flow.goToPreviousStep();
      }
    }

    // Footer button set per step/phase (Skip vs Start import vs Decrypt
    // notes, …) centralized so each step doesn't need a bespoke nav row.
    const footerButtons = computed(() => {
      const s = flow.step.value;
      const t = translations.value;

      if (s === 'customize') {
        return [
          {
            key: 'continue',
            label: 'Continue',
            icon: 'riArrowRightLine',
            variant: 'primary',
            testid: 'onboarding-customize-next',
            loading: flow.state.savingPreferences,
            onClick: flow.prepareFreshWorkspace,
          },
        ];
      }

      if (s === 'import') {
        const phase = flow.importPhase.value;
        if (phase === 'pick') {
          return [
            {
              key: 'skip',
              label: 'Skip for now',
              testid: 'onboarding-import-skip',
              onClick: flow.skipImport,
            },
          ];
        }
        if (phase === 'confirm') {
          if (flow.showLegacyLockedPrompt.value) {
            return [
              {
                key: 'skip-pw',
                label: 'Skip for now',
                variant: 'secondary',
                onClick: skipLegacyPassword,
              },
              {
                key: 'decrypt',
                label: 'Decrypt notes',
                variant: 'primary',
                loading: flow.state.legacyPasswordLoading,
                onClick: submitLegacyPassword,
              },
            ];
          }
          return [
            {
              key: 'start-import',
              label: 'Start import',
              icon: 'riArrowRightLine',
              variant: 'primary',
              disabled: flow.migrationActionDisabled.value,
              onClick: flow.runSelectedMigration,
            },
          ];
        }
        if (phase === 'running') {
          return [
            {
              key: 'importing',
              label: '',
              variant: 'primary',
              loading: true,
              disabled: true,
            },
          ];
        }
        if (phase === 'done') {
          return [
            {
              key: 'continue',
              label: 'Continue',
              icon: 'riArrowRightLine',
              variant: 'primary',
              onClick: flow.goToNextStep,
            },
          ];
        }
        return [];
      }

      if (s === 'account') {
        if (accountStore.isAuthenticated) {
          return [
            {
              key: 'continue',
              label: 'Continue',
              icon: 'riArrowRightLine',
              variant: 'primary',
              onClick: flow.completeAccountStep,
            },
          ];
        }
        return [
          {
            key: 'skip',
            label: t?.account?.skip || 'Skip for now',
            testid: 'onboarding-account-skip',
            onClick: flow.goToNextStep,
          },
        ];
      }

      if (s === 'sync') {
        if (flow.fresh.syncPath) {
          return [
            {
              key: 'continue',
              label: 'Continue',
              icon: 'riArrowRightLine',
              variant: 'primary',
              testid: 'onboarding-sync-next',
              loading: flow.state.savingPreferences,
              onClick: flow.completeSyncStep,
            },
          ];
        }
        return [
          {
            key: 'skip',
            label: 'Skip for now',
            onClick: flow.completeSyncStep,
          },
        ];
      }

      if (s === 'password') {
        return [
          {
            key: 'continue',
            label: 'Continue',
            icon: 'riArrowRightLine',
            variant: 'primary',
            loading: flow.encryptionPasswordLoading.value,
            onClick: flow.vaultJoinMode.value
              ? flow.adoptVaultPassword
              : flow.setupEncryptionPassword,
          },
        ];
      }

      return [];
    });

    // Intro curtain: starts closed, opens once with a slow retract synced to the intro sound.
    (async function playIntroCurtain() {
      if (prefersReducedMotion()) {
        return;
      }

      await new Promise((r) => setTimeout(r, CURTAIN_HOLD));

      play('intro');
      curtainOpen.value = true;

      await new Promise((r) => setTimeout(r, CURTAIN_OPEN));
    })();

    function assessStrength(pw) {
      if (!pw) return { level: 0, label: '', percent: 0 };
      const len = pw.length;
      if (len < 6)
        return {
          level: 0,
          label: 'Too short',
          percent: Math.max(8, len * 4),
        };

      let score = 0;
      if (len >= 8) score += 1;
      if (len >= 12) score += 1;
      if (len >= 16) score += 1;
      if (/[a-z]/.test(pw) && /[A-Z]/.test(pw)) score += 1;
      if (/\d/.test(pw)) score += 1;
      if (/[^a-zA-Z0-9]/.test(pw)) score += 1;

      if (score <= 1) return { level: 1, label: 'Weak', percent: 25 };
      if (score === 2) return { level: 2, label: 'Fair', percent: 50 };
      if (score <= 4) return { level: 3, label: 'Good', percent: 75 };
      return { level: 4, label: 'Strong', percent: 100 };
    }

    const strength = computed(() =>
      assessStrength(flow.encryptionPassword.value),
    );
    const strengthPercent = computed(() => strength.value.percent);
    const strengthLabel = computed(() => strength.value.label);
    const strengthBarClass = computed(() => {
      const level = strength.value.level;
      if (level === 0) return 'bg-red-400';
      if (level === 1) return 'bg-orange-400';
      if (level === 2) return 'bg-yellow-400';
      if (level === 3) return 'bg-lime-400';
      return 'bg-green-400';
    });
    const strengthTextClass = computed(() => {
      const level = strength.value.level;
      if (level === 0) return 'text-red-500';
      if (level === 1) return 'text-orange-500';
      if (level === 2) return 'text-yellow-600';
      if (level === 3) return 'text-lime-600';
      return 'text-green-600';
    });

    return {
      translations,
      tr,
      fmt,
      trAccount,
      trAuth,
      accountStore,
      draftServerUrl: account.draftServerUrl,
      defaultServerUrl: account.defaultServerUrl,
      ...flow,
      ...account,
      handleSignInWithPasskey,
      handleSignUpWithPasskey,
      handleSignInWithPassword,
      handleSignUpWithPassword,
      showForgot,
      forgotEmail,
      forgotBusy,
      forgotMessage,
      forgotSent,
      handleForgot,
      showRecovery,
      recoverEmail,
      recoverCode,
      recoverBusy,
      recoverMessage,
      recoverSuccess,
      handleRecover,
      curtainOpen,
      legacyPasswordValue,
      submitLegacyPassword,
      skipLegacyPassword,
      strengthPercent,
      strengthLabel,
      strengthBarClass,
      strengthTextClass,
      topLevelKey,
      wizardBack,
      footerButtons,
      seedPhaseLabel,
      seedProgressPercent,
    };
  },
};
</script>

<style scoped>
.ob-light {
  --ob-bg-start: #fff9ec;
  --ob-bg-end: #fff9ec;
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
}

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

/* Default state: curtain closed (covers the screen) */
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

/* Opening: curtain retracts */
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

.ob-logo {
  opacity: 0;
  transform: translateY(-14px) scale(0.985);
  transition:
    opacity 0.28s ease,
    transform 0.4s cubic-bezier(0.22, 1, 0.36, 1);
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
  transition:
    opacity 0.26s ease,
    transform 0.34s cubic-bezier(0.22, 1, 0.36, 1);
}
.ob-below--in {
  opacity: 1;
  transform: none;
}

.ob-finish {
  opacity: 0;
  transform: translateY(12px);
  transition:
    opacity 0.3s ease,
    transform 0.38s cubic-bezier(0.22, 1, 0.36, 1);
}
.ob-finish--in {
  opacity: 1;
  transform: none;
}

.ob-squirkle {
  background: #fae5b8;
  border-radius: 28%;
  overflow: hidden;
}

/* Wizard slide: forward enters from right, back from left. Applied inside modal frame. */
.ob-slide-fwd-enter-active,
.ob-slide-fwd-leave-active,
.ob-slide-back-enter-active,
.ob-slide-back-leave-active {
  transition:
    opacity 0.22s ease,
    transform 0.28s cubic-bezier(0.22, 1, 0.36, 1);
}
.ob-slide-fwd-enter-from {
  opacity: 0;
  transform: translateX(24px);
}
.ob-slide-fwd-leave-to {
  opacity: 0;
  transform: translateX(-24px);
}
.ob-slide-back-enter-from {
  opacity: 0;
  transform: translateX(-24px);
}
.ob-slide-back-leave-to {
  opacity: 0;
  transform: translateX(24px);
}

.ob-toast-enter-active,
.ob-toast-leave-active {
  transition:
    opacity 0.25s ease,
    transform 0.25s ease;
}
.ob-toast-enter-from,
.ob-toast-leave-to {
  opacity: 0;
  transform: translateX(-50%) translateY(4px);
}

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

/* Reduced motion */
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
  .ob-slide-fwd-enter-active,
  .ob-slide-fwd-leave-active,
  .ob-slide-back-enter-active,
  .ob-slide-back-leave-active,
  .ob-toast-enter-active,
  .ob-toast-leave-active {
    transition-duration: 0.01ms !important;
  }
}
</style>
