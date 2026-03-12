<!-- eslint-disable vue/multi-word-component-names -->
<template>
  <div class="mb-14 w-full max-w-xl space-y-6">
    <section class="space-y-2">
      <p
        class="text-xs font-semibold uppercase tracking-[0.12em] text-neutral-500 dark:text-neutral-400"
      >
        {{ translations.settings.selectLanguage || 'Language &amp; sync' }}
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
              {{ translations.settings.selectLanguage || 'Language' }}
            </p>
            <p
              class="mt-0.5 text-xs leading-relaxed text-neutral-500 dark:text-neutral-400"
            >
              Choose the interface language. Changing this will reload the app.
            </p>
          </div>
          <ui-select
            v-model="selectedLanguage"
            class="w-full sm:w-44 sm:flex-shrink-0"
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

        <div
          class="flex flex-col gap-3 px-4 py-3.5 sm:flex-row sm:items-center sm:justify-between sm:gap-6"
        >
          <div class="min-w-0 flex-1">
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
          <div class="flex flex-wrap items-center gap-2 sm:justify-end">
            <span
              class="max-w-[220px] truncate rounded-md bg-neutral-100 px-2 py-1 font-mono text-xs text-neutral-500 dark:bg-neutral-800 dark:text-neutral-400"
              >{{
                state.dataDir ||
                translations.settings.pathPlaceholder ||
                'Not set'
              }}</span
            >
            <ui-button @click="chooseDefaultPath">{{
              translations.settings.selectPath || 'Browse'
            }}</ui-button>
            <ui-button @click="clearPath"
              ><v-remixicon name="riDeleteBin6Line"
            /></ui-button>
          </div>
        </div>
      </div>
    </section>

    <section class="space-y-2">
      <p
        class="text-xs font-semibold uppercase tracking-[0.12em] text-neutral-500 dark:text-neutral-400"
      >
        {{ translations.settings.utilities || 'Behavior' }}
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
            Pick the app you are migrating from, then follow the source-specific
            import steps in one place. Markdown exports, direct app imports, and
            ENEX files all use the same flow here.
          </p>
        </div>
        <div class="flex flex-col gap-2 sm:flex-row sm:items-center">
          <ui-button class="sm:w-auto" @click="openImportModal()">
            Choose import source
          </ui-button>
          <p
            class="text-xs leading-relaxed text-neutral-500 dark:text-neutral-400"
          >
            Supports Obsidian, Notion, Bear, Simplenote, Markdown folders,
            Evernote, and Apple Notes on macOS.
          </p>
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
import { shallowReactive, onMounted, computed, ref } from 'vue';
import { AES } from 'crypto-es/lib/aes';
import { Utf8 } from 'crypto-es/lib/core';
import { useTheme } from '@/composable/theme';
import { useStorage } from '@/composable/storage';
import { useDialog } from '@/composable/dialog';
import dayjs from '@/lib/dayjs';
import lightImg from '@/assets/images/light.png';
import darkImg from '@/assets/images/dark.png';
import systemImg from '@/assets/images/system.png';
import Mousetrap from '@/lib/mousetrap';
import { usePasswordStore } from '@/store/passwd';
import { useNoteStore } from '@/store/note';
import { formatTime } from '@/utils/time-format';
import { useAppStore } from '../../store/app';
import { forceSyncNow } from '../../utils/sync';
import { exportAllMarkdown, exportAllHTML } from '@/utils/share/ExportBulk';
import {
  importObsidian,
  importNotion,
  importBear,
  importSimplenote,
  importGenericMarkdown,
} from '@/utils/import/importers';
import { startRustImport } from '@/utils/import/importRustBridge';
import { useFolderStore } from '../../store/folder';
import {
  isSyncEncryptionEnabled,
  isSyncKeyLoaded,
  verifySyncPassphrase,
  setupSyncEncryption,
  disableSyncEncryption,
  syncFolderHasEncryption,
  tryRestoreKeyFromSafeStorage,
} from '@/utils/syncCrypto.js';
import {
  isAppEncryptionEnabled,
  isAppKeyLoaded,
  setupAppEncryption,
  verifyAppPassphrase,
  disableAppEncryption,
  appFolderHasEncryption,
} from '@/utils/appCrypto.js';
import { getSyncPath, setSyncPath } from '@/utils/syncPath.js';
import { getSettingSync, setSetting } from '../../composable/settings';
import { useTranslations } from '../../composable/useTranslations';
import { backend, clipboard, ipcRenderer, path } from '@/lib/tauri-bridge';

const LANGUAGE_CONFIG = {
  ar: { name: 'العربية', dir: 'rtl' },
  de: { name: 'Deutsch', dir: 'ltr' },
  en: { name: 'English', dir: 'ltr' },
  es: { name: 'Español', dir: 'ltr' },
  fr: { name: 'Français', dir: 'ltr' },
  it: { name: 'Italiano', dir: 'ltr' },
  nl: { name: 'Nederlands', dir: 'ltr' },
  pt: { name: 'Português', dir: 'ltr' },
  ru: { name: 'Русский', dir: 'ltr' },
  tr: { name: 'Türkçe', dir: 'ltr' },
  uk: { name: 'Українська', dir: 'ltr' },
  zh: { name: '简体中文', dir: 'ltr' },
  vi: { name: 'Tiếng Việt', dir: 'ltr' },
};

const getLanguageDirection = (languageCode) => {
  return LANGUAGE_CONFIG[languageCode]?.dir || 'ltr';
};

export default {
  setup() {
    const { translations } = useTranslations();
    const passwordStore = usePasswordStore();
    const noteStore = useNoteStore();
    const advancedSettings = ref(getSettingSync('advancedSettings'));

    const spellcheckEnabled = ref(getSettingSync('spellcheckEnabled'));
    const autoSync = ref(getSettingSync('autoSync'));
    const syncEncryptionEnabled = ref(isSyncEncryptionEnabled());
    const syncKeyLoaded = ref(isSyncKeyLoaded());
    const syncPassphraseInput = ref('');
    const syncCryptoError = ref('');
    const appEncryptionEnabled = ref(isAppEncryptionEnabled());
    const appKeyLoaded = ref(isAppKeyLoaded());
    const appEncryptionBusy = ref(false);
    const appEncryptionProgress = ref({
      phase: '',
      processed: 0,
      total: 0,
    });
    const appEncryptionError = ref('');
    const appConfirmInput = ref(''); // password re-entry when enabling app encryption
    const passwordInput = ref('');
    const securityError = ref('');
    const hasPassword = ref(!!passwordStore.sharedKey);
    const selectedFont = ref(getSettingSync('selectedFont'));
    const selectedLanguage = ref(getSettingSync('selectedLanguage'));
    const directionPreference = ref(
      getSettingSync('directionPreference') ||
        getLanguageDirection(selectedLanguage.value)
    );
    const languages = Object.entries(LANGUAGE_CONFIG).map(
      ([code, { name }]) => ({
        code,
        name,
      })
    );
    const themes = [
      { name: 'light', img: lightImg },
      { name: 'dark', img: darkImg },
      { name: 'system', img: systemImg },
    ];
    const theme = useTheme();
    const dialog = useDialog();
    const storage = useStorage();
    const folderStore = useFolderStore();
    const folerStore = useFolderStore();

    const state = shallowReactive({
      dataDir: '',
      password: '',
      withPassword: false,
      lastUpdated: null,
      zoomLevel: (+getSettingSync('zoomLevel') || 1).toFixed(1),
    });
    const exportMdState = shallowReactive({
      running: false,
      done: 0,
      total: 0,
      result: null,
    });
    const exportHtmlState = shallowReactive({
      running: false,
      done: 0,
      total: 0,
      result: null,
    });
    const importState = shallowReactive({
      obsidian: shallowReactive({
        running: false,
        done: 0,
        total: 0,
        result: null,
      }),
      notion: shallowReactive({
        running: false,
        done: 0,
        total: 0,
        result: null,
      }),
      bear: shallowReactive({
        running: false,
        done: 0,
        total: 0,
        result: null,
      }),
      evernote: shallowReactive({
        running: false,
        done: 0,
        total: 0,
        result: null,
        notebookName: '',
      }),
      appleNotes: shallowReactive({
        running: false,
        done: 0,
        total: 0,
        result: null,
      }),
      simplenote: shallowReactive({
        running: false,
        done: 0,
        total: 0,
        result: null,
      }),
      genericMd: shallowReactive({
        running: false,
        done: 0,
        total: 0,
        result: null,
      }),
    });
    const showImportModal = ref(false);
    const selectedImportSource = ref('obsidian');
    const isMacOS = computed(() =>
      window.navigator.platform.toLowerCase().includes('mac')
    );

    let defaultPath = '';

    async function exportAllMarkdownHandler() {
      if (exportMdState.running) return;

      const previousState = {
        done: exportMdState.done,
        total: exportMdState.total,
        result: exportMdState.result,
      };

      exportMdState.running = true;
      exportMdState.result = null;
      exportMdState.done = 0;
      exportMdState.total = 0;

      try {
        const result = await exportAllMarkdown(({ done, total }) => {
          exportMdState.done = done;
          exportMdState.total = total;
        });

        if (result === null) {
          exportMdState.done = previousState.done;
          exportMdState.total = previousState.total;
          exportMdState.result = previousState.result;
          return;
        }

        exportMdState.result = result;
      } finally {
        exportMdState.running = false;
      }
    }

    async function exportAllHTMLHandler() {
      if (exportHtmlState.running) return;

      const previousState = {
        done: exportHtmlState.done,
        total: exportHtmlState.total,
        result: exportHtmlState.result,
      };

      exportHtmlState.running = true;
      exportHtmlState.result = null;
      exportHtmlState.done = 0;
      exportHtmlState.total = 0;

      try {
        const result = await exportAllHTML(({ done, total }) => {
          exportHtmlState.done = done;
          exportHtmlState.total = total;
        });

        if (result === null) {
          exportHtmlState.done = previousState.done;
          exportHtmlState.total = previousState.total;
          exportHtmlState.result = previousState.result;
          return;
        }

        exportHtmlState.result = result;
      } finally {
        exportHtmlState.running = false;
      }
    }

    async function runImport(key, fn) {
      if (importState[key].running) return;

      const state = importState[key];
      state.running = true;
      state.result = null;
      state.done = 0;
      state.total = 0;

      try {
        const result = await fn(({ done, total }) => {
          state.done = done;
          state.total = total;
        });
        state.result = result;
      } finally {
        state.running = false;
      }
    }

    function getImportIssuesText(key) {
      const issues = importState[key]?.result?.errors || [];
      return issues
        .map(
          (issue) =>
            `${issue.title || 'Untitled'}: ${issue.reason || 'Unknown error'}`
        )
        .join('\n');
    }

    async function copyImportIssues(key) {
      const text = getImportIssuesText(key);
      if (!text) return;
      await clipboard.writeText(text);
    }

    async function importObsidianHandler() {
      const { canceled, filePaths = [] } = await ipcRenderer.callMain(
        'dialog:open',
        {
          title: 'Select Obsidian Vault',
          properties: ['openDirectory'],
        }
      );
      if (canceled || !filePaths.length) return;
      const dataDir = await storage.get('dataDir', '');
      await runImport('obsidian', (onProgress) =>
        importObsidian(
          filePaths[0],
          noteStore,
          folderStore,
          dataDir,
          onProgress
        )
      );
    }

    async function importNotionHandler() {
      const { canceled, filePaths = [] } = await ipcRenderer.callMain(
        'dialog:open',
        {
          title: 'Select Notion Export',
          properties: ['openDirectory'],
        }
      );
      if (canceled || !filePaths.length) return;
      const dataDir = await storage.get('dataDir', '');
      await runImport('notion', (onProgress) =>
        importNotion(filePaths[0], noteStore, folderStore, dataDir, onProgress)
      );
    }

    async function importBearHandler() {
      const { canceled, filePaths = [] } = await ipcRenderer.callMain(
        'dialog:open',
        {
          title: 'Select Bear Export',
          properties: ['openDirectory'],
        }
      );
      if (canceled || !filePaths.length) return;
      const dataDir = await storage.get('dataDir', '');
      await runImport('bear', (onProgress) =>
        importBear(filePaths[0], noteStore, folderStore, dataDir, onProgress)
      );
    }

    async function importEvernoteHandler() {
      const { canceled, filePaths = [] } = await ipcRenderer.callMain(
        'dialog:open',
        {
          title: 'Select ENEX File',
          properties: ['openFile'],
          filters: [{ name: 'Evernote ENEX', extensions: ['enex'] }],
        }
      );
      if (canceled || !filePaths.length) return;

      await runImport('evernote', async (onProgress) => {
        const pending = startRustImport('evernote', onProgress);
        await ipcRenderer.callMain('import:evernote', {
          enexPath: filePaths[0],
          enex_path: filePaths[0],
          notebookName: importState.evernote.notebookName?.trim() || null,
          notebook_name: importState.evernote.notebookName?.trim() || null,
        });
        return pending;
      });
    }

    async function importAppleNotesHandler() {
      await runImport('appleNotes', async (onProgress) => {
        const pending = startRustImport('apple-notes', onProgress);
        await ipcRenderer.callMain('import:apple-notes', {});
        return pending;
      });
    }

    async function importSimplenoteHandler() {
      const { canceled, filePaths = [] } = await ipcRenderer.callMain(
        'dialog:open',
        {
          title: 'Select notes.json',
          properties: ['openFile'],
          filters: [{ name: 'Simplenote JSON', extensions: ['json'] }],
        }
      );
      if (canceled || !filePaths.length) return;
      await runImport('simplenote', (onProgress) =>
        importSimplenote(filePaths[0], noteStore, onProgress)
      );
    }

    async function importGenericMarkdownHandler() {
      const { canceled, filePaths = [] } = await ipcRenderer.callMain(
        'dialog:open',
        {
          title: 'Select Markdown Folder',
          properties: ['openDirectory'],
        }
      );
      if (canceled || !filePaths.length) return;
      const dataDir = await storage.get('dataDir', '');
      await runImport('genericMd', (onProgress) =>
        importGenericMarkdown(
          filePaths[0],
          noteStore,
          folderStore,
          dataDir,
          onProgress
        )
      );
    }

    const importSourceGroups = computed(() => {
      const groups = [
        {
          label: 'Markdown-based',
          items: [
            {
              key: 'obsidian',
              title: 'Obsidian',
              icon: 'obsidian',
              group: 'Markdown',
              description:
                'Point Beaver Notes at your Obsidian vault folder. Your folder structure and notes will be imported as-is.',
              buttonLabel: 'Select Vault Folder',
            },
            {
              key: 'notion',
              title: 'Notion',
              icon: 'riNotionFill',
              group: 'Markdown',
              description:
                'In Notion, go to Settings → Export content → Markdown & CSV. Download and unzip the export, then select the unzipped folder.',
              buttonLabel: 'Select Notion Export',
            },
            {
              key: 'bear',
              title: 'Bear',
              icon: 'bear',
              group: 'Markdown',
              description:
                'In Bear, go to File → Export Notes → Markdown. Select the exported folder below.',
              buttonLabel: 'Select Bear Export',
            },
            {
              key: 'genericMd',
              title: 'Markdown Folder',
              icon: 'riMarkdownLine',
              group: 'Markdown',
              description:
                'Import any folder of .md files. Subfolders become Beaver Notes folders.',
              buttonLabel: 'Select Folder',
            },
          ],
        },
        {
          label: 'Direct import',
          items: [
            {
              key: 'simplenote',
              title: 'Simplenote',
              icon: 'simpleNote',
              group: 'Direct',
              description:
                'In Simplenote, go to Settings → Export and download notes.json. Select the file below.',
              buttonLabel: 'Select notes.json',
            },
            {
              key: 'evernote',
              title: 'Evernote',
              icon: 'riEvernoteFill',
              group: 'Direct',
              description:
                'In Evernote, right-click a notebook and choose Export Notes. Save as .enex format. You can optionally enter the notebook name to create a matching folder.',
              buttonLabel: 'Select ENEX File',
            },
          ],
        },
      ];

      if (isMacOS.value) {
        groups[1].items.push({
          key: 'appleNotes',
          title: 'Apple Notes',
          icon: 'riAppleFill',
          group: 'Direct',
          description:
            "Beaver Notes will read your notes directly from Apple Notes. You'll see a permission prompt — click OK to allow access.",
          buttonLabel: 'Import from Apple Notes',
        });
      }

      return groups;
    });

    const importSourceMap = computed(() =>
      importSourceGroups.value.reduce((acc, group) => {
        group.items.forEach((item) => {
          acc[item.key] = item;
        });
        return acc;
      }, {})
    );
    const importSources = computed(() =>
      importSourceGroups.value.flatMap((group) => group.items)
    );

    const activeImportSource = computed(
      () => importSourceMap.value[selectedImportSource.value] || null
    );
    const activeImportState = computed(
      () => importState[selectedImportSource.value] || importState.obsidian
    );
    const activeImportIssuesText = computed(() =>
      getImportIssuesText(selectedImportSource.value)
    );

    function openImportModal(key = selectedImportSource.value) {
      if (importSourceMap.value[key]) {
        selectedImportSource.value = key;
      }
      showImportModal.value = true;
    }

    function selectImportSource(key) {
      if (!importSourceMap.value[key]) return;
      selectedImportSource.value = key;
    }

    async function startSelectedImport() {
      switch (selectedImportSource.value) {
        case 'obsidian':
          await importObsidianHandler();
          break;
        case 'notion':
          await importNotionHandler();
          break;
        case 'bear':
          await importBearHandler();
          break;
        case 'evernote':
          await importEvernoteHandler();
          break;
        case 'appleNotes':
          await importAppleNotesHandler();
          break;
        case 'simplenote':
          await importSimplenoteHandler();
          break;
        case 'genericMd':
          await importGenericMarkdownHandler();
          break;
        default:
          break;
      }
    }

    async function changeDataDir() {
      try {
        const {
          canceled,
          filePaths: [dir],
        } = await backend.invoke('dialog:open', {
          title: translations.value.settings.selectPath,
          properties: ['openDirectory'],
        });

        if (canceled) return;

        showAlert(translations.value.settings.relaunch, {
          type: 'info',
          buttons: [translations.value.settings.relaunchButton],
        });

        await storage.set('dataDir', dir);
        window.location.reload();
      } catch (error) {
        if (
          String(error?.message || error).includes(
            'No matching entry found in secure storage'
          )
        ) {
          return;
        }
        console.error(error);
      }
    }

    function showAlert(message, options = {}) {
      backend.invoke('dialog:message', {
        type: 'error',
        title: translations.value.settings.alertTitle || 'Alert',
        message,
        ...options,
      });
    }

    function showDialogAlert(message) {
      dialog.alert({
        title: translations.value.settings.alertTitle || 'Alert',
        body: message,
        okText: translations.value.dialog?.close || 'Close',
      });
    }

    async function getEffectiveDataDir() {
      const storedDataDir = await storage.get('dataDir', '', 'settings');
      if (typeof storedDataDir === 'string' && storedDataDir.trim()) {
        return storedDataDir.trim();
      }

      const userDataDir = await backend.invoke('helper:get-path', 'userData');
      return typeof userDataDir === 'string' ? userDataDir.trim() : '';
    }

    async function exportData() {
      try {
        const dataDir = await getEffectiveDataDir();
        const { canceled, filePaths } = await backend.invoke('dialog:open', {
          title: translations.value.settings.exportData,
          properties: ['openDirectory'],
        });

        if (canceled) return;

        let data = await storage.store();
        data['sharedKey'] = storage.get('sharedKey');
        data['lockedNotes'] = JSON.parse(localStorage.getItem('lockedNotes'));
        await passwordStore.retrieve();
        // Export the bcrypt hash. derivedKey is intentionally omitted — it was
        // a broken-salt PBKDF2 value that is no longer written by new code.
        // Old imports that contain derivedKey will still be accepted by importSharedKey.
        data['sharedKey'] = passwordStore.sharedKey;
        if (state.withPassword) {
          data = AES.encrypt(JSON.stringify(data), state.password).toString();
        }

        const folderName = dayjs().format('[Beaver Notes] YYYY-MM-DD');
        const folderPath = path.join(filePaths[0], folderName);

        const containsGvfs = folderPath.includes('gvfs');

        if (containsGvfs) {
          await backend.invoke('fs:ensureDir', folderPath);
          await backend.invoke('fs:output-json', {
            path: path.join(folderPath, 'data.json'),
            data: { data },
          });

          const notesAssetsSource = path.join(dataDir, 'notes-assets');
          const notesAssetsDest = path.join(folderPath, 'assets');
          await backend.invoke('fs:copy', {
            path: notesAssetsSource,
            dest: notesAssetsDest,
          });

          const fileAssetsSource = path.join(dataDir, 'file-assets');
          const fileAssetsDest = path.join(folderPath, 'file-assets');
          await backend.invoke('fs:copy', {
            path: fileAssetsSource,
            dest: fileAssetsDest,
          });
        } else {
          await backend.invoke('fs:ensureDir', folderPath);
          await backend.invoke('fs:output-json', {
            path: path.join(folderPath, 'data.json'),
            data: { data },
          });
          await backend.invoke('fs:copy', {
            path: path.join(dataDir, 'notes-assets'),
            dest: path.join(folderPath, 'assets'),
          });
          await backend.invoke('fs:copy', {
            path: path.join(dataDir, 'file-assets'),
            dest: path.join(folderPath, 'file-assets'),
          });

          showDialogAlert(
            `${translations.value.settings.exportMessage}"${folderName}"`
          );
        }

        state.withPassword = false;
        state.password = '';
      } catch (error) {
        console.error(error);
      }
    }

    async function mergeImportedData(data) {
      try {
        const keys = [
          { key: 'notes', dfData: {} },
          { key: 'labels', dfData: [] },
          { key: 'lockStatus', dfData: {} },
          { key: 'isLocked', dfData: {} },
          { key: 'folders', dfData: {} },
        ];

        for (const { key, dfData } of keys) {
          const currentData = await storage.get(key, dfData);
          const importedData = data[key] ?? dfData;
          let mergedData;

          if (key === 'labels') {
            const mergedArr = [...currentData, ...importedData];
            mergedData = [...new Set(mergedArr)];
          } else {
            mergedData = { ...currentData, ...importedData };
          }

          await storage.set(key, mergedData);
          await folerStore.retrieve();
        }
      } catch (error) {
        console.error(error);
      }
    }

    async function importData() {
      try {
        const dataDir = await getEffectiveDataDir();
        const {
          canceled,
          filePaths: [dirPath],
        } = await backend.invoke('dialog:open', {
          title: translations.value.settings.importData,
          properties: ['openDirectory'],
        });

        if (canceled) return;

        let { data } = await backend.invoke(
          'fs:read-json',
          path.join(dirPath, 'data.json')
        );

        if (!data) return showAlert(translations.value.settings.invalidData);

        if (typeof data === 'string') {
          dialog.prompt({
            title: translations.value.settings.inputPassword,
            body: translations.value.settings.body,
            okText: translations.value.settings.import,
            cancelText: translations.value.settings.cancel,
            placeholder: translations.value.settings.password,
            onConfirm: async (pass) => {
              try {
                const bytes = AES.decrypt(data, pass);
                const result = bytes.toString(Utf8);
                const resultObj = JSON.parse(result);

                await mergeImportedData(resultObj);

                const importedDefaultPath = resultObj['dataDir'];
                const importedLockedStatus = resultObj['lockStatus'];
                const importedIsLocked = resultObj['isLocked'];

                if (importedDefaultPath) {
                  await setSyncPath(importedDefaultPath);
                }

                if (
                  importedLockedStatus !== null &&
                  importedLockedStatus !== undefined
                ) {
                  localStorage.setItem(
                    'lockStatus',
                    JSON.stringify(importedLockedStatus)
                  );
                }

                if (
                  importedIsLocked !== null &&
                  importedIsLocked !== undefined
                ) {
                  localStorage.setItem(
                    'isLocked',
                    JSON.stringify(importedIsLocked)
                  );
                }

                if (resultObj['sharedKey']) {
                  await passwordStore.importSharedKey(
                    resultObj['sharedKey'],
                    resultObj['derivedKey']
                  );
                }

                await backend.invoke('fs:copy', {
                  path: path.join(dirPath, 'assets'),
                  dest: path.join(dataDir, 'notes-assets'),
                });

                await backend.invoke('fs:copy', {
                  path: path.join(dirPath, 'file-assets'),
                  dest: path.join(dataDir, 'file-assets'),
                });

                console.log('Assets copied successfully.');
              } catch (error) {
                showAlert(translations.value.settings.invalidPassword);
                return false;
              }
            },
          });
        } else {
          await mergeImportedData(data);

          const importedLockedStatus = data['lockStatus'];
          const importedIsLocked = data['isLocked'];

          if (data['sharedKey']) {
            await passwordStore.importSharedKey(
              data['sharedKey'],
              data['derivedKey']
            );
          }

          if (
            importedLockedStatus !== null &&
            importedLockedStatus !== undefined
          ) {
            localStorage.setItem(
              'lockStatus',
              JSON.stringify(importedLockedStatus)
            );
          }

          if (importedIsLocked !== null && importedIsLocked !== undefined) {
            localStorage.setItem('isLocked', JSON.stringify(importedIsLocked));
          }

          await backend.invoke('fs:copy', {
            path: path.join(dirPath, 'assets'),
            dest: path.join(dataDir, 'notes-assets'),
          });

          await backend.invoke('fs:copy', {
            path: path.join(dirPath, 'file-assets'),
            dest: path.join(dataDir, 'file-assets'),
          });
        }
      } catch (error) {
        console.error(error);
      }
    }

    async function chooseDefaultPath() {
      try {
        const {
          canceled,
          filePaths: [dir],
        } = await backend.invoke('dialog:open', {
          title: translations.value.settings.selectPath,
          properties: ['openDirectory'],
        });

        if (canceled) return;
        defaultPath = await setSyncPath(dir);
        state.dataDir = defaultPath;
        window.location.reload();
      } catch (error) {
        console.error(error);
      }
    }

    async function clearPath() {
      state.dataDir = '';
      await setSyncPath('');
    }

    async function hydrateSyncEncryptionState() {
      const folderEncrypted = await syncFolderHasEncryption();
      if (folderEncrypted) {
        syncEncryptionEnabled.value = true;
        await tryRestoreKeyFromSafeStorage();
      } else {
        syncEncryptionEnabled.value = isSyncEncryptionEnabled();
      }
      syncKeyLoaded.value = isSyncKeyLoaded();
    }

    onMounted(() => {
      void (async () => {
        defaultPath = await getSyncPath();
        state.dataDir = defaultPath;
        await hydrateSyncEncryptionState();
      })();
    });

    const shortcuts = {
      'mod+s': importData,
      'mod+shift+e': exportData,
    };

    async function resetPasswordDialog() {
      dialog.prompt({
        title: translations.value.settings.resetPasswordTitle,
        okText: translations.value.settings.next,
        cancelText: translations.value.settings.cancel,
        placeholder: translations.value.settings.password,
        onConfirm: async (currentPassword) => {
          if (currentPassword) {
            const isCurrentPasswordValid = await passwordStore.isValidPassword(
              currentPassword
            );
            if (isCurrentPasswordValid) {
              dialog.prompt({
                title: translations.value.settings.enterNewPassword,
                okText: translations.value.settings.resetPassword,
                body: translations.value.settings.warning,
                cancelText: translations.value.settings.cancel,
                placeholder: translations.value.settings.newPassword,
                onConfirm: async (newPassword) => {
                  if (newPassword) {
                    try {
                      await passwordStore.setsharedKey(newPassword);
                      console.log('Password reset successful');
                      showDialogAlert(
                        translations.value.settings.passwordResetSuccess
                      );
                    } catch (error) {
                      console.error('Error resetting password:', error);
                      showDialogAlert(
                        translations.value.settings.passwordResetError
                      );
                    }
                  } else {
                    showDialogAlert(
                      translations.value.settings.invalidPassword
                    );
                  }
                },
              });
            } else {
              showDialogAlert(translations.value.settings.wrongCurrentPassword);
            }
          } else {
            showDialogAlert(translations.value.settings.invalidPassword);
          }
        },
      });
    }

    Mousetrap.bind(Object.keys(shortcuts), (event, combo) => {
      shortcuts[combo]();
    });

    const appStore = useAppStore();

    const handleAutoSyncChange = () => {
      const exportPath = defaultPath;

      if (!exportPath || exportPath.trim() === '') {
        showAlert(translations.value.settings.emptyPathWarn);
        return;
      }

      const newAutoSyncValue = !autoSync.value;
      autoSync.value = newAutoSyncValue;
      void setSetting('autoSync', newAutoSyncValue);
    };

    const collapsibleHeading = computed({
      get() {
        return appStore.setting.collapsibleHeading;
      },
      set(v) {
        appStore.setSettingStorage('collapsibleHeading', v);
      },
    });

    const openLastEdited = computed({
      get() {
        return appStore.setting.openLastEdited;
      },
      set(v) {
        appStore.setSettingStorage('openLastEdited', v);
      },
    });

    const openAfterCreation = computed({
      get() {
        return appStore.setting.openAfterCreation;
      },
      set(v) {
        appStore.setSettingStorage('openAfterCreation', v);
      },
    });

    const todayDateFormat = ref(getSettingSync('todayDateFormat'));

    const timeFormat = ref(getSettingSync('timeFormat'));

    const saveTodayDateFormat = () => {
      if (todayDateFormat.value.trim() === '') {
        todayDateFormat.value = 'DD-MM-YYYY';
      }
      void setSetting('todayDateFormat', todayDateFormat.value);
    };

    const saveTimeFormat = () => {
      if (timeFormat.value.trim() === '') {
        timeFormat.value = 'HH:mm';
      }
      void setSetting('timeFormat', timeFormat.value);
    };

    const toggleAdvancedSettings = () => {
      void setSetting('advancedSettings', advancedSettings.value);
    };

    const toggleSpellcheck = () => {
      void setSetting('spellcheckEnabled', spellcheckEnabled.value);
      applySpellcheckAttribute();
    };

    const applySpellcheckAttribute = () => {
      const inputElements = document.querySelectorAll(
        'input, textarea, [contenteditable="true"]'
      );
      inputElements.forEach((element) => {
        element.setAttribute('spellcheck', spellcheckEnabled.value);
        backend.invoke('app:spellcheck', spellcheckEnabled.value);
      });
    };

    const updateLanguage = () => {
      const languageCode = selectedLanguage.value;
      const dir = getLanguageDirection(languageCode);
      void Promise.all([
        setSetting('selectedLanguage', languageCode),
        setSetting('directionPreference', dir),
      ]).then(() => window.location.reload());
    };

    const dateFormats = [
      { value: 'DD-MM-YYYY', label: '17-02-2026 (DD-MM-YYYY)' },
      { value: 'MM-DD-YYYY', label: '02-17-2026 (MM-DD-YYYY)' },
      { value: 'YYYY-MM-DD', label: '2026-02-17 (ISO)' },
      { value: 'DD/MM/YYYY', label: '17/02/2026 (European)' },
      { value: 'MM/DD/YYYY', label: '02/17/2026 (US)' },
      { value: 'D MMM YYYY', label: '17 Feb 2026' },
      { value: 'MMMM D, YYYY', label: 'February 17, 2026' },
    ];

    const timeFormats = [
      { value: 'HH:mm', label: '14:35 (24h)' },
      { value: 'hh:mm A', label: '02:35 PM (12h)' },
      { value: 'HH:mm:ss', label: '14:35:20' },
    ];
    const hasSyncFolder = computed(() => Boolean(state.dataDir?.trim()));

    const appEncryptionProgressPercent = computed(() => {
      const total = appEncryptionProgress.value.total || 0;
      if (!total) return 0;
      return Math.min(
        100,
        Math.floor((appEncryptionProgress.value.processed / total) * 100)
      );
    });

    const appEncryptionProgressLabel = computed(() => {
      switch (appEncryptionProgress.value.phase) {
        case 'decrypt':
          return 'Decrypting existing notes';
        case 'encrypt':
          return 'Encrypting notes';
        case 'plaintext':
          return 'Saving plaintext notes';
        case 'assets-encrypt':
          return 'Encrypting assets';
        case 'assets-plaintext':
          return 'Saving plaintext assets';
        default:
          return 'Processing notes';
      }
    });

    // ── Global password ────────────────────────────────────────────────────

    async function setGlobalPassword() {
      securityError.value = '';
      if (!passwordInput.value?.trim()) return;
      try {
        await passwordStore.setsharedKey(passwordInput.value);
        hasPassword.value = true;
        passwordInput.value = '';
      } catch (err) {
        securityError.value = String(err);
      }
    }

    function changePasswordDialog() {
      resetPasswordDialog();
    }

    function refreshAppKeyLoaded() {
      appKeyLoaded.value = isAppKeyLoaded();
    }

    function updateAppEncryptionProgress(progress) {
      appEncryptionProgress.value = {
        phase: progress.phase,
        processed: progress.processed,
        total: progress.total,
      };
    }

    function base64ToUint8Array(base64) {
      const binary = atob(base64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i += 1) {
        bytes[i] = binary.charCodeAt(i);
      }
      return bytes;
    }

    function isIgnoredAssetEntry(name) {
      return !name || name.startsWith('.') || name === 'Thumbs.db';
    }

    async function listAssetFiles(dataDir) {
      const roots = ['notes-assets', 'file-assets'];
      const files = [];
      for (const root of roots) {
        const rootDir = path.join(dataDir, root);
        const noteDirs = await backend
          .invoke('fs:readdir', rootDir)
          .catch(() => []);
        for (const noteDir of noteDirs) {
          if (isIgnoredAssetEntry(noteDir)) continue;
          const fullNoteDir = path.join(rootDir, noteDir);
          const assetNames = await backend
            .invoke('fs:readdir', fullNoteDir)
            .catch(() => []);
          for (const assetName of assetNames) {
            if (isIgnoredAssetEntry(assetName)) continue;
            files.push(path.join(fullNoteDir, assetName));
          }
        }
      }
      return files;
    }

    async function migrateAssetsForAppEncryption({ encryptAtRest }) {
      const dataDir = await getEffectiveDataDir();
      if (!dataDir) return;

      const files = await listAssetFiles(dataDir);
      const phase = encryptAtRest ? 'assets-encrypt' : 'assets-plaintext';
      const total = files.length;
      let processed = 0;
      const failures = [];

      for (const filePath of files) {
        try {
          const base64 = await backend.invoke('fs:readData', filePath);
          if (base64) {
            await backend.invoke('fs:writeFile', {
              path: filePath,
              data: base64ToUint8Array(base64),
              skipAssetEncryption: !encryptAtRest,
            });
          }
        } catch (error) {
          failures.push(filePath);
        } finally {
          processed += 1;
          updateAppEncryptionProgress({
            phase,
            processed,
            total,
            id: filePath,
          });
        }
      }

      if (failures.length > 0) {
        throw new Error(
          `Failed to migrate ${failures.length} asset file(s) during app-encryption update.`
        );
      }
    }

    async function runAppEncryptionMigration({ encryptAtRest }) {
      appEncryptionBusy.value = true;
      appEncryptionProgress.value = {
        phase: 'decrypt',
        processed: 0,
        total: 0,
      };

      try {
        await noteStore.decryptAllNotesForAppEncryption({
          onProgress: updateAppEncryptionProgress,
        });

        if (encryptAtRest) {
          await noteStore.persistAllNotesForAppEncryption({
            onProgress: updateAppEncryptionProgress,
          });
        } else {
          await noteStore.persistAllNotesPlaintext({
            onProgress: updateAppEncryptionProgress,
          });
        }

        await migrateAssetsForAppEncryption({ encryptAtRest });
      } finally {
        appEncryptionBusy.value = false;
      }
    }

    // ── App-wide encryption ────────────────────────────────────────────────

    async function toggleAppEncryption(enabled) {
      if (appEncryptionBusy.value) return;
      appEncryptionError.value = '';
      const shouldEnable =
        typeof enabled === 'boolean' ? enabled : appEncryptionEnabled.value;
      appEncryptionEnabled.value = shouldEnable;

      if (shouldEnable) {
        // Turning ON
        try {
          const alreadySetUp = await appFolderHasEncryption();

          // First-time setup: there is no key material yet, so we must ask for
          // password confirmation before any migration starts.
          if (!alreadySetUp) {
            refreshAppKeyLoaded();
            return;
          }

          // Try to restore the key silently from safeStorage first.
          // If restore fails, we fall through to the password-input UI.
          const restored = await verifyAppPassphrase();
          refreshAppKeyLoaded();
          if (restored.ok) {
            await runAppEncryptionMigration({ encryptAtRest: true });
          }
          // else: key not restored — leave toggle ON, password UI appears via
          // v-if="appEncryptionEnabled && !appKeyLoaded"
        } catch (err) {
          appEncryptionEnabled.value = isAppEncryptionEnabled();
          refreshAppKeyLoaded();
          appEncryptionError.value = err?.message || String(err);
        }
      } else {
        // Turning OFF
        try {
          if (!appKeyLoaded.value) {
            appEncryptionEnabled.value = true;
            appEncryptionError.value =
              'Unlock app encryption before disabling so notes can be saved in plain form.';
            return;
          }
          await runAppEncryptionMigration({ encryptAtRest: false });
          await disableAppEncryption();
          refreshAppKeyLoaded();
          appEncryptionEnabled.value = false;
          appConfirmInput.value = '';
        } catch (err) {
          appEncryptionEnabled.value = true;
          refreshAppKeyLoaded();
          appEncryptionError.value = err?.message || String(err);
        }
      }
    }

    /** Called when the user submits the password-confirm input for app encryption. */
    async function confirmAppEncryption() {
      if (appEncryptionBusy.value) return;
      appEncryptionError.value = '';
      const pass = appConfirmInput.value;
      if (!pass) return;
      try {
        const alreadySetUp = await appFolderHasEncryption();
        const result = alreadySetUp
          ? await verifyAppPassphrase(pass)
          : await setupAppEncryption(pass);
        if (!result.ok) {
          appEncryptionError.value = result.error;
        } else {
          refreshAppKeyLoaded();
          appConfirmInput.value = '';
          await runAppEncryptionMigration({ encryptAtRest: true });
        }
      } catch (err) {
        refreshAppKeyLoaded();
        appEncryptionError.value = String(err);
      }
    }

    // ── Sync encryption ───────────────────────────────────────────────────

    async function toggleSyncEncryption() {
      syncCryptoError.value = '';
      if (syncEncryptionEnabled.value) {
        // Turning ON — set flag first so _mirrorToEncryptionSystems picks it up
        localStorage.setItem('syncEncryptionEnabled', 'true');
        try {
          // Try silent restore first (succeeds when blob already exists from a
          // previous session). On first-time enable the blob is absent, so
          // tryRestoreKeyFromSafeStorage returns false and we fall through to
          // the existing syncPassphraseInput UI (v-if syncEncryptionEnabled && !syncKeyLoaded).
          const restored = await tryRestoreKeyFromSafeStorage();
          if (restored) {
            syncKeyLoaded.value = true;
          }
          // else: leave syncKeyLoaded false — password input UI appears automatically
        } catch (err) {
          syncEncryptionEnabled.value = false;
          localStorage.removeItem('syncEncryptionEnabled');
          syncCryptoError.value = String(err);
        }
      } else {
        // Turning OFF
        await disableSyncEncryption(false);
        syncKeyLoaded.value = false;
        syncCryptoError.value = '';
      }
    }

    async function verifySyncKey() {
      syncCryptoError.value = '';
      const alreadySetUp = await syncFolderHasEncryption();
      const result = alreadySetUp
        ? await verifySyncPassphrase(syncPassphraseInput.value)
        : await setupSyncEncryption(syncPassphraseInput.value);
      if (result.ok) {
        syncKeyLoaded.value = true;
        syncPassphraseInput.value = '';
      } else {
        syncCryptoError.value = result.error;
      }
    }

    return {
      state,
      theme,
      themes,
      storage,
      translations,
      exportData,
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
      importGenericMarkdownHandler,
      forceSyncNow,
      importData,
      resetPasswordDialog,
      changeDataDir,
      handleAutoSyncChange,
      chooseDefaultPath,
      clearPath,
      defaultPath,
      appStore,
      formatTime,
      collapsibleHeading,
      openLastEdited,
      openAfterCreation,
      advancedSettings,
      directionPreference,
      spellcheckEnabled,
      autoSync,
      syncEncryptionEnabled,
      syncKeyLoaded,
      syncPassphraseInput,
      syncCryptoError,
      appEncryptionEnabled,
      appKeyLoaded,
      appEncryptionBusy,
      appEncryptionProgress,
      appEncryptionProgressPercent,
      appEncryptionProgressLabel,
      appEncryptionError,
      hasSyncFolder,
      passwordInput,
      securityError,
      hasPassword,
      setGlobalPassword,
      changePasswordDialog,
      toggleAppEncryption,
      confirmAppEncryption,
      appConfirmInput,
      toggleSyncEncryption,
      verifySyncKey,
      setupEncryption: setGlobalPassword, // alias kept for any external refs
      selectedFont,
      selectedLanguage,
      languages,
      toggleAdvancedSettings,
      toggleSpellcheck,
      applySpellcheckAttribute,
      updateLanguage,
      todayDateFormat,
      saveTodayDateFormat,
      timeFormat,
      saveTimeFormat,
      dateFormats,
      timeFormats,
      isMacOS,
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
