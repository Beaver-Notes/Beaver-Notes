<template>
  <div class="space-y-8 mb-14 w-full max-w-xl">
    <section>
      <p class="mb-2">{{ translations.settings.editor || 'Editor' }}</p>
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
  </div>
</template>
<script>
import { useDialog } from '@/composable/dialog';
import { useTranslations } from '@/composable/useTranslations';
import { useSettingsData } from '@/composable/useSettingsData';
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
      spellcheckEnabled,
      collapsibleHeading,
      todayDateFormat,
      timeFormat,
      dateFormats,
      timeFormats,
      toggleSpellcheck,
      saveTodayDateFormat,
      saveTimeFormat,
    } = useSettingsData({
      dialog,
      folderStore,
      noteStore,
      passwordStore,
      storage,
      translations,
    });

    return {
      translations,
      spellcheckEnabled,
      collapsibleHeading,
      todayDateFormat,
      timeFormat,
      dateFormats,
      timeFormats,
      toggleSpellcheck,
      saveTodayDateFormat,
      saveTimeFormat,
    };
  },
};
</script>
