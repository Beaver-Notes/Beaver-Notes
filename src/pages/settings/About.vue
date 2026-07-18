<template>
  <div class="general space-y-8 mb-14 w-full max-w-xl">
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

        <!-- Update Status Button / Managed Message -->
        <div class="flex items-center gap-3">
          <template v-if="state.managed && state.managedSource !== 'appStore'">
            <span class="text-xs text-neutral-500 dark:text-neutral-400 max-w-40 text-right">
              {{ state.updateStatus }}
            </span>
          </template>
          <template v-else-if="!state.managed">
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
          </template>
        </div>
      </div>
    </div>

    <!-- Auto Update Switch -->
    <section v-if="!state.managed" class="flex items-center justify-between p-4">
      <div>
        <p class="text-base font-semibold">
          {{ translations.settings.autoUpdate || 'Auto Update' }}
        </p>
      </div>
      <label class="relative inline-flex items-center">
        <input
          v-model="state.autoUpdateEnabled"
          type="checkbox"
          class="sr-only peer"
          @change="toggleAutoUpdate"
        />
        <div
          class="peer h-6 w-11 rounded-full bg-neutral-200 dark:bg-neutral-700 after:absolute after:left-[2px] after:top-0.5 after:h-5 after:w-5 after:rounded-full after:bg-white after:transition-all peer-checked:after:translate-x-full peer-checked:bg-primary"
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

    <section class="bg-input p-4 rounded-xl space-y-3">
      <div>
        <p class="text-sm font-medium">Show onboarding again</p>
        <p class="text-xs text-neutral-500 dark:text-neutral-400">
          Reopen the first-run migration and setup screen without clearing your
          current notes.
        </p>
      </div>
      <ui-button @click="showOnboarding"> Show onboarding </ui-button>
    </section>
  </div>
</template>

<script>
const UPDATE_CHECK_DELAY_MS = 1000;
const UPDATE_DOWNLOAD_DELAY_MS = 1000;
const INITIAL_UPDATE_CHECK_DELAY_MS = 2000;

import { onMounted, shallowReactive } from 'vue';
import { useRouter } from 'vue-router';
import { useTranslations } from '@/composable/useTranslations';
import { setSetting } from '@/composable/settings';
import { backend } from '@/lib/tauri-bridge';
import { getAppInfo } from '@/lib/native/app';
import {
  checkForUpdates as runUpdateCheck,
  downloadUpdate as runUpdateDownload,
  getAutoUpdateStatus,
  getInstallationSource,
  installUpdate,
  isUpdateManaged,
  toggleAutoUpdate as setAutoUpdateEnabled,
} from '@/lib/native/updates';

export default {
  setup() {
    const router = useRouter();
    const { translations } = useTranslations();
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

    const MANAGED_MESSAGES = {
      scoop: 'Updates are managed by Scoop. Run scoop update beaver-notes to update.',
      brew: 'Updates are managed by Homebrew. Run brew upgrade beaver-notes to update.',
      linuxPackage: 'Updates are managed by your package manager. Use it to update Beaver Notes.',
      appStore: 'Updates are managed by your app store. Check for updates there.',
    };

    const state = shallowReactive({
      version: '0.0.0',
      autoUpdateEnabled: true,
      isProcessing: false,
      updateStatus: null,
      updateProgress: null,
      updateStatusType: 'idle',
      managed: false,
      managedSource: null,
    });

    const checkForUpdates = async () => {
      if (state.isProcessing) return;
      state.isProcessing = true;
      state.updateStatus = 'Checking...';
      state.updateStatusType = 'checking';

      try {
        await runUpdateCheck();
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
        await runUpdateDownload();
      } catch (e) {
        state.updateStatus = 'Download error';
        state.updateStatusType = 'error';
      }
    };

    const installPendingUpdate = () => installUpdate().catch(console.error);

    const showOnboarding = async () => {
      await setSetting('onboardingCompleted', false);
      await router.push('/onboarding');
    };

    const handleUpdateAction = () => {
      const type = state.updateStatusType;
      if (['idle', 'not-available', 'error'].includes(type)) checkForUpdates();
      else if (type === 'available') downloadUpdate();
      else if (type === 'ready') installPendingUpdate();
    };

    const toggleAutoUpdate = async () => {
      try {
        await setAutoUpdateEnabled(state.autoUpdateEnabled);
        if (state.autoUpdateEnabled && state.updateStatusType === 'idle')
          setTimeout(checkForUpdates, UPDATE_CHECK_DELAY_MS);
      } catch {
        state.autoUpdateEnabled = !state.autoUpdateEnabled;
      }
    };

    const setupListeners = () => {
      const bridge = backend;
      if (!bridge) return;

      bridge.listenPayload('update-status-changed', (data) => {
        state.updateStatus = data.message;
        state.updateStatusType = data.type;
        state.isProcessing = ['checking', 'downloading'].includes(data.type);
        if (data.type !== 'downloading') state.updateProgress = null;
        if (data.type === 'available' && state.autoUpdateEnabled)
          setTimeout(downloadUpdate, UPDATE_DOWNLOAD_DELAY_MS);
        return 'received';
      });

      bridge.listenPayload('update-progress-changed', ({ percent }) => {
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
      const bridge = backend;
      if (bridge) {
        try {
          const managed = await isUpdateManaged();
          state.managed = managed;
          const source = await getInstallationSource();
          state.managedSource = source;
          if (managed) {
            state.updateStatus = MANAGED_MESSAGES[source] || 'Updates are managed externally.';
            state.updateStatusType = 'managed';
          } else {
            Object.assign(state, await getAppInfo());
            state.autoUpdateEnabled = await getAutoUpdateStatus();
          }
        } catch (e) {
          console.error('Bridge error:', e);
        }

        if (!state.managed && state.autoUpdateEnabled)
          setTimeout(checkForUpdates, INITIAL_UPDATE_CHECK_DELAY_MS);
      }
    });

    return {
      state,
      links,
      translations,
      handleUpdateAction,
      toggleAutoUpdate,
      showOnboarding,
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
