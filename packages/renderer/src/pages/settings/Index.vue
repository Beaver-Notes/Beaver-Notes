<template>
  <div class="general space-y-8 w-full max-w-xl">
    <section>
      <p class="mb-2">App theme</p>
      <div class="flex space-x-4 text-gray-600 dark:text-gray-200">
        <button
          v-for="item in themes"
          :key="item.name"
          :class="{
            'ring-2 ring-primary': theme.currentTheme.value === item.name,
          }"
          class="bg-input p-2 rounded-lg transition cursor-pointer"
          @click="theme.setTheme(item.name)"
        >
          <img :src="item.img" class="w-40 border-2 mb-1 rounded-lg" />
          <p class="capitalize text-center text-sm">{{ item.name }}</p>
        </button>
      </div>
    </section>
    <section>
      <p class="mb-2">Sync path</p>
      <div class="flex items-center space-x-2">
        <ui-input
          v-model="state.dataDir"
          readonly
          placeholder="Path"
          class="w-full"
          @click="chooseDefaultPath"
        />
        <ui-button class="w-full" @click="chooseDefaultPath">
          Select Path
        </ui-button>
      </div>
    </section>
    <section>
      <p class="mb-2">Editor font size</p>
      <ui-select
        :model-value="state.fontSize"
        readonly
        class="w-full"
        @change="updateFontSize"
      >
        <option v-for="size in fontSize" :key="size" :value="size">
          {{ size }}
        </option>
      </ui-select>
    </section>
    <section>
      <p class="mb-2">Import/Export data</p>
      <div class="flex space-x-4">
        <div class="bg-input transition w-6/12 rounded-lg p-4">
          <div class="text-center mb-8 dark:text-gray-300 text-gray-600">
            <span
              class="
                p-5
                rounded-full
                bg-black
                dark:bg-white dark:bg-opacity-5
                bg-opacity-5
                inline-block
              "
            >
              <v-remixicon size="36" name="riFileUploadLine" />
            </span>
          </div>
          <ui-checkbox v-model="state.withPassword">
            Encrypt with password
          </ui-checkbox>
          <expand-transition>
            <ui-input
              v-if="state.withPassword"
              v-model="state.password"
              placeholder="Password"
              class="mt-2"
              autofocus
              @keyup.enter="exportData"
            />
          </expand-transition>
          <ui-button class="w-full mt-4" @click="exportData(defaultPath)"
            >Export data</ui-button
          >
        </div>
        <div class="bg-input transition w-6/12 rounded-lg p-4 flex flex-col">
          <div class="text-center mb-6 dark:text-gray-300 text-gray-600">
            <span
              class="
                p-5
                rounded-full
                bg-black
                dark:bg-white dark:bg-opacity-5
                bg-opacity-5
                inline-block
              "
            >
              <v-remixicon size="36" name="riFileDownloadLine" />
            </span>
          </div>
          <div class="flex-grow"></div>
          <ui-button class="w-full mt-6" @click="importData(defaultPath)">
            Import Data
          </ui-button>
        </div>
      </div>
    </section>
  </div>
</template>

<script>
import { shallowReactive, onMounted } from 'vue';
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

export const state = shallowReactive({
  dataDir: '',
  // other state properties...
});
export const dataDir = state.dataDir;

export default {
  setup() {
    const { ipcRenderer, path } = window.electron;
    const fontSize = [8, 10, 12, 14, 16, 18, 20, 22, 24, 26];
    const themes = [
      { name: 'light', img: lightImg },
      { name: 'dark', img: darkImg },
      { name: 'system', img: systemImg },
    ];

    const theme = useTheme();
    // eslint-disable-next-line no-unused-vars
    const dialog = useDialog();
    const storage = useStorage();

    const state = shallowReactive({
      dataDir: '',
      password: '',
      fontSize: '16',
      withPassword: false,
      lastUpdated: null,
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

        showAlert('App needs to relaunch for this change to take effect', {
          type: 'info',
          buttons: ['Relaunch app'],
        });

        await storage.set('dataDir', dir);
        await ipcRenderer.callMain('helper:relaunch');
      } catch (error) {
        console.error(error);
      }
    }

    function updateFontSize(size) {
      state.fontSize = size;
      localStorage.setItem('font-size', size);
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
        const { canceled, filePaths } = await ipcRenderer.callMain(
          'dialog:open',
          {
            title: 'Export data',
            properties: ['openDirectory'],
          }
        );

        if (canceled) return;

        let data = await storage.store();

        if (state.withPassword) {
          data = AES.encrypt(JSON.stringify(data), state.password).toString();
        }

        const folderName = dayjs().format('[Beaver Notes] YYYY-MM-DD');
        const folderPath = path.join(filePaths[0], folderName);
        const dataDir = await storage.get('dataDir', '', 'settings');

        await ipcRenderer.callMain('fs:ensureDir', folderPath);
        await ipcRenderer.callMain('fs:output-json', {
          path: path.join(folderPath, 'data.json'),
          data: { data },
        });
        await ipcRenderer.callMain('fs:copy', {
          path: path.join(dataDir, 'notes-assets'),
          dest: path.join(folderPath, 'assets'),
        });

        alert(`Notes is exported in "${folderName}" folder`);

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
        }

        window.location.reload();
      } catch (error) {
        console.error(error);
      }
    }
    async function importData() {
      try {
        const {
          canceled,
          filePaths: [dirPath],
        } = await ipcRenderer.callMain('dialog:open', {
          title: 'Import data',
          properties: ['openDirectory'],
          filters: [{ name: 'JSON', extensions: ['json'] }],
        });

        if (canceled) return;

        let { data } = await ipcRenderer.callMain(
          'fs:read-json',
          path.join(dirPath, 'data.json')
        );

        if (!data) return showAlert('Invalid data');

        if (typeof data === 'string') {
          dialog.prompt({
            title: 'Input password',
            body: 'This data is encrypted, you need to input the password to get access',
            okText: 'Import',
            placeholder: 'Password',
            onConfirm: (pass) => {
              try {
                const bytes = AES.decrypt(data, pass);
                const result = bytes.toString(Utf8);
                const resultObj = JSON.parse(result);

                mergeImportedData(resultObj);
              } catch (error) {
                showAlert('Invalid password');
                return false;
              }
            },
          });
        } else {
          mergeImportedData(data);
        }

        const dataDir = await storage.get('dataDir', '', 'settings');

        await ipcRenderer.callMain('fs:copy', {
          path: path.join(folderPath, 'assets'),
          dest: path.join(dataDir, 'notes-assets'),
        });
      } catch (error) {
        console.error(error);
      }
    }

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

        showAlert('App needs to relaunch for this change to take effect', {
          type: 'info',
          buttons: ['Relaunch app'],
        });
        defaultPath = dir;
        localStorage.setItem('default-path', defaultPath);
        state.dataDir = defaultPath;
        await ipcRenderer.callMain('helper:relaunch');
      } catch (error) {
        console.error(error);
      }
    }

    onMounted(() => {
      state.fontSize = localStorage.getItem('font-size') || '16';
      defaultPath = localStorage.getItem('default-path') || ''; // Set defaultPath here
      state.dataDir = defaultPath;
    });

    const shortcuts = {
      'mod+shift+e': importData,
      'mod+shift+i': exportData,
    };

    Mousetrap.bind(Object.keys(shortcuts), (event, combo) => {
      shortcuts[combo]();
    });

    return {
      state,
      theme,
      themes,
      storage,
      fontSize,
      exportData,
      importData,
      changeDataDir,
      updateFontSize,
      chooseDefaultPath,
      defaultPath,
    };
  },
};
</script>
