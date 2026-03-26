<!-- eslint-disable vue/multi-word-component-names -->
<template>
  <div class="mb-14 w-full max-w-xl space-y-6">
    <section class="space-y-2">
      <div
        class="space-y-1 bg-neutral-50 dark:bg-neutral-800 rounded-xl border"
      >
        <div
          class="flex gap-3 px-4 py-3.5 sm:flex-col sm:items-start sm:justify-between"
        >
          <p class="text-sm font-medium text-neutral-800 dark:text-neutral-200">
            {{ translations.settings.selectLanguage || 'Language' }}
          </p>
          <p
            class="mt-0.5 text-xs leading-relaxed text-neutral-500 dark:text-neutral-400"
          >
            Choose the interface language. Changing this will reload the app.
          </p>
          <ui-select
            v-model="selectedLanguage"
            class="w-full sm:flex-shrink-0"
            :search="true"
            @change="updateLanguage"
          >
            <option
              v-for="language in languages"
              :key="language.code"
              :value="language.code"
            >
              {{ language.name }}
            </option>
          </ui-select>
        </div>
      </div>
    </section>

    <section class="space-y-2">
      <div
        class="space-y-1 bg-neutral-50 dark:bg-neutral-800 rounded-xl border"
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
          <div class="flex flex-wrap items-center gap-2 justify-between">
            <span
              class="max-w-[220px] truncate rounded-md bg-neutral-100 px-2 py-1 font-mono text-xs text-neutral-500 dark:bg-neutral-800 dark:text-neutral-400"
              >{{
                state.dataDir ||
                translations.settings.pathPlaceholder ||
                'Not set'
              }}</span
            >
            <div class="flex gap-2">
              <ui-button @click="chooseDefaultPath">{{
                translations.settings.selectPath || 'Browse'
              }}</ui-button>
              <ui-button @click="clearPath"
                ><v-remixicon name="riDeleteBin6Line"
              /></ui-button>
            </div>
          </div>
        </div>
        <div
          class="flex flex-col gap-3 px-4 py-3.5 sm:flex-row sm:items-center sm:justify-between sm:gap-6"
        >
          <div class="min-w-0 flex-1">
            <p
              class="text-sm font-medium text-neutral-800 dark:text-neutral-200"
            >
              {{ translations.settings.autoSync || 'Auto sync' }}
            </p>
            <p
              class="mt-0.5 text-xs leading-relaxed text-neutral-500 dark:text-neutral-400"
            >
              Automatically sync notes to the sync folder whenever a change is
              detected.
            </p>
          </div>
          <ui-switch v-model="autoSync" @change="handleAutoSyncChange" />
        </div>
      </div>
    </section>
    <section class="space-y-2">
      <p
        class="text-xs font-semibold uppercase tracking-[0.12em] text-neutral-500 dark:text-neutral-400"
      >
        {{ translations.settings.behavior || 'Behavior' }}
      </p>
      <div
        class="space-y-1 bg-neutral-50 dark:bg-neutral-800 rounded-xl border"
      >
        <div
          class="flex flex-col gap-3 px-4 py-3.5 sm:flex-row sm:items-center sm:justify-between sm:gap-6"
        >
          <div class="min-w-0 flex-1">
            <p
              class="text-sm font-medium text-neutral-800 dark:text-neutral-200"
            >
              {{
                translations.settings.openLastEdited || 'Open last edited note'
              }}
            </p>
            <p
              class="mt-0.5 text-xs leading-relaxed text-neutral-500 dark:text-neutral-400"
            >
              When the app launches, reopen the note you were last editing.
            </p>
          </div>
          <ui-switch v-model="openLastEdited" />
        </div>

        <div
          class="flex flex-col gap-3 px-4 py-3.5 sm:flex-row sm:items-center sm:justify-between sm:gap-6"
        >
          <div class="min-w-0 flex-1">
            <p
              class="text-sm font-medium text-neutral-800 dark:text-neutral-200"
            >
              {{
                translations.settings.openAfterCreation ||
                'Open note after creation'
              }}
            </p>
            <p
              class="mt-0.5 text-xs leading-relaxed text-neutral-500 dark:text-neutral-400"
            >
              Immediately navigate to a note after creating it.
            </p>
          </div>
          <ui-switch v-model="openAfterCreation" />
        </div>
      </div>
    </section>

    <section class="space-y-2">
      <p
        class="text-xs font-semibold uppercase tracking-[0.12em] text-neutral-500 dark:text-neutral-400"
      >
        {{ translations.settings.editor || 'Editor' }}
      </p>
      <div
        class="space-y-1 bg-neutral-50 dark:bg-neutral-800 rounded-xl border"
      >
        <div
          class="flex flex-col gap-3 px-4 py-3.5 sm:flex-row sm:items-center sm:justify-between sm:gap-6"
        >
          <div class="min-w-0 flex-1">
            <p
              class="text-sm font-medium text-neutral-800 dark:text-neutral-200"
            >
              {{ translations.settings.spellCheck || 'Spell check' }}
            </p>
            <p
              class="mt-0.5 text-xs leading-relaxed text-neutral-500 dark:text-neutral-400"
            >
              Underline spelling errors in the editor as you type.
            </p>
          </div>
          <ui-switch v-model="spellcheckEnabled" @change="toggleSpellcheck" />
        </div>
        <div
          class="flex flex-col gap-3 px-4 py-3.5 sm:flex-row sm:items-center sm:justify-between sm:gap-6"
        >
          <div class="min-w-0 flex-1">
            <p
              class="text-sm font-medium text-neutral-800 dark:text-neutral-200"
            >
              {{
                translations.settings.collapsibleHeading ||
                'Collapsible headings'
              }}
            </p>
            <p
              class="mt-0.5 text-xs leading-relaxed text-neutral-500 dark:text-neutral-400"
            >
              Allow headings to be folded so their content is hidden below.
            </p>
          </div>
          <ui-switch v-model="collapsibleHeading" />
        </div>

        <div
          class="flex flex-col gap-3 px-4 py-3.5 sm:flex-row sm:items-center sm:justify-between sm:gap-6"
        >
          <div class="min-w-0 flex-1">
            <p
              class="text-sm font-medium text-neutral-800 dark:text-neutral-200"
            >
              {{
                translations.settings.todayDateFormat || "Today's date format"
              }}
            </p>
            <p
              class="mt-0.5 text-xs leading-relaxed text-neutral-500 dark:text-neutral-400"
            >
              Format used when inserting today's date via the /today command.
            </p>
          </div>
          <ui-select
            v-model="todayDateFormat"
            class="w-full sm:w-52 sm:flex-shrink-0"
            @change="saveTodayDateFormat"
          >
            <option
              v-for="format in dateFormats"
              :key="format.value"
              :value="format.value"
            >
              {{ format.label }}
            </option>
          </ui-select>
        </div>

        <div
          class="flex flex-col gap-3 px-4 py-3.5 sm:flex-row sm:items-center sm:justify-between sm:gap-6"
        >
          <div class="min-w-0 flex-1">
            <p
              class="text-sm font-medium text-neutral-800 dark:text-neutral-200"
            >
              {{ translations.settings.timeFormat || 'Time format' }}
            </p>
            <p
              class="mt-0.5 text-xs leading-relaxed text-neutral-500 dark:text-neutral-400"
            >
              Format used when inserting the current time via the /time command.
            </p>
          </div>
          <ui-select
            v-model="timeFormat"
            class="w-full sm:w-40 sm:flex-shrink-0"
            @change="saveTimeFormat"
          >
            <option
              v-for="format in timeFormats"
              :key="format.value"
              :value="format.value"
            >
              {{ format.label }}
            </option>
          </ui-select>
        </div>
      </div>
    </section>

    <section class="space-y-2">
      <p
        class="text-xs font-semibold uppercase tracking-[0.12em] text-neutral-500 dark:text-neutral-400"
      >
        Export
      </p>
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

    <section class="space-y-2">
      <p
        class="text-xs font-semibold uppercase tracking-[0.12em] text-neutral-500 dark:text-neutral-400"
      >
        Import
      </p>
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
                class="w-full rounded-md px-2.5 py-2 text-left text-sm transition-colors"
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

    <section class="space-y-2">
      <p
        class="text-xs font-semibold uppercase tracking-[0.12em] text-neutral-500 dark:text-neutral-400"
      >
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
import { shallowReactive, onMounted, onUnmounted, computed, ref } from 'vue';
import { useTheme } from '@/composable/theme';
import { useStorage } from '@/composable/storage';
import { useDialog } from '@/composable/dialog';
import { useImportExport } from '@/composable/useImportExport';
import lightImg from '@/assets/images/light.png';
import darkImg from '@/assets/images/dark.png';
import systemImg from '@/assets/images/system.png';
import { usePasswordStore } from '@/store/passwd';
import { useNoteStore } from '@/store/note';
import { formatTime } from '@/utils/time-format';
import { useAppStore } from '../../store/app';
import { forceSyncNow } from '../../utils/sync';
import { useFolderStore } from '../../store/folder';
import { getSettingSync } from '../../composable/settings';
import { useTranslations } from '../../composable/useTranslations';
import { clipboard, ipcRenderer } from '@/lib/tauri-bridge';
import { useSettingsData } from '@/composable/useSettingsData';
import { useSettingsSecurity } from '@/composable/useSettingsSecurity';

export default {
  setup() {
    const { translations } = useTranslations();
    const passwordStore = usePasswordStore();
    const noteStore = useNoteStore();
    const themes = [
      { name: 'light', img: lightImg },
      { name: 'dark', img: darkImg },
      { name: 'system', img: systemImg },
    ];
    const theme = useTheme();
    const dialog = useDialog();
    const storage = useStorage();
    const folderStore = useFolderStore();
    const isMacOS = computed(() =>
      window.navigator.platform.toLowerCase().includes('mac')
    );

    const {
      activeImportIssuesText,
      activeImportSource,
      activeImportState,
      copyImportIssues,
      exportAllHTMLHandler,
      exportAllMarkdownHandler,
      exportHtmlState,
      exportMdState,
      getImportIssuesText,
      importAppleNotesHandler,
      importBearHandler,
      importGenericMarkdownHandler,
      importEvernoteHandler,
      importNotionHandler,
      importObsidianHandler,
      importSimplenoteHandler,
      importSourceGroups,
      importSources,
      importState,
      importWordHandler,
      openImportModal,
      runImport,
      selectImportSource,
      selectedImportSource,
      showImportModal,
      startSelectedImport,
    } = useImportExport({
      clipboard,
      folderStore,
      ipcRenderer,
      isMacOS,
      noteStore,
      storage,
      translations,
    });

    const dataSettings = useSettingsData({
      dialog,
      folderStore,
      noteStore,
      passwordStore,
      storage,
      translations,
    });

    const securitySettings = useSettingsSecurity({
      dialog,
      noteStore,
      passwordStore,
      translations,
      getEffectiveDataDir: dataSettings.getEffectiveDataDir,
      showDialogAlert: dataSettings.showDialogAlert,
    });

    return {
      theme,
      themes,
      storage,
      translations,
      exportMdState,
      exportHtmlState,
      exportAllMarkdownHandler,
      exportAllHTMLHandler,
      importState,
      showImportModal,
      selectedImportSource,
      importSourceGroups,
      importSources,
      activeImportSource,
      activeImportState,
      activeImportIssuesText,
      openImportModal,
      selectImportSource,
      startSelectedImport,
      runImport,
      copyImportIssues,
      getImportIssuesText,
      importObsidianHandler,
      importNotionHandler,
      importBearHandler,
      importEvernoteHandler,
      importAppleNotesHandler,
      importSimplenoteHandler,
      importWordHandler,
      importGenericMarkdownHandler,
      forceSyncNow,
      formatTime,
      isMacOS,
      ...dataSettings,
      ...securitySettings,
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
