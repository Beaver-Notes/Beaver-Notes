<template>
  <div class="space-y-8 mb-14 w-full max-w-xl">
    <div class="beaver-sync-ready">
    <section>
      <p class="mb-2">{{ translations.settings.syncPath || 'Sync folder' }}</p>
      <div
        class="space-y-1 bg-neutral-50 dark:bg-neutral-900 rounded-xl border"
      >
        <div class="flex flex-col gap-3 px-4 py-3.5">
          <div class="min-w-0">
            <p
              class="text-sm font-medium text-neutral-800 dark:text-neutral-200"
            >
              {{ translations.settings.syncPath || 'Sync folder' }}
            </p>
            <p
              class="mt-0.5 text-xs leading-relaxed text-neutral-500 dark:text-neutral-400"
            >
              The folder where your notes and assets are stored on disk.
            </p>
          </div>
          <div class="flex items-center gap-2 justify-between">
            <span
              class="max-w-32 sm:max-w-64 truncate rounded-lg bg-neutral-100 px-2 py-1 font-mono text-xs text-neutral-500 dark:bg-neutral-900 dark:text-neutral-400"
              >{{
                state.syncPath ||
                translations.settings.pathPlaceholder ||
                'Not set'
              }}</span
            >
            <div class="flex gap-2">
              <ui-button @click="chooseDefaultPath">{{
                translations.settings.selectPath || 'Browse'
              }}</ui-button>
              <ui-button v-if="state.syncPath" @click="clearPath"
                ><v-remixicon name="riDeleteBin6Line"
              /></ui-button>
            </div>
          </div>
        </div>

        <div
          v-if="cloudSync.isAuthenticated"
          class="border-t border-neutral-200 dark:border-neutral-700 px-4 py-3.5"
        >
          <p class="text-sm font-medium text-neutral-800 dark:text-neutral-200">
            {{ translations.settings.cloudSync || 'Cloud sync' }}
          </p>
          <p class="mt-0.5 text-xs leading-relaxed text-neutral-500 dark:text-neutral-400">
            Sync notes through Beaver Sync (instead of a folder).
          </p>
          <div class="mt-3 space-y-2">
            <div
              v-for="opt in cloudSync.options"
              :key="opt.value"
              class="flex items-center gap-3 rounded-xl border px-3 py-2.5 cursor-pointer transition-colors"
              :class="[
                cloudSync.transport.transport.value === opt.value
                  ? 'border-primary bg-primary/5'
                  : 'border-neutral-200 dark:border-neutral-700 hover:border-neutral-300 dark:hover:border-neutral-600',
                (opt.value !== SYNC_TRANSPORT.FOLDER && !cloudSync.isPaid) || (opt.value !== SYNC_TRANSPORT.REMOTE && !state.syncPath) ? 'opacity-50 pointer-events-none' : '',
              ]"
              @click="cloudSync.selectTransport(opt.value)"
            >
              <div
                class="shrink-0 w-8 h-8 rounded-lg flex items-center justify-center"
                :class="cloudSync.transport.transport.value === opt.value
                  ? 'bg-primary text-white'
                  : 'bg-neutral-100 dark:bg-neutral-900 text-neutral-500 dark:text-neutral-400'"
              >
                <v-remixicon :name="opt.icon" size="16" />
              </div>
              <div class="min-w-0 flex-1">
                <p class="text-sm font-medium text-neutral-800 dark:text-neutral-200">
                  {{ opt.title }}
                </p>
                <p class="text-xs text-neutral-500 dark:text-neutral-400">
                  {{ opt.description }}
                </p>
              </div>
              <div
                v-if="cloudSync.transport.transport.value === opt.value"
                class="shrink-0 w-5 h-5 rounded-full bg-primary flex items-center justify-center"
              >
                <v-remixicon name="riCheckLine" size="12" class="text-white" />
              </div>
            </div>
          </div>
        </div>

        <div
          v-if="syncProgressStore.attention?.tone === 'action'"
          class="mb-3 px-3 py-2 rounded-lg bg-red-50 dark:bg-red-900/30 text-red-700 dark:text-red-300 text-sm flex items-center justify-between gap-2"
          role="alert"
        >
          <span>{{ syncProgressStore.attention.text }}</span>
          <button class="shrink-0 opacity-70 hover:opacity-100" :aria-label="translations.app?.dismiss || 'Dismiss'" @click="syncProgressStore.dismissError()">
            <v-remixicon name="riCloseLine" size="16" />
          </button>
        </div>

        <div
          v-if="state.syncPath || (cloudSync.isAuthenticated && cloudSync.isPaid)"
          class="border-t border-neutral-200 dark:border-neutral-700 flex items-center justify-between gap-3 px-4 py-3.5"
        >
          <p class="text-xs text-neutral-500 dark:text-neutral-400">
            {{ lastSyncLabel }}
          </p>
          <ui-button
            :disabled="syncState.syncing"
            @click="onSyncNow"
          >
            <v-remixicon
              :name="syncState.syncing ? 'riLoader4Line' : 'riRefreshLine'"
              size="16"
              :class="syncState.syncing ? 'animate-spin' : ''"
            />
            <span class="ml-1">
              {{
                syncState.syncing
                  ? translations.settings?.syncing || 'Syncing...'
                  : translations.settings?.syncNow || 'Sync now'
              }}
            </span>
          </ui-button>
        </div>

        <transition name="setting-fade">
          <div
            v-if="syncProgressStore.isSyncing && syncProgressStore.total > 0"
            class="px-4 pb-4"
          >
            <p class="text-xs text-primary">
              {{ syncProgressStore.phaseMessage }}
            </p>
            <div class="mt-1.5 h-1.5 rounded bg-primary/70 dark:bg-primary/20">
              <div
                class="h-1.5 rounded bg-primary dark:bg-primary/80 transition-all duration-200"
                :style="{ width: syncProgressStore.progress + '%' }"
              />
            </div>
          </div>
        </transition>
      </div>
    </section>
    </div>

    <section>
      <p class="mb-2">{{ tr.export || 'Export' }}</p>
      <ui-card padding="p-4" class="flex flex-col gap-4">
        <div class="space-y-1">
          <p class="text-sm font-medium text-neutral-800 dark:text-neutral-200">
            {{ tr.exportDescription || 'Export your data' }}
          </p>
          <p
            class="text-xs leading-relaxed text-neutral-500 dark:text-neutral-400"
          >
            {{ tr.exportDescriptionLong || 'Back up everything as a Beaver Notes archive, or convert all notes to Markdown or HTML files.' }}
          </p>
        </div>
        <div class="flex flex-col gap-2 sm:flex-row sm:items-center">
          <ui-button class="w-full" :aria-label="tr.export || 'Export'" @click="openExportModal()">
            {{ tr.export || 'Export' }}
          </ui-button>
        </div>
      </ui-card>

      <ui-modal v-model="showExportModal" content-class="max-w-md" :title="tr.export || 'Export'" icon="riFileDownloadLine">

        <p
          class="mb-4 text-neutral-600 leading-relaxed dark:text-neutral-200"
        >
          {{ tr.exportDescriptionLong || 'Back up everything as a Beaver Notes archive, or convert all notes to Markdown or HTML files.' }}
        </p>

        <div class="space-y-1">
          <div v-for="option in exportOptions" :key="option.key">
            <button
              type="button"
              class="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-colors"
              :class="
                selectedExportKey === option.key
                  ? 'bg-primary/10 ring-1 ring-inset ring-primary'
                  : 'hover:bg-neutral-100 dark:hover:bg-neutral-800'
              "
              @click="selectedExportKey = option.key"
            >
              <span
                class="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg transition-colors"
                :class="
                  selectedExportKey === option.key
                    ? 'bg-primary/15 text-primary'
                    : 'bg-neutral-100 text-neutral-500 dark:bg-neutral-800 dark:text-neutral-400'
                "
              >
                <v-remixicon :name="option.icon" size="18" />
              </span>
              <span
                class="min-w-0 flex-1 text-sm font-medium"
                :class="
                  selectedExportKey === option.key
                    ? 'text-primary'
                    : 'text-neutral-800 dark:text-neutral-200'
                "
              >
                {{ option.title }}
              </span>
            </button>

            <div
              v-if="selectedExportKey === option.key"
              class="space-y-3 px-3 pb-2 pt-1"
            >
              <p
                class="text-xs leading-relaxed text-neutral-500 dark:text-neutral-400"
              >
                {{ option.description }}
              </p>

              <template v-if="option.key === 'backup'">
                <p
                  v-if="backupExportState.running"
                  class="text-xs text-neutral-500 dark:text-neutral-400"
                >
                  {{ tr.creatingBackup || 'Creating backup…' }}
                </p>
              </template>

              <template v-else>
                <div
                  v-if="bulkExportState(option.key).running"
                  class="space-y-1 text-xs text-neutral-500 dark:text-neutral-400"
                >
                  <p v-if="bulkExportState(option.key).total">
                    Exporting {{ bulkExportState(option.key).done }} of
                    {{ bulkExportState(option.key).total }}…
                  </p>
                </div>
                <div
                  v-else-if="bulkExportState(option.key).result"
                  class="space-y-2 border-t border-neutral-200 pt-2 text-xs text-neutral-500 dark:border-neutral-700 dark:text-neutral-400"
                >
                  <p>
                    Exported {{ bulkExportState(option.key).result.exported }}
                    notes<span
                      v-if="bulkExportState(option.key).result.skipped.length"
                    >
                      .
                      {{
                        bulkExportState(option.key).result.skipped.length
                      }}
                      skipped.</span
                    ><span v-else>.</span>
                  </p>
                  <details
                    v-if="bulkExportState(option.key).result.skipped.length"
                  >
                    <summary class="cursor-pointer select-none">
                      Show skipped ({{
                        bulkExportState(option.key).result.skipped.length
                      }})
                    </summary>
                    <ul class="mt-2 space-y-1 pl-4">
                      <li
                        v-for="item in bulkExportState(option.key).result
                          .skipped"
                        :key="`${option.key}-${item.title}`"
                      >
                        {{ item.title }}
                      </li>
                    </ul>
                  </details>
                </div>
              </template>
            </div>
          </div>
        </div>

        <template #actions>
          <ui-button
            class="w-full mobile:!min-h-[48px] mobile:!h-auto mobile:!py-3"
            :aria-label="translations.dialog?.cancel || 'Cancel'"
            :disabled="isExportRunning(selectedExportKey)"
            @click="showExportModal = false"
          >
            {{ translations.dialog?.cancel || 'Cancel' }}
          </ui-button>
          <ui-button
            class="w-full mobile:!min-h-[48px] mobile:!h-auto mobile:!py-3"
            variant="primary"
            :loading="isExportRunning(selectedExportKey)"
            :disabled="isExportRunning(selectedExportKey)"
            :aria-label="activeExportOption?.buttonLabel"
            @click="runSelectedExport(selectedExportKey)"
          >
            {{ activeExportOption?.buttonLabel }}
          </ui-button>
        </template>
      </ui-modal>
    </section>

    <section>
      <p class="mb-2">{{ tr.import || 'Import' }}</p>
      <ui-card padding="p-4" class="flex flex-col gap-4">
        <div class="space-y-1">
          <p class="text-sm font-medium text-neutral-800 dark:text-neutral-200">
            {{ tr.importDescription || 'Import your data' }}
          </p>
          <p
            class="text-xs leading-relaxed text-neutral-500 dark:text-neutral-400"
          >
            {{ tr.importDescriptionLong || 'Restore a Beaver Notes backup, or bring notes in from Obsidian, Notion, Bear, Simplenote, Word documents, Markdown folders, Evernote, and Apple Notes on macOS.' }}
          </p>
        </div>
        <div class="flex flex-col gap-2 sm:flex-row sm:items-center">
          <ui-button class="w-full" :aria-label="tr.import || 'Import'" @click="openImportModal('beaverBackup')">
            {{ tr.import || 'Import' }}
          </ui-button>
        </div>
      </ui-card>

      <ui-modal v-model="showImportModal" content-class="max-w-md" :title="tr.import || 'Import'" icon="riFileUploadLine">

        <p
          class="mb-4 text-neutral-600 leading-relaxed dark:text-neutral-200"
        >
          {{ tr.importDescriptionShort || 'Restore a Beaver Notes backup, or bring notes in from other apps.' }}
        </p>

        <div class="max-h-[24rem] space-y-1 overflow-y-auto">
          <template v-for="group in importSourceGroups" :key="group.label">
            <p
              class="px-3 pb-1 pt-3 text-[11px] font-semibold uppercase tracking-wider text-neutral-400 dark:text-neutral-500"
            >
              {{ group.label }}
            </p>
            <div v-for="source in group.items" :key="source.key">
              <button
                type="button"
                class="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-colors"
                :class="
                  selectedImportSource === source.key
                    ? 'bg-primary/10 ring-1 ring-inset ring-primary'
                    : 'hover:bg-neutral-100 dark:hover:bg-neutral-800'
                "
                @click="selectedImportSource = source.key"
              >
                <span
                  class="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg transition-colors"
                  :class="
                    selectedImportSource === source.key
                      ? 'bg-primary/15 text-primary'
                      : 'bg-neutral-100 text-neutral-500 dark:bg-neutral-800 dark:text-neutral-400'
                  "
                >
                  <v-remixicon :name="source.icon" size="18" />
                </span>
                <span
                  class="min-w-0 flex-1 truncate text-sm font-medium"
                  :class="
                    selectedImportSource === source.key
                      ? 'text-primary'
                      : 'text-neutral-800 dark:text-neutral-200'
                  "
                >
                  {{ source.title }}
                </span>
              </button>

              <div
                v-if="selectedImportSource === source.key"
                class="space-y-3 px-3 pb-2 pt-1"
              >
                <p
                  class="text-xs leading-relaxed text-neutral-500 dark:text-neutral-400"
                >
                  {{ source.description }}
                </p>

                <div v-if="source.key === 'evernote'" class="space-y-1">
                  <label
                    class="text-xs font-medium text-neutral-700 dark:text-neutral-300"
                  >
                    {{ tr.notebookName || 'Notebook name' }}
                  </label>
                  <ui-input
                    v-model="importState.evernote.notebookName"
                    :placeholder="tr.notebookNamePlaceholder || 'Notebook name (optional)'"
                    :aria-label="tr.notebookName || 'Notebook name'"
                    class="w-full"
                  />
                </div>

                <p
                  v-if="
                    importState[source.key].running &&
                    importState[source.key].total
                  "
                  class="text-xs text-neutral-500 dark:text-neutral-400"
                >
                  Importing {{ importState[source.key].done }} of
                  {{ importState[source.key].total }}…
                </p>

                <div
                  v-else-if="importState[source.key].result"
                  class="space-y-2 border-t border-neutral-200 pt-2 text-xs text-neutral-500 dark:border-neutral-700 dark:text-neutral-400"
                >
                  <p>
                    Imported {{ importState[source.key].result.imported }} notes
                    across {{ importState[source.key].result.folders }} folders.
                  </p>
                  <details
                    v-if="importState[source.key].result.errors.length"
                    class="space-y-2"
                  >
                    <summary class="cursor-pointer select-none">
                      Show issues ({{
                        importState[source.key].result.errors.length
                      }})
                    </summary>
                      <ui-button
                      class="w-full"
                      variant="secondary"
                      :aria-label="tr.copyToClipboard || 'Copy to clipboard'"
                      @click="copyImportIssues(source.key)"
                    >
                      {{ tr.copyToClipboard || 'Copy to clipboard' }}
                    </ui-button>
                    <div
                      class="max-h-40 overflow-auto rounded-lg bg-neutral-100 p-3 font-mono text-[11px] whitespace-pre-wrap dark:bg-neutral-950"
                    >
                      {{ getImportIssuesText(source.key) }}
                    </div>
                  </details>
                </div>
              </div>
            </div>
          </template>
        </div>

        <template #actions>
          <ui-button
            class="w-full mobile:!min-h-[48px] mobile:!h-auto mobile:!py-3"
            :aria-label="translations.dialog?.cancel || 'Cancel'"
            :disabled="activeImportState?.running"
            @click="showImportModal = false"
          >
            {{ translations.dialog?.cancel || 'Cancel' }}
          </ui-button>
          <ui-button
            class="w-full mobile:!min-h-[48px] mobile:!h-auto mobile:!py-3"
            :variant="
              selectedImportSource === 'beaverBackup' ? 'danger' : 'primary'
            "
            :loading="activeImportState?.running"
            :disabled="activeImportState?.running"
            @click="runSelectedImport(selectedImportSource)"
          >
            {{ activeImportSource?.buttonLabel }}
          </ui-button>
        </template>
      </ui-modal>
    </section>

    <div class="flex items-center gap-1.5 px-1 text-neutral-500">
      <v-remixicon name="riQuestionLine" size="14" />
      <p class="text-xs">
        <span v-tooltip:right="translations.settings.encryptionMessage">
          {{
            translations.settings.aboutDataEncryption ||
            'About data encryption'
          }}
        </span>
      </p>
    </div>
  </div>
</template>
<script>
import { computed, ref, reactive, onMounted } from 'vue';
import { useDialog } from '@/lib/dialog';
import { useTranslations } from '@/composable/useTranslations';
import { useSettingsData } from '@/composable/useSettingsData';
import { useSettingsCloudSync } from '@/utils/sync/settings-cloud-sync';
import { useImportExport } from '@/utils/import/import-export';
import { useNoteStore } from '@/store/note';
import { useFolderStore } from '@/store/folder';
import { useStorage } from '@/lib/storage';
import { useAccountStore } from '@/store/account';
import { useSyncProgressStore } from '@/store/sync-progress';
import { getAccount } from '@/lib/api/account';
import { SYNC_TRANSPORT } from '@/lib/api/types';
import { clipboard } from '@/lib/tauri-bridge';
import { isMacOSRuntime } from '@/lib/tauri/runtime';
import { forceSyncNow } from '@/utils/sync';

export default {
  setup() {
    const { translations } = useTranslations();
    const tr = computed(() => translations.value?.dataView || {});
    function fmt(key, params) {
      const raw = tr.value[key] ?? key;
      if (!params) return raw;
      return Object.entries(params).reduce((s, [k, v]) => s.replace(`{${k}}`, String(v)), raw);
    }
    const dialog = useDialog();
    const storage = useStorage();
    const noteStore = useNoteStore();
    const folderStore = useFolderStore();
    const accountStore = useAccountStore();
    const isMacOS = computed(() => isMacOSRuntime());

    const lastSyncAt = ref(Number(localStorage.getItem('sync:lastRunAt') || 0));
    const syncState = ref({ syncing: false });

    const lastSyncLabel = computed(() => {
      if (!lastSyncAt.value)
        return translations.settings?.neverSynced || 'Never synced yet';
      const secs = Math.floor((Date.now() - lastSyncAt.value) / 1000);
      if (secs < 60)
        return translations.settings?.syncedJustNow || 'Synced just now';
      if (secs < 3600) {
        const min = Math.floor(secs / 60);
        return `${translations.settings?.syncedMinAgo || 'Synced {n} min ago'}`.replace(
          '{n}',
          String(min)
        );
      }
      return new Date(lastSyncAt.value).toLocaleString();
    });

    async function onSyncNow() {
      if (syncState.value.syncing) return;
      syncState.value = { syncing: true };
      try {
        await forceSyncNow();
        lastSyncAt.value = Date.now();
        localStorage.setItem('sync:lastRunAt', String(lastSyncAt.value));
      } catch {
        // Failure surfaces via syncProgressStore.attention (sync:status listener)
      } finally {
        syncState.value = { syncing: false };
      }
    }

    const syncProgressStore = useSyncProgressStore();

    const {
      state,
      chooseDefaultPath,
      clearPath,
      exportData,
      importData,
    } = useSettingsData({
      dialog,
      folderStore,
      noteStore,
      translations,
    });

    const cloudSync = useSettingsCloudSync();

    onMounted(() => {
      if (accountStore.isAuthenticated && !accountStore.subscription) {
        getAccount({ baseUrl: accountStore.serverUrl })
          .then((data) => {
            if (data) {
              accountStore.setProfile(data.profile);
              accountStore.setSubscription(data.subscription);
              accountStore.setDevices(data.devices || []);
            }
          })
          .catch(() => {});
      }
    });

    const {
      copyImportIssues,
      exportAllHTMLHandler,
      exportAllMarkdownHandler,
      exportHtmlState,
      exportMdState,
      getImportIssuesText,
      importSourceGroups,
      importSources,
      importState,
      openImportModal,
      runImportSource,
      selectedImportSource,
      showImportModal,
    } = useImportExport({
      clipboard,
      folderStore,
      isMacOS,
      noteStore,
      storage,
      translations,
    });

    const exportOptions = [
      {
        key: 'backup',
        title: 'Beaver Notes Backup',
        icon: 'riArchiveLine',
        description:
          'Full backup of all notes, folders, labels, and settings as a dated archive folder. Use this to move devices or keep backups.',
        buttonLabel: 'Create Backup',
      },
      {
        key: 'markdown',
        title: 'Markdown',
        icon: 'riMarkdownLine',
        description:
          'Export all notes as .md files with YAML frontmatter. Compatible with Obsidian, Bear, and most Markdown editors.',
        buttonLabel: 'Export Markdown',
      },
      {
        key: 'html',
        title: 'HTML',
        icon: 'riGlobalLine',
        description:
          'Export all notes as .html files preserving folder structure. Open any file in a browser.',
        buttonLabel: 'Export HTML',
      },
    ];

    const showExportModal = ref(false);
    const selectedExportKey = ref('backup');
    const backupExportState = reactive({ running: false });

    const activeExportOption = computed(
      () =>
        exportOptions.find((option) => option.key === selectedExportKey.value) ||
        null
    );
    const activeImportSource = computed(
      () =>
        importSources.value.find(
          (source) => source.key === selectedImportSource.value
        ) || null
    );
    const activeImportState = computed(
      () => importState[selectedImportSource.value] || null
    );

    function bulkExportState(key) {
      return key === 'markdown' ? exportMdState : exportHtmlState;
    }

    function isExportRunning(key) {
      return key === 'backup'
        ? backupExportState.running
        : bulkExportState(key).running;
    }

    function openExportModal(key = selectedExportKey.value) {
      if (exportOptions.some((option) => option.key === key)) {
        selectedExportKey.value = key;
      }
      showExportModal.value = true;
    }

    async function runSelectedExport(key) {
      if (isExportRunning(key)) return;
      if (key === 'backup') {
        backupExportState.running = true;
        try {
          await exportData();
        } finally {
          backupExportState.running = false;
        }
        return;
      }
      await (key === 'markdown'
        ? exportAllMarkdownHandler()
        : exportAllHTMLHandler());
    }

    async function runSelectedImport(key) {
      if (key === 'beaverBackup') {
        await importData();
        return;
      }
      await runImportSource(key);
    }

    return {
      translations,
      tr,
      fmt,
      state,
      chooseDefaultPath,
      clearPath,
      syncProgressStore,
      cloudSync,
      SYNC_TRANSPORT,
      exportData,
      importData,
      exportOptions,
      showExportModal,
      selectedExportKey,
      backupExportState,
      bulkExportState,
      isExportRunning,
      openExportModal,
      runSelectedExport,
      runSelectedImport,
      activeExportOption,
      activeImportSource,
      activeImportState,
      importSourceGroups,
      getImportIssuesText,
      copyImportIssues,
      importState,
      openImportModal,
      selectedImportSource,
      showImportModal,
      lastSyncAt,
      syncState,
      lastSyncLabel,
      onSyncNow,
    };
  },
};
</script>
