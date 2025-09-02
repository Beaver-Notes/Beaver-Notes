<!-- eslint-disable vue/multi-word-component-names -->
<template>
  <div class="general space-y-8 mb-14 w-full max-w-xl">
    <section>
      <div>
        <p class="mb-2">{{ translations.settings.selectLanguage || '-' }}</p>
        <ui-select
          v-model="selectedLanguage"
          class="w-full"
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
    </section>
    <section>
      <p class="mb-2">{{ translations.settings.syncPath || '-' }}</p>
      <div class="flex items-center ltr:space-x-2">
        <ui-input
          v-model="state.dataDir"
          readonly
          :placeholder="translations.settings.pathPlaceholder || '-'"
          class="w-full"
          @click="chooseDefaultPath"
        />
        <ui-button class="w-full rtl:mx-2" @click="chooseDefaultPath">
          {{ translations.settings.selectPath || '-' }}
        </ui-button>
        <ui-button @click="clearPath">
          <v-remixicon name="riDeleteBin6Line" />
        </ui-button>
      </div>
    </section>
    <section>
      <p class="mb-2">{{ translations.settings.utilities || '-' }}</p>
      <div>
        <div class="space-y-1">
          <!-- advanced settings -->
          <div class="flex items-center py-2 justify-between">
            <div>
              <span class="block text-lg align-left">
                {{ translations.settings.advancedSettings || '-' }}
              </span>
            </div>
            <label class="relative inline-flex cursor-pointer items-center">
              <input
                id="switch"
                v-model="advancedSettings"
                type="checkbox"
                class="peer sr-only"
                @change="toggleAdvancedSettings"
              />
              <div
                class="peer h-6 w-11 rounded-full border bg-neutral-200 dark:bg-[#353333] after:absolute after:left-[2px] rtl:after:right-[22px] after:top-0.5 after:h-5 after:w-5 after:rounded-full after:border after:border-neutral-300 after:bg-white after:transition-all after:content-[''] peer-checked:bg-primary peer-checked:after:translate-x-full rtl:peer-checked:after:border-white peer-focus:ring-green-300"
              ></div>
            </label>
          </div>
          <!-- Spellcheck -->
          <div class="flex items-center py-2 justify-between">
            <div>
              <span class="block text-lg align-left">
                {{ translations.settings.spellCheck || '-' }}
              </span>
            </div>
            <label class="relative inline-flex cursor-pointer items-center">
              <input
                id="switch"
                v-model="spellcheckEnabled"
                type="checkbox"
                class="peer sr-only"
                @change="toggleSpellcheck"
              />
              <div
                class="peer h-6 w-11 rounded-full border bg-neutral-200 dark:bg-[#353333] after:absolute after:left-[2px] rtl:after:right-[22px] after:top-0.5 after:h-5 after:w-5 after:rounded-full after:border after:border-neutral-300 after:bg-white after:transition-all after:content-[''] peer-checked:bg-primary peer-checked:after:translate-x-full rtl:peer-checked:after:border-white peer-focus:ring-green-300"
              ></div>
            </label>
          </div>
          <!-- Auto Sync -->
          <div class="flex items-center py-2 justify-between">
            <div>
              <span class="block text-lg align-left">
                {{ translations.settings.autoSync || '-' }}
              </span>
            </div>
            <label class="relative inline-flex cursor-pointer items-center">
              <input
                id="switch"
                v-model="autoSync"
                type="checkbox"
                class="peer sr-only"
                @change="handleAutoSyncChange"
              />
              <div
                class="peer h-6 w-11 rounded-full border bg-neutral-200 dark:bg-[#353333] after:absolute after:left-[2px] rtl:after:right-[22px] after:top-0.5 after:h-5 after:w-5 after:rounded-full after:border after:border-neutral-300 after:bg-white after:transition-all after:content-[''] peer-checked:bg-primary peer-checked:after:translate-x-full rtl:peer-checked:after:border-white peer-focus:ring-green-300"
              ></div>
            </label>
          </div>
          <!-- open last edited -->
          <div class="flex items-center py-2 justify-between">
            <div>
              <span class="block text-lg align-left"
                >{{ translations.settings.openLastEdited || '-' }}
              </span>
            </div>
            <label class="relative inline-flex cursor-pointer items-center">
              <input
                id="switch"
                v-model="openLastEdited"
                type="checkbox"
                class="peer sr-only"
              />
              <div
                class="peer h-6 w-11 rounded-full border bg-neutral-200 dark:bg-[#353333] after:absolute after:left-[2px] rtl:after:right-[22px] after:top-0.5 after:h-5 after:w-5 after:rounded-full after:border after:border-neutral-300 after:bg-white after:transition-all after:content-[''] peer-checked:bg-primary peer-checked:after:translate-x-full rtl:peer-checked:after:border-white peer-focus:ring-green-300"
              ></div>
            </label>
          </div>
          <!-- show after creation -->
          <div class="flex items-center py-2 justify-between">
            <div>
              <span class="block text-lg align-left"
                >{{ translations.settings.openAfterCreation || '-' }}
              </span>
            </div>
            <label class="relative inline-flex cursor-pointer items-center">
              <input
                id="switch"
                v-model="openAfterCreation"
                type="checkbox"
                class="peer sr-only"
              />
              <div
                class="peer h-6 w-11 rounded-full border bg-neutral-200 dark:bg-[#353333] after:absolute after:left-[2px] rtl:after:right-[22px] after:top-0.5 after:h-5 after:w-5 after:rounded-full after:border after:border-neutral-300 after:bg-white after:transition-all after:content-[''] peer-checked:bg-primary peer-checked:after:translate-x-full rtl:peer-checked:after:border-white peer-focus:ring-green-300"
              ></div>
            </label>
          </div>
        </div>
      </div>
    </section>
    <section>
      <p class="mb-2">{{ translations.settings.editor || '-' }}</p>
      <div class="space-y-1">
        <div class="flex items-center py-2 justify-between">
          <div>
            <span class="block text-lg align-left"
              >{{ translations.settings.collapsibleHeading || '-' }}
            </span>
          </div>
          <label class="relative inline-flex cursor-pointer items-center">
            <input
              id="switch"
              v-model="collapsibleHeading"
              type="checkbox"
              class="peer sr-only"
            />
            <div
              class="peer h-6 w-11 rounded-full border bg-neutral-200 dark:bg-[#353333] after:absolute after:left-[2px] rtl:after:right-[22px] after:top-0.5 after:h-5 after:w-5 after:rounded-full after:border after:border-neutral-300 after:bg-white after:transition-all after:content-[''] peer-checked:bg-primary peer-checked:after:translate-x-full rtl:peer-checked:after:border-white peer-focus:ring-green-300"
            ></div>
          </label>
        </div>
      </div>
    </section>
    <section>
      <p class="mb-2">{{ translations.settings.ieData || '-' }}</p>
      <div class="flex ltr:space-x-4">
        <div class="bg-input rtl:ml-4 transition w-6/12 rounded-lg p-4">
          <div class="text-center mb-8 dark:text-neutral-300 text-neutral-600">
            <span
              class="p-5 rounded-full bg-black dark:bg-white dark:bg-opacity-5 bg-opacity-5 inline-block"
            >
              <v-remixicon size="36" name="riFileUploadLine" />
            </span>
          </div>
          <ui-checkbox v-model="state.withPassword">
            {{ translations.settings.encryptPasswd || '-' }}
          </ui-checkbox>
          <expand-transition>
            <ui-input
              v-if="state.withPassword"
              v-model="state.password"
              :placeholder="translations.settings.password || '-'"
              class="mt-2 w-fill"
              style="-webkit-text-security: disc"
              autofocus
              @keyup.enter="forceSyncNow"
            />
          </expand-transition>
          <ui-button class="w-full mt-4" @click="exportData(defaultPath)">
            {{ translations.settings.exportData || '-' }}</ui-button
          >
        </div>
        <div class="bg-input transition w-6/12 rounded-lg p-4 flex flex-col">
          <div class="text-center mb-6 dark:text-neutral-300 text-neutral-600">
            <span
              class="p-5 rounded-full bg-black dark:bg-white dark:bg-opacity-5 bg-opacity-5 inline-block"
            >
              <v-remixicon size="36" name="riFileDownloadLine" />
            </span>
          </div>
          <div class="flex-grow"></div>
          <ui-button class="w-full mt-6" @click="importData(defaultPath)">
            {{ translations.settings.importData || '-' }}
          </ui-button>
        </div>
      </div>
      <div class="flex items-center">
        <v-remixicon
          name="riQuestionLine"
          class="inline-block align-middle mr-1 mt-2"
        />
        <p class="text-sm relative text-neutral-500 mt-2">
          <span v-tooltip:right="translations.settings.encryptionMessage">
            {{ translations.settings.aboutDataEncryption || '-' }}
          </span>
        </p>
      </div>
    </section>
    <!-- Import data from other apps -->
    <section>
      <p class="mb-2">{{ translations.settings.importFile || '-' }}</p>
      <div class="flex items-center ltr:space-x-2">
        <ui-button class="w-full rtl:mx-2" @click="selectMarkdown">
          {{ translations.settings.markdownArchive || '-' }}
        </ui-button>
        <ui-button class="w-full rtl:mx-2" @click="selectBea">
          {{ translations.menu.bea || '-' }}
        </ui-button>
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
import { formatTime } from '@/utils/time-format';
import { useRouter } from 'vue-router';
import { useAppStore } from '../../store/app';
import { t } from '@/utils/translations';
import { processDirectory } from '@/utils/markdown-helper';
import { forceSyncNow } from '../../utils/sync';
import { importBEA } from '../../utils/share/BEA';
import { useTranslation } from '@/composable/translations';
import { useNoteStore } from '../../store/note';
import { useFolderStore } from '../../store/folder';

const LANGUAGE_CONFIG = {
  de: { name: 'Deutsch', dir: 'ltr' },
  en: { name: 'English', dir: 'ltr' },
  es: { name: 'Español', dir: 'ltr' },
  fr: { name: 'Français', dir: 'ltr' },
  it: { name: 'Italiano', dir: 'ltr' },
  nl: { name: 'Nederlands', dir: 'ltr' },
  ru: { name: 'Русский', dir: 'ltr' },
  tr: { name: 'Türkçe', dir: 'ltr' },
  uk: { name: 'Українська', dir: 'ltr' },
  zh: { name: '简体中文', dir: 'ltr' },
  ar: { name: 'العربية', dir: 'rtl' },
};

export const state = shallowReactive({
  dataDir: '',
  directionPreference: localStorage.getItem('directionPreference') || 'ltr',
});
export const dataDir = state.dataDir;

const getLanguageDirection = (languageCode) => {
  return LANGUAGE_CONFIG[languageCode]?.dir || 'ltr';
};

export default {
  setup() {
    const passwordStore = usePasswordStore();
    const advancedSettings = ref(
      localStorage.getItem('advanced-settings') === 'true'
    );

    const spellcheckEnabled = ref(
      localStorage.getItem('spellcheckEnabled') === 'true' &&
        localStorage.getItem('spellcheckEnabled') != null
    );
    const autoSync = ref(localStorage.getItem('autoSync') === 'true');
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
    const { ipcRenderer, path, notification } = window.electron;
    const themes = [
      { name: 'light', img: lightImg },
      { name: 'dark', img: darkImg },
      { name: 'system', img: systemImg },
    ];
    const router = useRouter();
    const theme = useTheme();
    const dialog = useDialog();
    const storage = useStorage();
    const noteStore = useNoteStore();
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
        } = await ipcRenderer.callMain('dialog:open', {
          title: 'Select directory',
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
        console.error(error);
      }
    }

    function showAlert(message, options = {}) {
      ipcRenderer.callMain('dialog:message', {
        type: 'error',
        title: 'Alert',
        message,
        ...options,
      });
    }

    async function exportData() {
      try {
        const dataDir = await storage.get('dataDir', '', 'settings');
        const { canceled, filePaths } = await ipcRenderer.callMain(
          'dialog:open',
          {
            title: 'Export data',
            properties: ['openDirectory'],
          }
        );

        if (canceled) return;

        let data = await storage.store();
        data['sharedKey'] = storage.get('sharedKey');
        data['lockedNotes'] = JSON.parse(localStorage.getItem('lockedNotes'));
        await passwordStore.retrieve();
        data['sharedKey'] = passwordStore.sharedKey;
        data['derivedKey'] = passwordStore.derivedKey;
        if (state.withPassword) {
          data = AES.encrypt(JSON.stringify(data), state.password).toString();
        }

        const folderName = dayjs().format('[Beaver Notes] YYYY-MM-DD');
        const folderPath = path.join(filePaths[0], folderName);

        const containsGvfs = folderPath.includes('gvfs');

        if (containsGvfs) {
          await ipcRenderer.callMain('fs:ensureDir', folderPath);
          await ipcRenderer.callMain('fs:output-json', {
            path: path.join(folderPath, 'data.json'),
            data: { data },
          });

          const notesAssetsSource = path.join(dataDir, 'notes-assets');
          const notesAssetsDest = path.join(folderPath, 'assets');
          await ipcRenderer.callMain('gvfs:copy', {
            path: notesAssetsSource,
            dest: notesAssetsDest,
          });

          const fileAssetsSource = path.join(dataDir, 'file-assets');
          const fileAssetsDest = path.join(folderPath, 'file-assets');
          await ipcRenderer.callMain('gvfs:copy', {
            path: fileAssetsSource,
            dest: fileAssetsDest,
          });
        } else {
          await ipcRenderer.callMain('fs:ensureDir', folderPath);
          await ipcRenderer.callMain('fs:output-json', {
            path: path.join(folderPath, 'data.json'),
            data: { data },
          });
          await ipcRenderer.callMain('fs:copy', {
            path: path.join(dataDir, 'notes-assets'),
            dest: path.join(folderPath, 'assets'),
          });
          await ipcRenderer.callMain('fs:copy', {
            path: path.join(dataDir, 'file-assets'),
            dest: path.join(folderPath, 'file-assets'),
          });

          alert(`${translations.value.settings.exportMessage}"${folderName}"`);
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
          await noteStore.retrieve();
          await folerStore.retrieve();
        }
      } catch (error) {
        console.error(error);
      }
    }

    async function importData() {
      try {
        const dataDir = await storage.get('dataDir', '', 'settings');
        const {
          canceled,
          filePaths: [dirPath],
        } = await ipcRenderer.callMain('dialog:open', {
          title: 'Import data',
          properties: ['openDirectory'],
        });

        if (canceled) return;

        let { data } = await ipcRenderer.callMain(
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

                localStorage.setItem('dataDir', importedDefaultPath);

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

                if (data['sharedKey']) {
                  await passwordStore.importSharedKey(
                    data['sharedKey'],
                    data['derivedKey']
                  );
                }

                await ipcRenderer.callMain('fs:copy', {
                  path: path.join(dirPath, 'assets'),
                  dest: path.join(dataDir, 'notes-assets'),
                });

                await ipcRenderer.callMain('fs:copy', {
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

          await ipcRenderer.callMain('fs:copy', {
            path: path.join(dirPath, 'assets'),
            dest: path.join(dataDir, 'notes-assets'),
          });

          await ipcRenderer.callMain('fs:copy', {
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
        } = await ipcRenderer.callMain('dialog:open', {
          title: 'Select directory',
          properties: ['openDirectory'],
        });

        if (canceled) return;

        state.importDir = dir;
        await processDirectory(state.importDir);
        await storage.set('importDir', state.importDir);

        notification({
          title: translations.value.settings.notification,
          body:
            translations.value.settings.importSuccess ||
            'Directory processed successfully!',
        });
      } catch (error) {
        console.error('Error selecting or processing directory:', error);
        notification({
          title: translations.value.settings.notification,
          body:
            translations.value.settings.importFail ||
            'Failed to process the directory.',
        });
      }
    };

    const selectBea = async () => {
      try {
        const {
          canceled,
          filePaths: [file],
        } = await ipcRenderer.callMain('dialog:open', {
          title: 'Select file',
          properties: ['openFile'],
        });

        if (canceled) return;

        state.importFile = file;
        await importBEA(state.importFile, router);

        notification({
          title: translations.value.settings.notification,
          body:
            translations.value.settings.importSuccess ||
            'File processed successfully!',
        });
      } catch (error) {
        console.error('Error selecting or processing file:', error);
        notification({
          title: translations.value.settings.notification,
          body:
            translations.value.settings.importFail ||
            'Failed to process the file.',
        });
      }
    };

    async function chooseDefaultPath() {
      try {
        const {
          canceled,
          filePaths: [dir],
        } = await ipcRenderer.callMain('dialog:open', {
          title: 'Select directory',
          properties: ['openDirectory'],
        });

        if (canceled) return;
        defaultPath = dir;
        localStorage.setItem('default-path', defaultPath);
        state.dataDir = defaultPath;
        window.location.reload();
      } catch (error) {
        console.error(error);
      }
    }

    async function clearPath() {
      state.dataDir = '';
      localStorage.removeItem('default-path');
    }

    onMounted(() => {
      defaultPath = localStorage.getItem('default-path') || '';
      state.dataDir = defaultPath;
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
                      alert(translations.value.settings.passwordResetSuccess);
                    } catch (error) {
                      console.error('Error resetting password:', error);
                      alert(translations.value.settings.passwordResetError);
                    }
                  } else {
                    alert(translations.value.settings.invalidPassword);
                  }
                },
              });
            } else {
              alert(translations.value.settings.wrongCurrentPassword);
            }
          } else {
            alert(translations.value.settings.invalidPassword);
          }
        },
      });
    }

    // Translations
    const translations = ref({
      settings: {},
      menu: {},
    });

    onMounted(async () => {
      await useTranslation().then((trans) => {
        if (trans) {
          translations.value = trans;
        }
      });
    });

    Mousetrap.bind(Object.keys(shortcuts), (event, combo) => {
      shortcuts[combo]();
    });

    const appStore = useAppStore();

    function deleteAuth(auth) {
      dialog.confirm({
        body: t(translations.value.settings.confirmDelete, {
          name: auth.name,
          id: auth.id,
        }),
        onConfirm: async () => {
          appStore.authRecords = appStore.authRecords.filter(
            (a) => a.id !== auth.id
          );
          await appStore.updateToStorage();
        },
      });
    }

    async function toggleAuth(auth, v) {
      auth.status = v ? 1 : 0;
      await appStore.updateToStorage();
    }

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
        window.electron.ipcRenderer.callMain(
          'app:spellcheck',
          spellcheckEnabled.value
        );
      });
    };

    const updateLanguage = () => {
      const languageCode = selectedLanguage.value;
      const dir = getLanguageDirection(languageCode);
      localStorage.setItem('selectedLanguage', languageCode);
      localStorage.setItem('directionPreference', dir);
      window.location.reload(); // Optional: you might want a softer re-render
    };

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
      deleteAuth,
      toggleAuth,
      t,
      collapsibleHeading,
      openLastEdited,
      openAfterCreation,
      advancedSettings,
      directionPreference,
      spellcheckEnabled,
      autoSync,
      selectedFont,
      selectedLanguage,
      languages,
      toggleAdvancedSettings,
      toggleSpellcheck,
      applySpellcheckAttribute,
      updateLanguage,
    };
  },
  computed: {
    isMacOS() {
      return window.navigator.platform.toLowerCase().includes('mac');
    },
  },
};
</script>
