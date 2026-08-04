<template>
  <div class="space-y-8 mb-14 w-full max-w-xl">
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
          v-if="state.syncPath"
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
            v-if="syncProgress?.phase === 'assets' && syncProgress.total > 0"
            class="px-4 pb-4"
          >
            <p class="text-xs text-primary">
              {{ Math.min(100, Math.floor((syncProgress.processed /
              syncProgress.total) * 100)) }}%)
            </p>
            <div class="mt-1.5 h-1.5 rounded bg-primary/70 dark:bg-primary/20">
              <div
                class="h-1.5 rounded bg-primary dark:bg-primary/80 transition-all duration-200"
                :style="{
                  width: `${Math.min(
                    100,
                    Math.floor(
                      (syncProgress.processed / syncProgress.total) * 100
                    )
                  )}%`,
                }"
              />
            </div>
          </div>
        </transition>
      </div>
    </section>

    <section>
      <p class="mb-2">Export</p>
      <div class="grid grid-cols-1 items-stretch gap-3 sm:grid-cols-2">
        <ui-card padding="p-4" class="flex h-full flex-col gap-3">
          <div class="space-y-0.5">
            <p
              class="text-sm font-medium text-neutral-800 dark:text-neutral-200"
            >
              Export as Markdown
            </p>
            <p
              class="mt-0.5 text-xs leading-relaxed text-neutral-500 dark:text-neutral-400"
            >
              Export all notes as .md files with YAML frontmatter. Compatible
              with Obsidian, Bear, and most Markdown editors.
            </p>
          </div>
          <div class="mt-auto space-y-2 pt-2">
            <ui-button
              class="w-full"
              :loading="exportMdState.running"
              :disabled="exportMdState.running"
              @click="exportAllMarkdownHandler"
            >
              Export Markdown
            </ui-button>
            <p
              v-if="exportMdState.running && exportMdState.total"
              class="text-xs text-neutral-500 dark:text-neutral-400"
            >
              Exporting {{ exportMdState.done }} of {{ exportMdState.total }}…
            </p>
            <template v-else-if="exportMdState.result">
              <p class="text-xs text-neutral-500 dark:text-neutral-400">
                Exported {{ exportMdState.result.exported }} notes<span
                  v-if="exportMdState.result.skipped.length"
                >
                  . {{ exportMdState.result.skipped.length }} skipped.</span
                ><span v-else>.</span>
              </p>
              <details
                v-if="exportMdState.result.skipped.length"
                class="text-xs text-neutral-500 dark:text-neutral-400"
              >
                <summary class="cursor-pointer select-none">
                  Show skipped ({{ exportMdState.result.skipped.length }})
                </summary>
                <ul class="mt-2 space-y-1 pl-4">
                  <li
                    v-for="item in exportMdState.result.skipped"
                    :key="`md-${item.title}`"
                  >
                    {{ item.title }}
                  </li>
                </ul>
              </details>
            </template>
          </div>
        </ui-card>

        <ui-card padding="p-4" class="flex h-full flex-col gap-3">
          <div class="space-y-0.5">
            <p
              class="text-sm font-medium text-neutral-800 dark:text-neutral-200"
            >
              Export as HTML
            </p>
            <p
              class="mt-0.5 text-xs leading-relaxed text-neutral-500 dark:text-neutral-400"
            >
              Export all notes as .html files preserving folder structure. Open
              any file in a browser.
            </p>
          </div>
          <div class="mt-auto space-y-2 pt-2">
            <ui-button
              class="w-full"
              :loading="exportHtmlState.running"
              :disabled="exportHtmlState.running"
              @click="exportAllHTMLHandler"
            >
              Export HTML
            </ui-button>
            <p
              v-if="exportHtmlState.running && exportHtmlState.total"
              class="text-xs text-neutral-500 dark:text-neutral-400"
            >
              Exporting {{ exportHtmlState.done }} of
              {{ exportHtmlState.total }}…
            </p>
            <template v-else-if="exportHtmlState.result">
              <p class="text-xs text-neutral-500 dark:text-neutral-400">
                Exported {{ exportHtmlState.result.exported }} notes<span
                  v-if="exportHtmlState.result.skipped.length"
                >
                  . {{ exportHtmlState.result.skipped.length }} skipped.</span
                ><span v-else>.</span>
              </p>
              <details
                v-if="exportHtmlState.result.skipped.length"
                class="text-xs text-neutral-500 dark:text-neutral-400"
              >
                <summary class="cursor-pointer select-none">
                  Show skipped ({{ exportHtmlState.result.skipped.length }})
                </summary>
                <ul class="mt-2 space-y-1 pl-4">
                  <li
                    v-for="item in exportHtmlState.result.skipped"
                    :key="`html-${item.title}`"
                  >
                    {{ item.title }}
                  </li>
                </ul>
              </details>
            </template>
          </div>
        </ui-card>
      </div>
    </section>

    <section>
      <p class="mb-2">Import</p>
      <ui-card padding="p-4" class="flex flex-col gap-4">
        <div class="space-y-1">
          <p class="text-sm font-medium text-neutral-800 dark:text-neutral-200">
            Import notes
          </p>
          <p
            class="text-xs leading-relaxed text-neutral-500 dark:text-neutral-400"
          >
            Import data from Obsidian, Notion, Bear, Simplenote, Word documents,
            Markdown folders, Evernote, and Apple Notes on macOS.
          </p>
        </div>
        <div class="flex flex-col gap-2 sm:flex-row sm:items-center">
          <ui-button class="w-full" @click="openImportModal()">
            Import
          </ui-button>
        </div>
      </ui-card>

      <ui-modal v-model="showImportModal" content-class="max-w-3xl">
        <template #header>
          <div>
            <h3 class="text-lg font-semibold text-neutral-900 dark:text-white">
              Import Notes
            </h3>
            <p class="mt-1 text-xs text-neutral-500 dark:text-neutral-400">
              Choose a source, review the instructions, then run the import.
            </p>
          </div>
        </template>

        <div
          class="grid grid-cols-1 border-t border-neutral-100 md:grid-cols-[13rem_minmax(0,1fr)] dark:border-neutral-800"
        >
          <aside class="p-4 md:p-5">
            <div class="space-y-0.5">
              <button
                v-for="source in importSources"
                :key="source.key"
                type="button"
                class="w-full rounded-lg px-2.5 py-2 text-left text-sm transition-colors"
                :class="
                  selectedImportSource === source.key
                    ? 'bg-primary/10 font-medium text-primary'
                    : 'text-neutral-600 hover:bg-neutral-100 hover:text-neutral-900 dark:text-neutral-300 dark:hover:bg-neutral-800 dark:hover:text-white'
                "
                @click="selectImportSource(source.key)"
              >
                <span class="flex items-center gap-2">
                  <v-remixicon :name="source.icon" size="16" />
                  <span>{{ source.title }}</span>
                </span>
              </button>
            </div>
          </aside>

          <div
            v-if="activeImportSource"
            class="min-w-0 p-4 md:flex md:min-h-[20rem] md:flex-col md:p-5"
          >
            <div class="flex flex-1 flex-col gap-4">
              <div class="space-y-1">
                <div class="flex items-center gap-2">
                  <v-remixicon
                    :name="activeImportSource.icon"
                    size="18"
                    class="text-neutral-500 dark:text-neutral-400"
                  />
                  <p
                    class="text-sm font-medium text-neutral-800 dark:text-neutral-200"
                  >
                    {{ activeImportSource.title }}
                  </p>
                </div>
                <p
                  class="text-xs leading-relaxed text-neutral-500 dark:text-neutral-400"
                >
                  {{ activeImportSource.description }}
                </p>
              </div>

              <div v-if="selectedImportSource === 'evernote'" class="space-y-1">
                <label
                  class="text-xs font-medium text-neutral-700 dark:text-neutral-300"
                >
                  Notebook name
                </label>
                <ui-input
                  v-model="importState.evernote.notebookName"
                  placeholder="Notebook name (optional)"
                  class="w-full"
                />
              </div>

              <div class="mt-auto space-y-3">
                <div class="flex flex-col gap-2 sm:flex-row sm:items-center">
                  <p
                    v-if="activeImportState.running && activeImportState.total"
                    class="text-xs text-neutral-500 dark:text-neutral-400"
                  >
                    Importing {{ activeImportState.done }} of
                    {{ activeImportState.total }}…
                  </p>
                  <ui-button
                    class="sm:ml-auto sm:w-auto"
                    :loading="activeImportState.running"
                    :disabled="activeImportState.running"
                    @click="startSelectedImport"
                  >
                    {{ activeImportSource.buttonLabel }}
                  </ui-button>
                </div>

                <div
                  v-if="activeImportState.result"
                  class="space-y-3 border-t border-neutral-200 pt-3 dark:border-neutral-700"
                >
                  <p class="text-xs text-neutral-500 dark:text-neutral-400">
                    Imported {{ activeImportState.result.imported }} notes
                    across {{ activeImportState.result.folders }} folders.
                  </p>
                  <details
                    v-if="activeImportState.result.errors.length"
                    class="space-y-2 text-xs text-neutral-500 dark:text-neutral-400"
                  >
                    <summary class="cursor-pointer select-none">
                      Show issues ({{ activeImportState.result.errors.length }})
                    </summary>
                    <ui-button
                      class="w-full sm:w-auto"
                      variant="secondary"
                      @click="copyImportIssues(selectedImportSource)"
                    >
                      Copy to clipboard
                    </ui-button>
                    <div
                      class="max-h-56 overflow-auto rounded-lg bg-neutral-100 p-3 font-mono text-[11px] whitespace-pre-wrap dark:bg-neutral-950"
                    >
                      {{ activeImportIssuesText }}
                    </div>
                  </details>
                </div>
              </div>
            </div>
          </div>
        </div>
      </ui-modal>
    </section>

    <section>
      <p class="mb-2">
        {{ translations.settings.data || 'Data' }}
      </p>
      <div class="grid grid-cols-1 items-stretch gap-3 sm:grid-cols-2">
        <ui-card padding="p-4" class="flex h-full flex-col gap-3">
          <div class="space-y-0.5">
            <p
              class="text-sm font-medium text-neutral-800 dark:text-neutral-200"
            >
              {{ translations.settings.exportData || 'Export data' }}
            </p>
            <p
              class="mt-0.5 text-xs leading-relaxed text-neutral-500 dark:text-neutral-400"
            >
              Save a full backup of all notes, folders, and labels as a dated
              archive.
            </p>
          </div>
          <div class="mt-auto space-y-2 pt-2">
            <label
              class="editor-checkbox text-sm text-neutral-700 dark:text-neutral-200"
            >
              <input v-model="state.withPassword" type="checkbox" />
              <span>{{
                translations.settings.encryptPasswd || 'Encrypt'
              }}</span>
            </label>
            <expand-transition>
              <ui-input
                v-if="state.withPassword"
                v-model="state.password"
                :placeholder="translations.settings.password || 'Password'"
                class="w-full"
                style="-webkit-text-security: disc"
                autofocus
              />
            </expand-transition>
            <ui-button class="w-full" @click="exportData(defaultPath)">{{
              translations.settings.exportData || 'Export'
            }}</ui-button>
          </div>
        </ui-card>

        <ui-card padding="p-4" class="flex h-full flex-col gap-3">
          <div class="space-y-0.5">
            <p
              class="text-sm font-medium text-neutral-800 dark:text-neutral-200"
            >
              {{ translations.settings.importData || 'Import data' }}
            </p>
            <p
              class="mt-0.5 text-xs leading-relaxed text-neutral-500 dark:text-neutral-400"
            >
              Restore notes from a previously exported Beaver Notes backup
              archive.
            </p>
          </div>
          <div class="mt-auto pt-2">
            <ui-button class="w-full" @click="importData(defaultPath)">{{
              translations.settings.importData || 'Import'
            }}</ui-button>
          </div>
        </ui-card>
      </div>

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
    </section>
  </div>
</template>
<script>
import { computed, ref, onMounted } from 'vue';
import { useDialog } from '@/composable/dialog';
import { useTranslations } from '@/composable/useTranslations';
import { useSettingsData } from '@/composable/useSettingsData';
import { useSettingsCloudSync } from '@/composable/useSettingsCloudSync';
import { useImportExport } from '@/composable/useImportExport';
import { usePasswordStore } from '@/store/passwd';
import { useNoteStore } from '@/store/note';
import { useFolderStore } from '@/store/folder';
import { useStorage } from '@/composable/storage';
import { useAccountStore } from '@/store/account';
import { getAccount } from '@/lib/api/account';
import { SYNC_TRANSPORT } from '@/lib/api/types';
import { clipboard } from '@/lib/tauri-bridge';
import { forceSyncNow } from '@/utils/sync';

export default {
  setup() {
    const { translations } = useTranslations();
    const dialog = useDialog();
    const storage = useStorage();
    const passwordStore = usePasswordStore();
    const noteStore = useNoteStore();
    const folderStore = useFolderStore();
    const accountStore = useAccountStore();
    const isMacOS = computed(() =>
      window.navigator.platform.toLowerCase().includes('mac')
    );

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
        // Toast handled by existing 'sync:error' listener
      } finally {
        syncState.value = { syncing: false };
      }
    }

    const {
      state,
      defaultPath,
      chooseDefaultPath,
      clearPath,
      syncProgress,
      exportData,
      importData,
    } = useSettingsData({
      dialog,
      folderStore,
      noteStore,
      passwordStore,
      storage,
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
      activeImportIssuesText,
      activeImportSource,
      activeImportState,
      copyImportIssues,
      exportAllHTMLHandler,
      exportAllMarkdownHandler,
      exportHtmlState,
      exportMdState,
      importSources,
      importState,
      openImportModal,
      selectImportSource,
      selectedImportSource,
      showImportModal,
      startSelectedImport,
    } = useImportExport({
      clipboard,
      folderStore,
      isMacOS,
      noteStore,
      storage,
      translations,
    });

    return {
      translations,
      state,
      defaultPath,
      chooseDefaultPath,
      clearPath,
      syncProgress,
      cloudSync,
      SYNC_TRANSPORT,
      exportData,
      importData,
      activeImportIssuesText,
      activeImportSource,
      activeImportState,
      copyImportIssues,
      exportAllHTMLHandler,
      exportAllMarkdownHandler,
      exportHtmlState,
      exportMdState,
      importSources,
      importState,
      openImportModal,
      selectImportSource,
      selectedImportSource,
      showImportModal,
      startSelectedImport,
      lastSyncAt,
      syncState,
      lastSyncLabel,
      onSyncNow,
    };
  },
};
</script>
<style scoped>
.editor-checkbox {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
}
.editor-checkbox input[type='checkbox'] {
  appearance: none;
  -webkit-appearance: none;
  width: 18px;
  height: 18px;
  border-radius: 9999px;
  border: 2px solid #ccc;
  cursor: pointer;
  position: relative;
  margin: 0;
  transition: background-color 0.2s ease, border-color 0.2s ease;
}
.editor-checkbox input[type='checkbox']:checked {
  @apply bg-primary border-primary;
}
.editor-checkbox input[type='checkbox']:checked::before {
  content: '';
  position: absolute;
  top: 50%;
  left: 50%;
  width: 16px;
  height: 16px;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Cpath d='M10.0007 15.1709L19.1931 5.97852L20.6073 7.39273L10.0007 17.9993L3.63672 11.6354L5.05093 10.2212L10.0007 15.1709Z' fill='white'/%3E%3C/svg%3E");
  background-size: contain;
  background-repeat: no-repeat;
  background-position: center;
  transform: translate(-50%, -50%);
}
</style>
