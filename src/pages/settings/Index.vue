<template>
  <div class="sm:mb-14 w-full max-w-xl space-y-6">
    <settings-group>
      <settings-row
        control-id="general-language"
        :label="translations.settings.selectLanguage || 'Language'"
        description="Choose the interface language."
        control-class="w-full sm:w-52"
      >
        <ui-select
          id="general-language"
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
      </settings-row>
    </settings-group>

    <settings-group :title="translations.settings.behavior || 'Behavior'">
      <settings-row
        control-id="general-open-after-creation"
        :label="translations.settings.openAfterCreation || 'Open note after creation'"
        description="Immediately navigate to a note after creating it."
      >
        <ui-switch id="general-open-after-creation" v-model="openAfterCreation" />
      </settings-row>

      <settings-row
        control-id="general-open-last-edited"
        :label="translations.settings.openLastEdited || 'Open last edited note'"
        description="When the app launches, reopen the note you were last editing."
      >
        <ui-switch id="general-open-last-edited" v-model="openLastEdited" />
      </settings-row>

      <settings-row
        v-if="!isTouchRuntime"
        control-id="general-sounds"
        label="Enable sounds"
        description="Enable sounds for interactions around the app."
      >
        <ui-switch id="general-sounds" v-model="soundsEnabled" />
      </settings-row>
    </settings-group>

    <settings-group :title="translations.settings.editor || 'Editor'">
      <settings-row
        control-id="general-spellcheck"
        :label="translations.settings.spellCheck || 'Spell check'"
        description="Underline spelling errors in the editor as you type."
      >
        <ui-switch
          id="general-spellcheck"
          v-model="spellcheckEnabled"
          @change="toggleSpellcheck"
        />
      </settings-row>

      <settings-row
        control-id="general-collapsible-heading"
        :label="translations.settings.collapsibleHeading || 'Collapsible headings'"
        description="Allow headings to be folded so their content is hidden below."
      >
        <ui-switch id="general-collapsible-heading" v-model="collapsibleHeading" />
      </settings-row>

      <settings-row
        control-id="general-date-format"
        description="Format used when inserting today's date via the /today command."
        control-class="w-full sm:w-52"
      >
        <ui-select
          id="general-date-format"
          v-model="todayDateFormat"
          class="w-full"
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
      </settings-row>

      <settings-row
        control-id="general-time-format"
        :label="translations.settings.timeFormat || 'Time format'"
        description="Format used when inserting the current time via the /time command."
        control-class="w-full sm:w-40"
      >
        <ui-select
          id="general-time-format"
          v-model="timeFormat"
          class="w-full"
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
      </settings-row>
    </settings-group>

    <settings-group v-if="isIOSRuntime" title="Spotlight">
      <settings-row
        control-id="general-spotlight"
        label="Spotlight indexing"
        description="Let iOS / macOS Spotlight index your notes so they can be found via system search."
      >
        <ui-switch id="general-spotlight" v-model="spotlightEnabled" @change="toggleSpotlight" />
      </settings-row>
    </settings-group>

    <settings-group v-if="isDebugMode" title="Debug" danger>
      <div class="px-4 py-3.5 flex flex-col gap-3">
        <div class="space-y-0.5">
          <p class="text-sm font-medium text-red-900 dark:text-red-100">
            Nuke app
          </p>
          <p class="mt-0.5 text-xs leading-relaxed text-red-700 dark:text-red-300">
            Debug-only reset that wipes local Beaver Notes state and relaunches
            into a fresh install experience.
          </p>
        </div>
        <ui-button class="w-full" variant="danger" @click="nukeAppDebugOnly">
          Nuke app and restart
        </ui-button>
      </div>
    </settings-group>
  </div>
</template>

<script>
import { computed, onMounted, onUnmounted } from 'vue';
import { useTheme } from '@/composable/theme';
import { useStorage } from '@/lib/storage';
import { useDialog } from '@/lib/dialog';
import lightImg from '@/assets/images/light.png';
import darkImg from '@/assets/images/dark.png';
import systemImg from '@/assets/images/system.png';
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
import SettingsGroup from '@/components/settings/SettingsGroup.vue';
import SettingsRow from '@/components/settings/SettingsRow.vue';

export default {
  components: { SettingsGroup, SettingsRow },
  setup() {
    const isDebugMode = import.meta.env.DEV;
    const { translations } = useTranslations();
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
    const isTouchRuntime = backend.isTouchRuntime();

    const dataSettings = useSettingsData({
      dialog,
      folderStore,
      noteStore,
      storage,
      translations,
    });

    const securitySettings = useSettingsSecurity({
      dialog,
      noteStore,
      translations,
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
      isTouchRuntime,

      toggleSpotlight,
      isDebugMode,
      ...dataSettings,
      ...securitySettings,
    };
  },
};
</script>
