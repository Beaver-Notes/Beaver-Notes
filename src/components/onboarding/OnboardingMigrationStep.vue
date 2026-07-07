<template>
  <div
    class="ob-screen flex flex-col items-center justify-center mobile:justify-end w-full"
  >
    <ui-card class="w-full max-w-lg max-h-[80dvh] flex flex-col">
      <div class="flex flex-col items-center gap-2 my-8 text-center shrink-0">
        <h2
          class="text-3xl font-semibold tracking-tight text-neutral-800 dark:text-neutral-200"
        >
          Import your notes from {{ migrationPlatformLabel }}
        </h2>
        <p class="text-neutral-600 dark:text-neutral-400 max-w-sm">
          Your original data stays untouched. Notes, folders, labels, settings,
          and assets will be copied over.
        </p>
      </div>

      <div class="flex flex-col gap-2 overflow-y-auto flex-1 min-h-0">
        <div class="flex items-center justify-between gap-4 p-4">
          <div>
            <p
              class="text-sm font-semibold text-neutral-800 dark:text-neutral-200"
            >
              {{ migrationSourceHeading }}
            </p>
            <p
              class="text-sm font-semibold text-neutral-800 dark:text-neutral-200"
            >
              {{ migrationSourceCopy }}
            </p>
          </div>
        </div>

        <ui-card
          v-if="migrationPlatform === 'evernote' && !migrating"
          class="bg-input"
        >
          <div class="flex flex-col gap-2 p-4">
            <p
              class="text-xs font-bold uppercase tracking-widest text-neutral-500 dark:text-neutral-500"
            >
              Evernote notebook
            </p>
            <ui-input
              :value="evernoteNotebookName"
              placeholder="Notebook name (optional)"
              class="w-full"
              @input="$emit('update:evernoteNotebookName', $event)"
            />
          </div>
        </ui-card>

        <ui-card v-if="migrating || migrationDone" class="bg-input">
          <div class="flex flex-col gap-3 p-4">
            <div class="flex items-center justify-between">
              <p
                class="text-xs font-bold uppercase tracking-widest text-neutral-500 dark:text-neutral-500"
              >
                {{ migrationDone ? 'Import complete' : 'Importing…' }}
              </p>
              <span class="text-xs font-bold text-primary"
                >{{ migrationProgress }}%</span
              >
            </div>
            <div
              class="h-1.5 rounded-full bg-neutral-100 dark:bg-neutral-900 overflow-hidden"
            >
              <div
                class="h-full rounded-full bg-primary transition-all duration-300 ease-out"
                :style="{ width: migrationProgress + '%' }"
              ></div>
            </div>
            <p class="text-xs text-neutral-600 dark:text-neutral-400">
              {{ migrationStatus }}
            </p>
            <p
              v-if="migrationCurrent"
              class="text-xs text-neutral-600 dark:text-neutral-400 opacity-80"
            >
              {{ migrationCurrent }}
            </p>
          </div>
        </ui-card>

        <ui-card v-if="!migrating && !migrationDone" class="bg-input">
          <div class="flex flex-col gap-1 p-4">
            <p
              class="text-xs font-bold uppercase tracking-widest text-neutral-500 dark:text-neutral-500 mb-1"
            >
              What gets copied
            </p>
            <p class="text-sm text-neutral-600 dark:text-neutral-400">
              {{ migrationWhatGetsCopied }}
            </p>
          </div>
        </ui-card>

        <ui-card
          v-if="
            migrationPlatform === 'electron' &&
            (status?.legacyDir || status?.appDir || customLegacyPath)
          "
          class="bg-input"
        >
          <div class="flex flex-col gap-4 p-4">
            <div v-if="customLegacyPath" class="flex flex-col gap-1">
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
            <div v-else-if="status?.legacyDir" class="flex flex-col gap-1">
              <span
                class="text-xs font-bold uppercase tracking-widest text-neutral-500 dark:text-neutral-500"
              >
                Beaver Notes (Legacy)
              </span>
              <code
                class="text-xs font-mono break-all px-2 py-1.5 rounded-lg bg-neutral-100 dark:bg-neutral-900 text-neutral-600 dark:text-neutral-300"
              >
                {{ status.legacyDir }}
              </code>
            </div>
            <div v-if="status?.appDir" class="flex flex-col gap-1">
              <span
                class="text-xs font-bold uppercase tracking-widest text-neutral-500 dark:text-neutral-500"
              >
                New Beaver Notes
              </span>
              <code
                class="text-xs font-mono break-all px-2 py-1.5 rounded-lg bg-neutral-100 dark:bg-neutral-900 text-neutral-600 dark:text-neutral-300"
              >
                {{ status.appDir }}
              </code>
            </div>
          </div>
        </ui-card>

        <ui-card
          v-if="
            migrationPlatform === 'electron' &&
            !status?.hasLegacyData &&
            !migrating &&
            !migrationDone
          "
          class="bg-input"
        >
          <div class="flex items-center justify-between gap-4 p-4">
            <div>
              <p
                class="text-xs font-bold uppercase tracking-widest text-neutral-500 dark:text-neutral-500 mb-1"
              >
                Windows Portable
              </p>
              <p class="text-sm text-neutral-600 dark:text-neutral-400">
                Using the portable version? Locate your data folder manually.
              </p>
            </div>
            <ui-button @click="$emit('browsePortable')">Browse…</ui-button>
          </div>
        </ui-card>

        <ui-card v-if="migrationDone && migrationResult" class="bg-input">
          <div class="flex flex-col gap-1 p-4">
            <p
              class="text-xs font-bold uppercase tracking-widest text-neutral-500 dark:text-neutral-500 mb-1"
            >
              Import summary
            </p>
            <p class="text-sm text-neutral-600 dark:text-neutral-400">
              Imported {{ migrationResult.imported || 0 }} notes across
              {{ migrationResult.folders || 0 }} folders.
            </p>
          </div>
        </ui-card>

        <ui-card v-if="migrationDone && migrationIssuesText" class="bg-input">
          <div class="flex flex-col gap-3 p-4">
            <div class="flex items-center justify-between gap-3">
              <p
                class="text-xs font-bold uppercase tracking-widest text-neutral-500 dark:text-neutral-500"
              >
                Issues
              </p>
              <ui-button variant="secondary" @click="$emit('copyIssues')">
                Copy to clipboard
              </ui-button>
            </div>
            <div
              class="max-h-40 overflow-auto rounded-lg bg-neutral-100 p-3 font-mono text-[11px] whitespace-pre-wrap text-neutral-600 dark:bg-neutral-900 dark:text-neutral-300"
            >
              {{ migrationIssuesText }}
            </div>
          </div>
        </ui-card>
      </div>

      <div class="mt-5 flex justify-between gap-4 shrink-0">
        <ui-button :disabled="migrating" @click="$emit('back')">
          <v-remixicon name="riArrowLeftLine" /> Back
        </ui-button>
        <ui-button
          v-if="!migrating && !migrationDone"
          variant="primary"
          :disabled="migrationActionDisabled"
          @click="$emit('runMigration')"
        >
          Start import <v-remixicon name="riArrowRightLine" />
        </ui-button>
        <ui-button
          v-else-if="migrationDone"
          variant="primary"
          @click="$emit('continue')"
        >
          Continue <v-remixicon name="riArrowRightLine" />
        </ui-button>
        <ui-button v-else variant="primary" loading disabled />
      </div>
    </ui-card>
  </div>
</template>

<script>
export default {
  props: {
    migrationPlatformLabel: { type: String, default: '' },
    migrationSourceHeading: { type: String, default: '' },
    migrationSourceCopy: { type: String, default: '' },
    migrationPlatform: { type: String, default: '' },
    migrationWhatGetsCopied: { type: String, default: '' },
    migrationActionDisabled: { type: Boolean, default: false },
    migrating: { type: Boolean, default: false },
    migrationDone: { type: Boolean, default: false },
    migrationProgress: { type: Number, default: 0 },
    migrationStatus: { type: String, default: '' },
    migrationCurrent: { type: String, default: '' },
    migrationResult: { type: Object, default: null },
    migrationIssuesText: { type: String, default: '' },
    status: { type: Object, default: null },
    customLegacyPath: { type: String, default: '' },
    evernoteNotebookName: { type: String, default: '' },
  },
  emits: [
    'update:evernoteNotebookName',
    'runMigration',
    'copyIssues',
    'browsePortable',
    'back',
    'continue',
  ],
};
</script>
