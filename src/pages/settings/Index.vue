<template>
  <div class="sm:mb-14 w-full max-w-xl space-y-6">
    <section class="space-y-2">
      <div
        class="space-y-1 bg-neutral-50 dark:bg-neutral-900 rounded-xl border"
      >
        <div class="flex gap-3 px-4 py-3.5 flex-col items-start">
          <p class="text-sm font-medium text-neutral-800 dark:text-neutral-200">
            {{ translations.settings.selectLanguage || 'Language' }}
          </p>
          <p
            class="mt-0.5 text-xs leading-relaxed text-neutral-500 dark:text-neutral-400"
          >
            Choose the interface language.
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
      <p class="text-sm font-semibold text-neutral-600 dark:text-neutral-300">
        {{ translations.settings.behavior || 'Behavior' }}
      </p>
      <div
        class="space-y-1 bg-neutral-50 dark:bg-neutral-900 rounded-xl border"
      >
        <div
          class="flex flex-row gap-3 px-4 py-3.5 items-center justify-between gap-6"
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

        <div
          class="flex flex-row gap-3 px-4 py-3.5 items-center justify-between gap-6"
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
          class="flex flex-row gap-3 px-4 py-3.5 items-center justify-between gap-6"
        >
          <div class="min-w-0 flex-1">
            <p
              class="text-sm font-medium text-neutral-800 dark:text-neutral-200"
            >
              Enable sounds
            </p>
            <p
              class="mt-0.5 text-xs leading-relaxed text-neutral-500 dark:text-neutral-400"
            >
              Enable sounds for interactions around the app.
            </p>
          </div>
          <ui-switch v-model="soundsEnabled" />
        </div>
      </div>
    </section>

    <section class="space-y-2">
      <p class="text-sm font-semibold text-neutral-600 dark:text-neutral-300">
        {{ translations.settings.editor || 'Editor' }}
      </p>
      <div
        class="space-y-1 bg-neutral-50 dark:bg-neutral-900 rounded-xl border"
      >
        <div
          class="flex flex-row gap-3 px-4 py-3.5 items-center justify-between gap-6"
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
          class="flex flex-row gap-3 px-4 py-3.5 items-center justify-between gap-6"
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
          class="flex flex-col sm:flex-row gap-3 px-4 py-3.5 items-center justify-between gap-6"
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
          class="flex flex-col sm:flex-row gap-3 px-4 py-3.5 items-center justify-between gap-6"
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

    <section v-if="isIOSRuntime" class="space-y-2">
      <p class="text-sm font-semibold text-neutral-600 dark:text-neutral-300">
        Spotlight
      </p>
      <div
        class="space-y-1 bg-neutral-50 dark:bg-neutral-900 rounded-xl border"
      >
        <div
          class="flex flex-row gap-3 px-4 py-3.5 items-center justify-between gap-6"
        >
          <div class="min-w-0 flex-1">
            <p
              class="text-sm font-medium text-neutral-800 dark:text-neutral-200"
            >
              Spotlight indexing
            </p>
            <p
              class="mt-0.5 text-xs leading-relaxed text-neutral-500 dark:text-neutral-400"
            >
              Let iOS / macOS Spotlight index your notes so they can be found
              via system search.
            </p>
          </div>
          <ui-switch v-model="spotlightEnabled" @change="toggleSpotlight" />
        </div>
      </div>
    </section>

    <section v-if="isDebugMode" class="space-y-2">
      <p
        class="text-xs font-semibold uppercase tracking-[0.12em] text-red-500 dark:text-red-400"
      >
        Debug
      </p>
      <ui-card
        padding="p-4"
        class="flex flex-col gap-3 border-red-200 bg-red-50/80 dark:border-red-900/70 dark:bg-red-950/30"
      >
        <div class="space-y-0.5">
          <p class="text-sm font-medium text-red-900 dark:text-red-100">
            Nuke app
          </p>
          <p
            class="mt-0.5 text-xs leading-relaxed text-red-700 dark:text-red-300"
          >
            Debug-only reset that wipes local Beaver Notes state and relaunches
            into a fresh install experience.
          </p>
        </div>
        <div class="mt-auto pt-2">
          <ui-button class="w-full" variant="danger" @click="nukeAppDebugOnly">
            Nuke app and restart
          </ui-button>
        </div>
      </ui-card>
    </section>
  </div>
</template>

<script>
import { computed, onMounted, onUnmounted } from 'vue';
import { useTheme } from '@/composable/theme';
import { useStorage } from '@/composable/storage';
import { useDialog } from '@/composable/dialog';
import lightImg from '@/assets/images/light.png';
import darkImg from '@/assets/images/dark.png';
import systemImg from '@/assets/images/system.png';
import { usePasswordStore } from '@/store/passwd';
import { useNoteStore } from '@/store/note';
import { formatTime } from '@/utils/helpers/index.js';
import { forceSyncNow } from '../../utils/sync';
import { useFolderStore } from '../../store/folder';
import { useTranslations } from '@/composable/useTranslations';
import { useSettingsData } from '@/composable/useSettingsData';
import { useSettingsSecurity } from '@/composable/useSettingsSecurity';
import { enableIndexing } from '@/lib/native/spotsearch';
import { reindexAllNotes } from '@/utils/platform/spotlightSync.js';
import { backend } from '@/lib/tauri-bridge';

export default {
  setup() {
    const isDebugMode = import.meta.env.DEV;
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
    const isMobileRuntime = backend.isMobileRuntime();
    const isIOSRuntime = backend.isAppleRuntime();

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
      showDialogAlert: dataSettings.showDialogAlert,
    });

    onMounted(() => {
    });

    onUnmounted(() => {
    });

    async function toggleSpotlight(value) {
      try {
        if (value) {
          await enableIndexing(true);
          reindexAllNotes(noteStore.data, true);
        } else {
          await enableIndexing(false);
        }
      } catch (e) {
        dialog.alert({
          title: 'Spotlight Error',
          body: e?.toString?.() || 'Unknown error',
          okText: 'OK',
        });
      }
    }

    return {
      theme,
      themes,
      storage,
      translations,
      forceSyncNow,
      formatTime,
      isMobileRuntime,
      isIOSRuntime,

      toggleSpotlight,
      isDebugMode,
      ...dataSettings,
      ...securitySettings,
    };
  },
};
</script>
