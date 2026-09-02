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
          <option v-for="language in languages" :key="language.code" :value="language.code">
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
        <ui-switch id="general-spellcheck" v-model="spellcheckEnabled" @change="toggleSpellcheck" />
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
        <ui-select id="general-date-format" v-model="todayDateFormat" class="w-full" @change="saveTodayDateFormat">
          <option v-for="format in dateFormats" :key="format.value" :value="format.value">{{ format.label }}</option>
        </ui-select>
      </settings-row>
      <settings-row
        control-id="general-time-format"
        :label="translations.settings.timeFormat || 'Time format'"
        description="Format used when inserting the current time via the /time command."
        control-class="w-full sm:w-40"
      >
        <ui-select id="general-time-format" v-model="timeFormat" class="w-full" @change="saveTimeFormat">
          <option v-for="format in timeFormats" :key="format.value" :value="format.value">{{ format.label }}</option>
        </ui-select>
      </settings-row>
    </settings-group>

    <settings-group v-if="isIOSRuntime" title="Spotlight">
      <settings-row control-id="general-spotlight" label="Spotlight indexing" description="Let iOS / macOS Spotlight index your notes so they can be found via system search.">
        <ui-switch id="general-spotlight" v-model="spotlightEnabled" @change="toggleSpotlight" />
      </settings-row>
    </settings-group>

    <!-- Security: simplified to Change Passphrase only -->
    <settings-group :title="translations.settings.security || 'Security'">
      <div class="px-4 py-3.5 space-y-3">
        <div class="flex items-start justify-between gap-4">
          <div class="flex-1 min-w-0">
            <span class="block text-sm font-medium text-neutral-800 dark:text-neutral-200">{{ translations.settings.encryption || 'Encryption' }}</span>
            <p class="text-xs text-neutral-500 dark:text-neutral-400 mt-0.5">{{ translations.settings.encryptionDesc || 'All notes and assets are encrypted at rest. Encryption is always on.' }}</p>
          </div>
          <span class="inline-flex items-center gap-1 text-xs text-primary font-medium"><v-remixicon name="riShieldCheckLine" size="16" />{{ translations.settings.encryptionAlwaysOn || 'Always on' }}</span>
        </div>
        <p v-if="encryptionError" id="encryption-error" role="alert" class="text-xs text-red-500">{{ encryptionError }}</p>
        <transition name="setting-fade">
          <div v-if="encryptionBusy" class="rounded-lg dark:bg-primary/10 p-2">
            <p class="text-xs text-primary">{{ encryptionProgressLabel }}: {{ encryptionProgress.processed }} / {{ encryptionProgress.total }} ({{ encryptionProgressPercent }}%)</p>
            <p class="text-xs text-primary dark:text-primary/80 mt-1">{{ translations.settings.keepSettingsOpen || 'Keep this page open until migration completes.' }}</p>
            <div class="mt-2 h-1.5 rounded bg-primary/70 dark:bg-primary/20"><div class="app-encryption-progress-bar h-1.5 rounded bg-primary dark:bg-primary/80" :style="{ transform: `scaleX(${encryptionProgressPercent / 100})` }" /></div>
          </div>
        </transition>
        <div class="flex items-center gap-2">
          <ui-button class="text-sm" :disabled="encryptionBusy" @click="changeEncryptionPassphrase">{{ translations.settings.changePassphrase || 'Change Passphrase' }}</ui-button>
          <details>
            <summary class="text-sm cursor-pointer text-neutral-500 dark:text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-300">{{ translations.settings.advanced || 'Advanced' }}</summary>
            <div class="mt-2">
              <ui-button class="text-sm" variant="secondary" :disabled="encryptionBusy || !keyLoaded" @click="showRecoveryCode">{{ translations.settings.showRecoveryCode || 'Recovery code' }}</ui-button>
            </div>
          </details>
        </div>
      </div>
    </settings-group>

    <!-- Sync & Backup (merged Data) -->
    <settings-group :title="translations.settings.dataSecurity || 'Sync & Backup'">
      <div class="flex flex-col gap-3 px-4 py-3.5">
        <div class="min-w-0">
          <p class="text-sm font-medium text-neutral-800 dark:text-neutral-200">{{ translations.settings.syncPath || 'Sync folder' }}</p>
          <p class="mt-0.5 text-xs leading-relaxed text-neutral-500 dark:text-neutral-400">The folder where your notes and assets are stored on disk.</p>
        </div>
        <div class="flex items-center gap-2 justify-between">
          <span class="max-w-32 sm:max-w-64 truncate rounded-lg bg-neutral-100 px-2 py-1 font-mono text-xs text-neutral-500 dark:bg-neutral-900 dark:text-neutral-400">{{ state.syncPath || translations.settings.pathPlaceholder || 'Not set' }}</span>
          <div class="flex gap-2">
            <ui-button @click="chooseDefaultPath">{{ translations.settings.selectPath || 'Browse' }}</ui-button>
            <ui-button v-if="state.syncPath" @click="clearPath"><v-remixicon name="riDeleteBin6Line" /></ui-button>
          </div>
        </div>
      </div>

      <div v-if="cloudSync.isAuthenticated" class="border-t border-neutral-200 dark:border-neutral-700 px-4 py-3.5">
        <p class="text-sm font-medium text-neutral-800 dark:text-neutral-200">{{ translations.settings.cloudSync || 'Cloud sync' }}</p>
        <p class="mt-0.5 text-xs leading-relaxed text-neutral-500 dark:text-neutral-400">Sync through Beaver Sync (instead of a folder).</p>
        <div class="mt-3 space-y-2">
          <div v-for="opt in cloudSync.options" :key="opt.value" class="flex items-center gap-3 rounded-xl border px-3 py-2.5 cursor-pointer transition-colors" :class="[cloudSync.transport.transport.value === opt.value ? 'border-primary bg-primary/5' : 'border-neutral-200 dark:border-neutral-700 hover:border-neutral-300 dark:hover:border-neutral-600', (opt.value !== SYNC_TRANSPORT.FOLDER && !cloudSync.isPaid) || (opt.value !== SYNC_TRANSPORT.REMOTE && !state.syncPath) ? 'opacity-50 pointer-events-none' : '']" @click="cloudSync.selectTransport(opt.value)">
            <div class="shrink-0 w-8 h-8 rounded-lg flex items-center justify-center" :class="cloudSync.transport.transport.value === opt.value ? 'bg-primary text-white' : 'bg-neutral-100 dark:bg-neutral-900 text-neutral-500 dark:text-neutral-400'"><v-remixicon :name="opt.icon" size="16" /></div>
            <div class="min-w-0 flex-1">
              <p class="text-sm font-medium text-neutral-800 dark:text-neutral-200">{{ opt.title }}</p>
              <p class="text-xs text-neutral-500 dark:text-neutral-400">{{ opt.description }}</p>
            </div>
            <div v-if="cloudSync.transport.transport.value === opt.value" class="shrink-0 w-5 h-5 rounded-full bg-primary flex items-center justify-center"><v-remixicon name="riCheckLine" size="12" class="text-white" /></div>
          </div>
        </div>
      </div>

      <div v-if="syncProgressStore.attention?.tone === 'action'" class="mx-4 mb-3 px-3 py-2 rounded-lg bg-red-50 dark:bg-red-900/30 text-red-700 dark:text-red-300 text-sm flex items-center justify-between gap-2" role="alert">
        <span>{{ syncProgressStore.attention.text }}</span>
        <button class="shrink-0 opacity-70 hover:opacity-100" :aria-label="translations.app?.dismiss || 'Dismiss'" @click="syncProgressStore.dismissError()"><v-remixicon name="riCloseLine" size="16" /></button>
      </div>

      <div v-if="state.syncPath || (cloudSync.isAuthenticated && cloudSync.isPaid)" class="border-t border-neutral-200 dark:border-neutral-700 flex items-center justify-between gap-3 px-4 py-3.5">
        <p class="text-xs text-neutral-500 dark:text-neutral-400">{{ lastSyncLabel }}</p>
        <ui-button :disabled="syncState.syncing" @click="onSyncNow">
          <v-remixicon :name="syncState.syncing ? 'riLoader4Line' : 'riRefreshLine'" size="16" :class="syncState.syncing ? 'animate-spin' : ''" />
          <span class="ml-1">{{ syncState.syncing ? translations.settings?.syncing || 'Syncing...' : translations.settings?.syncNow || 'Sync now' }}</span>
        </ui-button>
      </div>
      <transition name="setting-fade">
        <div v-if="syncProgressStore.isSyncing && syncProgressStore.total > 0" class="px-4 pb-4">
          <p class="text-xs text-primary">{{ syncProgressStore.phaseMessage }}</p>
          <div class="mt-1.5 h-1.5 rounded bg-primary/70 dark:bg-primary/20"><div class="h-1.5 rounded bg-primary dark:bg-primary/80 transition-all duration-200" :style="{ width: syncProgressStore.progress + '%' }" /></div>
        </div>
      </transition>

      <div class="border-t border-neutral-200 dark:border-neutral-700 px-4 py-3.5 flex items-center justify-between gap-3">
        <div class="min-w-0">
          <p class="text-sm font-medium text-neutral-800 dark:text-neutral-200">{{ trExport.export || 'Export' }}</p>
          <p class="text-xs text-neutral-500 dark:text-neutral-400">Back up or convert all notes.</p>
        </div>
        <ui-button @click="openExportModal()">{{ trExport.export || 'Export' }}</ui-button>
      </div>
      <div class="border-t border-neutral-200 dark:border-neutral-700 px-4 py-3.5 flex items-center justify-between gap-3">
        <div class="min-w-0">
          <p class="text-sm font-medium text-neutral-800 dark:text-neutral-200">{{ trExport.import || 'Import' }}</p>
          <p class="text-xs text-neutral-500 dark:text-neutral-400">Restore a backup or bring notes from other apps.</p>
        </div>
        <ui-button @click="openImportModal('beaverBackup')">{{ trExport.import || 'Import' }}</ui-button>
      </div>

      <ui-modal v-model="showExportModal" content-class="max-w-md" :title="trExport.export || 'Export'" icon="riFileDownloadLine">
        <p class="mb-4 text-neutral-600 leading-relaxed dark:text-neutral-200">{{ trExport.exportDescriptionLong || 'Back up everything as a Beaver Notes archive, or convert all notes to Markdown or HTML.' }}</p>
        <div class="space-y-1">
          <div v-for="option in exportOptions" :key="option.key">
            <button type="button" class="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-colors" :class="selectedExportKey === option.key ? 'bg-primary/10 ring-1 ring-inset ring-primary' : 'hover:bg-neutral-100 dark:hover:bg-neutral-800'" @click="selectedExportKey = option.key">
              <span class="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg transition-colors" :class="selectedExportKey === option.key ? 'bg-primary/15 text-primary' : 'bg-neutral-100 text-neutral-500 dark:bg-neutral-800 dark:text-neutral-400'"><v-remixicon :name="option.icon" size="18" /></span>
              <span class="min-w-0 flex-1 text-sm font-medium" :class="selectedExportKey === option.key ? 'text-primary' : 'text-neutral-800 dark:text-neutral-200'">{{ option.title }}</span>
            </button>
            <div v-if="selectedExportKey === option.key" class="space-y-3 px-3 pb-2 pt-1">
              <p class="text-xs leading-relaxed text-neutral-500 dark:text-neutral-400">{{ option.description }}</p>
              <p v-if="option.key === 'backup' && backupExportState.running" class="text-xs text-neutral-500 dark:text-neutral-400">{{ trExport.creatingBackup || 'Creating backup…' }}</p>
              <div v-else-if="option.key !== 'backup' && bulkExportState(option.key).running" class="space-y-1 text-xs text-neutral-500 dark:text-neutral-400"><p v-if="bulkExportState(option.key).total">Exporting {{ bulkExportState(option.key).done }} of {{ bulkExportState(option.key).total }}…</p></div>
              <div v-else-if="option.key !== 'backup' && bulkExportState(option.key).result" class="space-y-2 border-t border-neutral-200 pt-2 text-xs text-neutral-500 dark:border-neutral-700 dark:text-neutral-400">
                <p>Exported {{ bulkExportState(option.key).result.exported }} notes<span v-if="bulkExportState(option.key).result.skipped.length">. {{ bulkExportState(option.key).result.skipped.length }} skipped.</span><span v-else>.</span></p>
              </div>
            </div>
          </div>
        </div>
        <template #actions>
          <ui-button class="w-full" :disabled="isExportRunning(selectedExportKey)" @click="showExportModal = false">{{ translations.dialog?.cancel || 'Cancel' }}</ui-button>
          <ui-button class="w-full" variant="primary" :loading="isExportRunning(selectedExportKey)" :disabled="isExportRunning(selectedExportKey)" @click="runSelectedExport(selectedExportKey)">{{ activeExportOption?.buttonLabel }}</ui-button>
        </template>
      </ui-modal>

      <ui-modal v-model="showImportModal" content-class="max-w-md" :title="trExport.import || 'Import'" icon="riFileUploadLine">
        <p class="mb-4 text-neutral-600 leading-relaxed dark:text-neutral-200">{{ trExport.importDescriptionShort || 'Restore a Beaver Notes backup, or bring notes in from other apps.' }}</p>
        <div class="max-h-[24rem] space-y-1 overflow-y-auto">
          <template v-for="group in importSourceGroups" :key="group.label">
            <p class="px-3 pb-1 pt-3 text-[11px] font-semibold uppercase tracking-wider text-neutral-400 dark:text-neutral-500">{{ group.label }}</p>
            <div v-for="source in group.items" :key="source.key">
              <button type="button" class="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-colors" :class="selectedImportSource === source.key ? 'bg-primary/10 ring-1 ring-inset ring-primary' : 'hover:bg-neutral-100 dark:hover:bg-neutral-800'" @click="selectedImportSource = source.key">
                <span class="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg transition-colors" :class="selectedImportSource === source.key ? 'bg-primary/15 text-primary' : 'bg-neutral-100 text-neutral-500 dark:bg-neutral-800 dark:text-neutral-400'"><v-remixicon :name="source.icon" size="18" /></span>
                <span class="min-w-0 flex-1 truncate text-sm font-medium" :class="selectedImportSource === source.key ? 'text-primary' : 'text-neutral-800 dark:text-neutral-200'">{{ source.title }}</span>
              </button>
              <div v-if="selectedImportSource === source.key" class="space-y-3 px-3 pb-2 pt-1">
                <p class="text-xs leading-relaxed text-neutral-500 dark:text-neutral-400">{{ source.description }}</p>
                <div v-if="source.key === 'evernote'" class="space-y-1">
                  <label class="text-xs font-medium text-neutral-700 dark:text-neutral-300">{{ trExport.notebookName || 'Notebook name' }}</label>
                  <ui-input v-model="importState.evernote.notebookName" :placeholder="trExport.notebookNamePlaceholder || 'Notebook name (optional)'" class="w-full" />
                </div>
                <p v-if="importState[source.key].running && importState[source.key].total" class="text-xs text-neutral-500 dark:text-neutral-400">Importing {{ importState[source.key].done }} of {{ importState[source.key].total }}…</p>
                <div v-else-if="importState[source.key].result" class="space-y-2 border-t border-neutral-200 pt-2 text-xs text-neutral-500 dark:border-neutral-700 dark:text-neutral-400">
                  <p>Imported {{ importState[source.key].result.imported }} notes across {{ importState[source.key].result.folders }} folders.</p>
                </div>
              </div>
            </div>
          </template>
        </div>
        <template #actions>
          <ui-button class="w-full" :disabled="activeImportState?.running" @click="showImportModal = false">{{ translations.dialog?.cancel || 'Cancel' }}</ui-button>
          <ui-button class="w-full" :variant="selectedImportSource === 'beaverBackup' ? 'danger' : 'primary'" :loading="activeImportState?.running" :disabled="activeImportState?.running" @click="runSelectedImport(selectedImportSource)">{{ activeImportSource?.buttonLabel }}</ui-button>
        </template>
      </ui-modal>
    </settings-group>

    <settings-group v-if="isDebugMode" title="Debug" danger>
      <div class="px-4 py-3.5 flex flex-col gap-3">
        <div class="space-y-0.5">
          <p class="text-sm font-medium text-red-900 dark:text-red-100">Nuke app</p>
          <p class="mt-0.5 text-xs leading-relaxed text-red-700 dark:text-red-300">Debug-only reset that wipes local state and relaunches into a fresh install.</p>
        </div>
        <ui-button class="w-full" variant="danger" @click="nukeAppDebugOnly">Nuke app and restart</ui-button>
      </div>
    </settings-group>


  </div>
</template>

<script>
import { computed, onMounted, ref, reactive } from 'vue';
import { useTranslations } from '@/composable/useTranslations';
import { useDialog } from '@/lib/dialog';
import { useNoteStore } from '@/store/note';
import { useFolderStore } from '@/store/folder';
import { useStorage } from '@/lib/storage';
import { useAccountStore } from '@/store/account';
import { useSyncProgressStore } from '@/store/sync-progress';
import { useSettingsData } from '@/composable/useSettingsData';
import { useSettingsCloudSync } from '@/utils/sync/settings-cloud-sync';
import { useImportExport } from '@/utils/import/import-export';
import { enableIndexing } from '@/lib/native/spotsearch';
import { reindexAllNotes } from '@/utils/platform/spotlightSync.js';
import { backend } from '@/lib/tauri-bridge';
import { getAccount } from '@/lib/api/account';
import { SYNC_TRANSPORT } from '@/lib/api/types';
import { clipboard } from '@/lib/tauri-bridge';
import { isMacOSRuntime } from '@/lib/tauri/runtime';
import { forceSyncNow } from '@/utils/sync';
import {
  isKeyLoaded,
  setupEncryption,
  verifyPassphrase,
  generateRecoveryCode,
} from '@/utils/crypto/encryption.js';
import SettingsGroup from '@/components/settings/SettingsGroup.vue';
import SettingsRow from '@/components/settings/SettingsRow.vue';

export default {
  components: { SettingsGroup, SettingsRow },
  setup() {
    const isDebugMode = import.meta.env.DEV;
    const { translations } = useTranslations();
    const dialog = useDialog();
    const noteStore = useNoteStore();
    const folderStore = useFolderStore();
    const storage = useStorage();
    const accountStore = useAccountStore();
    const isIOSRuntime = backend.isAppleRuntime();
    const isTouchRuntime = backend.isTouchRuntime();
    const trExport = computed(() => translations.value?.dataView || {});

    const dataSettings = useSettingsData({ dialog, folderStore, noteStore, translations });
    const syncProgressStore = useSyncProgressStore();
    const cloudSync = useSettingsCloudSync();
    const isMacOS = computed(() => isMacOSRuntime());

    const lastSyncAt = ref(Number(localStorage.getItem('sync:lastRunAt') || 0));
    const syncState = ref({ syncing: false });
    const lastSyncLabel = computed(() => {
      if (!lastSyncAt.value) return translations.value.settings?.neverSynced || 'Never synced yet';
      const secs = Math.floor((Date.now() - lastSyncAt.value) / 1000);
      if (secs < 60) return translations.value.settings?.syncedJustNow || 'Synced just now';
      if (secs < 3600) { const min = Math.floor(secs / 60); return `${translations.value.settings?.syncedMinAgo || 'Synced {n} min ago'}`.replace('{n}', String(min)); }
      return new Date(lastSyncAt.value).toLocaleString();
    });
    async function onSyncNow() {
      if (syncState.value.syncing) return;
      syncState.value = { syncing: true };
      try { await forceSyncNow(); lastSyncAt.value = Date.now(); localStorage.setItem('sync:lastRunAt', String(lastSyncAt.value)); } catch {} finally { syncState.value = { syncing: false }; }
    }

    onMounted(() => {
      if (accountStore.isAuthenticated && !accountStore.subscription) {
        getAccount({ baseUrl: accountStore.serverUrl }).then((data) => { if (data) { accountStore.setProfile(data.profile); accountStore.setSubscription(data.subscription); accountStore.setDevices(data.devices || []); } }).catch(() => {});
      }
    });

    const {
      copyImportIssues, exportAllHTMLHandler, exportAllMarkdownHandler, exportHtmlState, exportMdState,
      getImportIssuesText, importSourceGroups, importSources, importState, openImportModal, runImportSource, selectedImportSource, showImportModal,
    } = useImportExport({ clipboard, folderStore, isMacOS, noteStore, storage, translations });

    const exportOptions = [
      { key: 'backup', title: 'Beaver Notes Backup', icon: 'riArchiveLine', description: 'Full backup as a dated archive folder. Use to move devices or keep backups.', buttonLabel: 'Create Backup' },
      { key: 'markdown', title: 'Markdown', icon: 'riMarkdownLine', description: 'Export all notes as .md files with YAML frontmatter.', buttonLabel: 'Export Markdown' },
      { key: 'html', title: 'HTML', icon: 'riGlobalLine', description: 'Export all notes as .html files preserving folder structure.', buttonLabel: 'Export HTML' },
    ];
    const showExportModal = ref(false);
    const selectedExportKey = ref('backup');
    const backupExportState = reactive({ running: false });
    const activeExportOption = computed(() => exportOptions.find((o) => o.key === selectedExportKey.value) || null);
    const activeImportSource = computed(() => importSources.value.find((s) => s.key === selectedImportSource.value) || null);
    const activeImportState = computed(() => importState[selectedImportSource.value] || null);
    function bulkExportState(key) { return key === 'markdown' ? exportMdState : exportHtmlState; }
    function isExportRunning(key) { return key === 'backup' ? backupExportState.running : bulkExportState(key).running; }
    function openExportModal(key = selectedExportKey.value) { if (exportOptions.some((o) => o.key === key)) selectedExportKey.value = key; showExportModal.value = true; }
    async function runSelectedExport(key) {
      if (isExportRunning(key)) return;
      if (key === 'backup') { backupExportState.running = true; try { await dataSettings.exportData(); } finally { backupExportState.running = false; } return; }
      await (key === 'markdown' ? exportAllMarkdownHandler() : exportAllHTMLHandler());
    }
    async function runSelectedImport(key) { if (key === 'beaverBackup') { await dataSettings.importData(); return; } await runImportSource(key); }

    // Security (simplified)
    const keyLoaded = ref(isKeyLoaded());
    const encryptionBusy = ref(false);
    const encryptionProgress = ref({ phase: '', processed: 0, total: 0 });
    const encryptionError = ref('');
    const encryptionProgressPercent = computed(() => { const total = encryptionProgress.value.total || 0; if (!total) return 0; return Math.min(100, Math.floor((encryptionProgress.value.processed / total) * 100)); });
    const encryptionProgressLabel = computed(() => {
      switch (encryptionProgress.value.phase) {
        case 'decrypt': return translations.value.settings?.decryptingExistingNotes || 'Decrypting existing notes';
        case 'encrypt': return translations.value.settings?.encryptingNotes || 'Encrypting notes';
        case 'assets-encrypt': return translations.value.settings?.encryptingAssets || 'Encrypting assets';
        default: return translations.value.settings?.processingNotes || 'Processing notes';
      }
    });
    async function changeEncryptionPassphrase() {
      if (encryptionBusy.value) return;
      encryptionError.value = '';
      dialog.prompt({
        title: translations.value.settings.changePassphrase || 'Change Encryption Passphrase',
        body: translations.value.settings.changePassphraseDesc || 'Enter your current passphrase to change it. The encryption key will be re-wrapped. Your notes stay as they are.',
        icon: 'riLockLine', okText: translations.value.settings.next || 'Next', cancelText: translations.value.settings.cancel || 'Cancel',
        placeholder: translations.value.settings.currentPassphrase || 'Current passphrase', password: true,
        onConfirm: async (currentPass) => {
          if (!currentPass) return;
          try {
            const result = await verifyPassphrase(currentPass);
            if (!result.ok) { encryptionError.value = result.error || 'Incorrect passphrase.'; return; }
            dialog.prompt({
              title: translations.value.settings.enterNewPassphrase || 'Enter New Passphrase',
              body: translations.value.settings.newPassphraseDesc || 'Choose a new passphrase. This will re-wrap your encryption key.',
              icon: 'riLockLine', okText: translations.value.settings.setPassword || 'Set passphrase', cancelText: translations.value.settings.cancel || 'Cancel',
              placeholder: translations.value.settings.newPassphrase || 'New passphrase', password: true,
              onConfirm: async (newPass) => {
                if (!newPass) return;
                if (newPass.length < 8) { encryptionError.value = translations.value.settings.passwordTooShort || 'Passphrase must be at least 8 characters.'; return; }
                dialog.prompt({
                  title: translations.value.settings.confirmPassphrase || 'Confirm Passphrase', icon: 'riLockLine',
                  okText: translations.value.settings.setPassword || 'Set passphrase', cancelText: translations.value.settings.cancel || 'Cancel',
                  placeholder: translations.value.settings.confirmPassphrasePlaceholder || 'Confirm passphrase', password: true,
                  onConfirm: async (confirmPass) => {
                    if (newPass !== confirmPass) { encryptionError.value = 'Passphrases do not match.'; return; }
                    try { encryptionBusy.value = true; const setupResult = await setupEncryption(newPass); if (!setupResult.ok) { encryptionError.value = setupResult.error || 'Failed to change passphrase.'; return; } encryptionError.value = ''; dialog.alert({ title: translations.value.settings.passphraseChanged || 'Passphrase Changed', body: translations.value.settings.passphraseChangedDesc || 'Your encryption passphrase has been updated.', okText: translations.value.dialog?.close || 'Close' }); } catch (e) { encryptionError.value = String(e); } finally { encryptionBusy.value = false; }
                  },
                });
              },
            });
          } catch (e) { encryptionError.value = String(e); }
        },
      });
    }
    async function showRecoveryCode() {
      const t = translations.value;
      dialog.prompt({
        title: t.settings.confirmPassphrase || 'Confirm Passphrase', body: t.settings.recoveryCodeConfirm || 'Enter your passphrase to reveal the recovery code.', icon: 'riLockLine', okText: t.settings.next || 'Next', cancelText: t.settings.cancel || 'Cancel', password: true,
        onConfirm: async (passphrase) => {
          if (!passphrase) return;
          const result = await verifyPassphrase(passphrase);
          if (!result.ok) { dialog.alert({ title: t.settings.alertTitle || 'Alert', body: result.error || 'Incorrect passphrase.', okText: t.dialog?.close || 'Close' }); return; }
          try { const code = await generateRecoveryCode(); if (!code) { dialog.alert({ title: t.settings.alertTitle || 'Alert', body: t.settings.recoveryCodeError || 'Failed to generate recovery code.', okText: t.dialog?.close || 'Close' }); return; } dialog.alert({ title: t.settings.recoveryCode || 'Recovery Code', body: (t.settings.recoveryCodeBody || 'Store this code somewhere safe. It can unlock the app if you forget your passphrase.\n\n') + code, okText: t.dialog?.close || 'Close' }); } catch (e) { dialog.alert({ title: t.settings.alertTitle || 'Alert', body: String(e), okText: t.dialog?.close || 'Close' }); }
        },
      });
    }

    async function toggleSpotlight(value) {
      try {
        if (value) { await enableIndexing(true); reindexAllNotes(noteStore.data, true); } else { await enableIndexing(false); }
      } catch (e) { dialog.alert({ title: 'Spotlight Error', body: e?.toString?.() || 'Unknown error', okText: 'OK' }); }
    }

    return {
      translations, isDebugMode, isIOSRuntime, isTouchRuntime, ...dataSettings,
      trExport,
      syncProgressStore, cloudSync, SYNC_TRANSPORT, exportOptions, showExportModal, selectedExportKey, backupExportState, bulkExportState, isExportRunning, openExportModal, runSelectedExport, runSelectedImport, activeExportOption, activeImportSource, activeImportState, importSourceGroups, getImportIssuesText, copyImportIssues, importState, openImportModal, selectedImportSource, showImportModal, lastSyncAt, syncState, lastSyncLabel, onSyncNow,
      keyLoaded, encryptionBusy, encryptionProgress, encryptionError, encryptionProgressPercent, encryptionProgressLabel, changeEncryptionPassphrase, showRecoveryCode,
      toggleSpotlight,
    };
  },
};
</script>
<style scoped>
.app-encryption-progress-bar { width: 100%; transform-origin: left; transition: transform 200ms var(--ease-standard); }
.setting-fade-enter-active, .setting-fade-leave-active { transition: opacity 180ms ease, transform 180ms ease; }
.setting-fade-enter-from, .setting-fade-leave-to { opacity: 0; transform: translateY(4px); }
</style>
