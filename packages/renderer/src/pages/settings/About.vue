<!-- eslint-disable vue/multi-word-component-names -->
<template>
  <div class="general w-full max-w-2xl mx-auto px-6 py-8 space-y-4">
    <!-- Logo -->
    <div class="flex justify-center">
      <img
        src="../../assets/images/logo-transparent.png"
        class="w-28 drop-shadow-md"
        alt="Logo"
      />
    </div>

    <!-- Title & Description -->
    <section class="text-center space-y-2">
      <h1 class="text-3xl font-bold">
        {{ translations.about.title || '-' }}
      </h1>
      <p class="text-base">
        {{ translations.about.description || '-' }}
      </p>
    </section>

    <!-- Version Info & Update Status -->
    <div class="bg-input p-4 rounded-xl">
      <div class="flex items-center justify-between">
        <div>
          <p class="text-sm font-medium">
            {{ translations.about.versionLabel || '-' }}
          </p>
          <p class="text-lg font-semibold">
            {{ state.version }}
          </p>
        </div>

        <!-- Update Status Button -->
        <div class="flex items-center gap-3">
          <ui-button
            class="flex items-center justify-center w-10 h-10 transition-all duration-300"
            :disabled="state.isProcessing"
            @click="handleUpdateAction"
          >
            <v-remixicon
              :name="getUpdateIcon()"
              :class="getIconClass()"
              class="text-lg"
            />
          </ui-button>
        </div>
      </div>
    </div>

    <!-- Auto Update Switch -->
    <section class="flex items-center justify-between p-4">
      <div>
        <p class="text-base font-semibold">
          {{ translations.settings.autoUpdate || 'Auto Update' }}
        </p>
      </div>
      <label class="relative inline-flex items-center cursor-pointer">
        <input
          v-model="state.autoUpdateEnabled"
          type="checkbox"
          class="sr-only peer"
          @change="toggleAutoUpdate"
        />
        <div
          class="peer h-6 w-11 rounded-full bg-neutral-200 dark:bg-[#353333] after:absolute after:left-[2px] after:top-0.5 after:h-5 after:w-5 after:rounded-full after:bg-white after:transition-all peer-checked:after:translate-x-full peer-checked:bg-primary"
        ></div>
      </label>
    </section>

    <!-- External Links -->
    <section class="flex justify-center space-x-6 text-base">
      <a
        v-for="link in links"
        :key="link.name"
        :href="link.url"
        target="_blank"
        class="flex items-center gap-1 hover:text-gray-900 dark:hover:text-white transition"
      >
        <v-remixicon :name="link.icon" />
        <span>{{ translations.about[link.name] || '-' }}</span>
      </a>
    </section>
  </div>
</template>

<script>
import { onMounted, ref, shallowReactive } from 'vue';
import { useTranslation } from '@/composable/translations';

export default {
  setup() {
    const links = [
      {
        name: 'website',
        url: 'https://www.beavernotes.com',
        icon: 'riGlobalLine',
      },
      {
        name: 'github',
        url: 'https://github.com/Daniele-rolli/Beaver-Notes',
        icon: 'riGithubFill',
      },
      {
        name: 'donate',
        url: 'https://www.buymeacoffee.com/beavernotes',
        icon: 'riCupLine',
      },
    ];

    const state = shallowReactive({
      version: '0.0.0',
      autoUpdateEnabled: true,
      isProcessing: false,
      updateStatus: null,
      updateProgress: null,
      updateStatusType: 'idle',
    });

    const translations = ref({
      about: {},
      settings: {},
    });

    const checkForUpdates = async () => {
      if (state.isProcessing) return;
      state.isProcessing = true;
      state.updateStatus = 'Checking...';
      state.updateStatusType = 'checking';

      try {
        await window.electron?.ipcRenderer?.callMain('check-for-updates');
      } catch (e) {
        state.updateStatus = 'Error';
        state.updateStatusType = 'error';
      } finally {
        state.isProcessing = false;
      }
    };

    const downloadUpdate = async () => {
      if (state.isProcessing) return;
      state.isProcessing = true;
      state.updateStatus = 'Downloading...';
      state.updateStatusType = 'downloading';

      try {
        await window.electron?.ipcRenderer?.callMain('download-update');
      } catch (e) {
        state.updateStatus = 'Download error';
        state.updateStatusType = 'error';
      }
    };

    const installUpdate = () =>
      window.electron?.ipcRenderer
        ?.callMain('install-update')
        .catch(console.error);

    const handleUpdateAction = () => {
      const type = state.updateStatusType;
      if (['idle', 'not-available', 'error'].includes(type)) checkForUpdates();
      else if (type === 'available') downloadUpdate();
      else if (type === 'ready') installUpdate();
    };

    const toggleAutoUpdate = async () => {
      try {
        localStorage.setItem(
          'autoUpdateEnabled',
          JSON.stringify(state.autoUpdateEnabled)
        );
        await window.electron?.ipcRenderer?.callMain(
          'toggle-auto-update',
          state.autoUpdateEnabled
        );
        if (state.autoUpdateEnabled && state.updateStatusType === 'idle')
          setTimeout(checkForUpdates, 1000);
      } catch {
        state.autoUpdateEnabled = !state.autoUpdateEnabled;
      }
    };

    const setupListeners = () => {
      const ipc = window.electron?.ipcRenderer;
      if (!ipc) return;

      ipc.answerMain('update-status-changed', (data) => {
        state.updateStatus = data.message;
        state.updateStatusType = data.type;
        state.isProcessing = ['checking', 'downloading'].includes(data.type);
        if (data.type !== 'downloading') state.updateProgress = null;
        if (data.type === 'available' && state.autoUpdateEnabled)
          setTimeout(downloadUpdate, 1000);
        return 'received';
      });

      ipc.answerMain('update-progress-changed', ({ percent }) => {
        state.updateProgress = percent;
        state.updateStatusType = 'downloading';
        state.updateStatus = `Downloading ${Math.round(percent)}%`;
        state.isProcessing = true;
        return 'received';
      });
    };

    const getUpdateIcon = () =>
      ({
        checking: 'riLoader4Line',
        available: 'riDownloadLine',
        downloading: 'riDownload2Line',
        ready: 'riRestartLine',
        'not-available': 'riCheckLine',
        error: 'riErrorWarningLine',
      }[state.updateStatusType] || 'riRefreshLine');

    const getIconClass = () =>
      state.updateStatusType === 'checking' ? 'animate-spin' : '';

    onMounted(async () => {
      setupListeners();
      const ipc = window.electron?.ipcRenderer;
      if (ipc) {
        try {
          Object.assign(state, await ipc.callMain('app:info'));
          state.autoUpdateEnabled = await ipc.callMain(
            'get-auto-update-status'
          );
        } catch (e) {
          console.error('IPC error:', e);
        }

        if (state.autoUpdateEnabled) setTimeout(checkForUpdates, 2000);
      }

      await useTranslation().then((trans) => {
        if (trans) {
          translations.value = trans;
        }
      });
    });

    return {
      state,
      links,
      translations,
      handleUpdateAction,
      toggleAutoUpdate,
      getUpdateIcon,
      getIconClass,
    };
  },
};
</script>

<style scoped>
.animate-spin {
  animation: spin 1s linear infinite;
}

@keyframes spin {
  from {
    transform: rotate(0deg);
  }
  to {
    transform: rotate(360deg);
  }
}

button:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}
</style>
