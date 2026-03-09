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

        <ui-card padding="p-4" class="flex h-full flex-col gap-3">
          <div class="space-y-0.5">
            <p
              class="text-sm font-medium text-neutral-800 dark:text-neutral-200"
            >
              {{ translations.settings.markdownArchive || 'Import Markdown' }}
            </p>
            <p
              class="mt-0.5 text-xs leading-relaxed text-neutral-500 dark:text-neutral-400"
            >
              Import a folder of .md files as notes. Folder structure is
              preserved.
            </p>
          </div>
          <div class="mt-auto pt-2">
            <ui-button class="w-full" @click="selectMarkdown">{{
              translations.settings.markdownArchive || 'Select folder'
            }}</ui-button>
          </div>
        </ui-card>

        <ui-card padding="p-4" class="flex h-full flex-col gap-3">
          <div class="space-y-0.5">
            <p
              class="text-sm font-medium text-neutral-800 dark:text-neutral-200"
            >
              {{ translations.menu.bea || 'Import .bea' }}
            </p>
            <p
              class="mt-0.5 text-xs leading-relaxed text-neutral-500 dark:text-neutral-400"
            >
              Import notes from a Beaver Notes .bea export archive.
            </p>
          </div>
          <div class="mt-auto pt-2">
            <ui-button class="w-full" @click="selectBea">{{
              translations.menu.bea || 'Select file'
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
import { useRouter } from 'vue-router';
import { useAppStore } from '../../store/app';
import { processDirectory } from '@/utils/markdown-helper';
import { forceSyncNow } from '../../utils/sync';
import { importBEA } from '../../utils/share/BEA';
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
import { useLocalStorage } from '../../composable/storage';
import { useTranslations } from '../../composable/useTranslations';
import { backend, showNotification, path } from '@/lib/tauri-bridge';

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
    const advancedSettings = ref(
      localStorage.getItem('advanced-settings') === 'true'
    );

    const spellcheckEnabled = ref(
      localStorage.getItem('spellcheckEnabled') === 'true' &&
        localStorage.getItem('spellcheckEnabled') != null
    );
    const autoSync = ref(localStorage.getItem('autoSync') === 'true');
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
    const selectedFont = ref(localStorage.getItem('selected-font') || 'Arimo');
    const selectedLanguage = ref(
      localStorage.getItem('selectedLanguage') || 'en'
    );
    const directionPreference = ref(
      localStorage.getItem('directionPreference') ||
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
    const router = useRouter();
    const theme = useTheme();
    const dialog = useDialog();
    const storage = useStorage();
    const folerStore = useFolderStore();

    const state = shallowReactive({
      dataDir: '',
      password: '',
      withPassword: false,
      lastUpdated: null,
      zoomLevel: (+localStorage.getItem('zoomLevel') || 1).toFixed(1),
    });

    let defaultPath = '';

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

    const selectMarkdown = async () => {
      try {
        const {
          canceled,
          filePaths: [dir],
        } = await backend.invoke('dialog:open', {
          title: translations.value.settings.selectPath,
          properties: ['openDirectory'],
        });

        if (canceled) return;

        state.importDir = dir;
        await processDirectory(state.importDir);
        await storage.set('importDir', state.importDir);

        showNotification({
          title: translations.value.settings.notification,
          body: translations.value.settings.directoryProcessedSuccess,
        });
      } catch (error) {
        console.error('Error selecting or processing directory:', error);
        showNotification({
          title: translations.value.settings.notification,
          body: translations.value.settings.directoryProcessedFailed,
        });
      }
    };

    const selectBea = async () => {
      try {
        const {
          canceled,
          filePaths: [file],
        } = await backend.invoke('dialog:open', {
          title: translations.value.settings.selectFile,
          properties: ['openFile'],
        });

        if (canceled) return;

        state.importFile = file;

        try {
          await importBEA(state.importFile, router);
          showNotification({
            title: translations.value.settings.notification,
            body: translations.value.settings.importSuccess,
          });
        } catch (err) {
          console.warn('Non-fatal importBEA warning:', err);
          showNotification({
            title: translations.value.settings.notification,
            body: translations.value.settings.importSuccess,
          });
        }
      } catch (error) {
        console.error('Critical BEA import error:', error);
        showNotification({
          title: translations.value.settings.notification,
          body: translations.value.settings.importFail,
        });
      }
    };

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

      const currentValue = localStorage.getItem('autoSync');
      const newAutoSyncValue = currentValue === 'true' ? 'false' : 'true';
      localStorage.setItem('autoSync', newAutoSyncValue);
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

    const timeStorage = {
      date: useLocalStorage('todayDateFormat', {
        defaultValue: 'DD-MM-YYYY',
        parse: (value) => value,
      }),
      time: useLocalStorage('timeFormat', {
        defaultValue: 'HH:mm',
        parse: (value) => value,
      }),
    };
    const todayDateFormat = ref(timeStorage.date.get());

    const timeFormat = ref(timeStorage.time.get());

    const saveTodayDateFormat = () => {
      if (todayDateFormat.value.trim() === '') {
        todayDateFormat.value = 'DD-MM-YYYY';
      }
      timeStorage.date.set(todayDateFormat.value);
    };

    const saveTimeFormat = () => {
      if (timeFormat.value.trim() === '') {
        timeFormat.value = 'HH:mm';
      }
      timeStorage.time.set(timeFormat.value);
    };

    const toggleAdvancedSettings = () => {
      localStorage.setItem(
        'advanced-settings',
        advancedSettings.value.toString()
      );
    };

    const toggleSpellcheck = () => {
      localStorage.setItem('spellcheckEnabled', spellcheckEnabled.value);
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
      localStorage.setItem('selectedLanguage', languageCode);
      localStorage.setItem('directionPreference', dir);
      window.location.reload();
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
      forceSyncNow,
      importData,
      resetPasswordDialog,
      changeDataDir,
      handleAutoSyncChange,
      chooseDefaultPath,
      clearPath,
      defaultPath,
      appStore,
      selectMarkdown,
      selectBea,
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
    };
  },
  computed: {
    isMacOS() {
      return window.navigator.platform.toLowerCase().includes('mac');
    },
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
