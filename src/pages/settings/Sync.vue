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
          v-if="state.syncPath"
          class="border-t border-neutral-200 dark:border-neutral-700 flex gap-3 px-4 py-3.5 flex-row items-center justify-between gap-6"
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
  </div>
</template>
<script>
import { onMounted, onUnmounted } from 'vue';
import { useDialog } from '@/composable/dialog';
import { useTranslations } from '@/composable/useTranslations';
import { useSettingsData } from '@/composable/useSettingsData';
import { useSettingsCloudSync } from '@/composable/useSettingsCloudSync';
import { SYNC_TRANSPORT } from '@/lib/api/types';
import { usePasswordStore } from '@/store/passwd';
import { useNoteStore } from '@/store/note';
import { useFolderStore } from '@/store/folder';
import { useStorage } from '@/composable/storage';

export default {
  setup() {
    const { translations } = useTranslations();
    const dialog = useDialog();
    const storage = useStorage();
    const passwordStore = usePasswordStore();
    const noteStore = useNoteStore();
    const folderStore = useFolderStore();

    const {
      state,
      autoSync,
      chooseDefaultPath,
      clearPath,
      handleAutoSyncChange,
      syncProgress,
      registerSyncProgressListener,
      unregisterSyncProgressListener,
      showDialogAlert,
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
      registerSyncProgressListener();
    });

    onUnmounted(() => {
      unregisterSyncProgressListener();
    });

    return {
      translations,
      state,
      autoSync,
      chooseDefaultPath,
      clearPath,
      handleAutoSyncChange,
      syncProgress,
      cloudSync,
      SYNC_TRANSPORT,
    };
  },
};
</script>
