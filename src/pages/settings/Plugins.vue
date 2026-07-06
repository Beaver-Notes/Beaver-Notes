<template>
  <div class="mb-14 w-full max-w-xl space-y-6">
    <div class="flex items-center justify-between">
      <h2 class="text-lg font-semibold">
        {{ translations.plugins?.title || 'Plugins' }}
      </h2>
      <ui-button variant="primary" @click="handleInstall">
        <v-remixicon name="riAddLine" class="ltr:mr-1 rtl:ml-1" />
        {{ translations.plugins?.installFromFile || 'Install from file' }}
      </ui-button>
    </div>

    <div class="flex gap-1 bg-neutral-100 dark:bg-neutral-800 rounded-lg p-1">
      <button
        class="flex-1 px-4 py-2 rounded-md text-sm font-medium transition-colors"
        :class="
          tab === 'installed'
            ? 'bg-white dark:bg-neutral-700 shadow-sm'
            : 'text-neutral-500 hover:text-neutral-700 dark:hover:text-neutral-300'
        "
        @click="tab = 'installed'"
      >
        {{ translations.plugins?.installed || 'Installed' }}
      </button>
      <button
        class="flex-1 px-4 py-2 rounded-md text-sm font-medium transition-colors"
        :class="
          tab === 'browse'
            ? 'bg-white dark:bg-neutral-700 shadow-sm'
            : 'text-neutral-500 hover:text-neutral-700 dark:hover:text-neutral-300'
        "
        @click="
          tab = 'browse';
          fetchCommunity();
        "
      >
        {{ translations.plugins?.browse || 'Browse' }}
      </button>
    </div>

    <template v-if="tab === 'installed'">
      <p v-if="store.loading" class="text-sm text-neutral-500">
        <ui-spinner size="16" class="mr-2" />
        {{ translations.plugins?.loading || 'Loading plugins...' }}
      </p>

      <div
        v-else-if="store.error"
        class="p-4 bg-red-50 dark:bg-red-900/20 rounded-lg border border-red-200 dark:border-red-800"
      >
        <p class="text-red-600 dark:text-red-400 text-sm">{{ store.error }}</p>
      </div>

      <div
        v-else-if="store.installedPlugins.length === 0"
        class="py-12 text-center"
      >
        <v-remixicon
          name="riPuzzle2Line"
          size="48"
          class="text-neutral-300 dark:text-neutral-600 mb-4"
        />
        <p class="text-neutral-500 dark:text-neutral-400">
          {{ translations.plugins?.empty || 'No plugins installed yet.' }}
        </p>
      </div>

      <div v-else class="space-y-2">
        <div
          v-for="plugin in store.installedPlugins"
          :key="plugin.id"
          class="flex items-center justify-between p-4 bg-white dark:bg-neutral-800 rounded-xl border"
        >
          <div class="flex items-center gap-3 min-w-0 flex-1">
            <div
              class="flex-shrink-0 w-10 h-10 rounded-lg bg-neutral-100 dark:bg-neutral-700 flex items-center justify-center"
            >
              <v-remixicon
                :name="plugin.manifest.icon || 'riPuzzle2Line'"
                size="20"
                class="text-neutral-600 dark:text-neutral-300"
              />
            </div>
            <div class="min-w-0">
              <div class="flex items-center gap-2">
                <router-link
                  :to="`/settings/plugins/${plugin.id}`"
                  class="font-medium hover:text-primary transition-colors truncate"
                >
                  {{ plugin.manifest.name }}
                </router-link>
                <span
                  class="text-xs text-neutral-500 dark:text-neutral-400 shrink-0"
                  >v{{ plugin.manifest.version }}</span
                >
              </div>
              <p
                class="text-xs text-neutral-500 dark:text-neutral-400 truncate"
              >
                {{ plugin.manifest.author || '' }}
                <span v-if="plugin.manifest.description" class="ml-1"
                  >— {{ plugin.manifest.description }}</span
                >
              </p>
              <div
                v-if="plugin.state === 'error'"
                class="mt-1 text-xs text-red-500 truncate"
              >
                {{ plugin.error || 'Error loading plugin' }}
              </div>
            </div>
          </div>
          <div class="flex items-center gap-2 shrink-0 ml-3">
            <ui-switch
              :id="`toggle-${plugin.id}`"
              :model-value="plugin.state === 'active'"
              @change="(val) => handleToggle(plugin.id, val)"
            />
            <ui-button
              variant="default"
              :loading="uninstalling === plugin.id"
              @click="handleUninstall(plugin.id)"
            >
              <v-remixicon name="riDeleteBin6Line" size="18" />
            </ui-button>
          </div>
        </div>
      </div>
    </template>

    <template v-if="tab === 'browse'">
      <p v-if="browsing" class="text-sm text-neutral-500">
        <ui-spinner size="16" class="mr-2" />
        {{ translations.plugins?.fetching || 'Fetching community plugins...' }}
      </p>

      <div
        v-else-if="browseError"
        class="p-4 bg-red-50 dark:bg-red-900/20 rounded-lg border border-red-200 dark:border-red-800"
      >
        <p class="text-red-600 dark:text-red-400 text-sm">{{ browseError }}</p>
      </div>

      <div v-else-if="browsePlugins.length === 0" class="py-12 text-center">
        <v-remixicon
          name="riStoreLine"
          size="48"
          class="text-neutral-300 dark:text-neutral-600 mb-4"
        />
        <p class="text-neutral-500 dark:text-neutral-400">
          {{
            translations.plugins?.noCommunityPlugins ||
            'No community plugins available yet.'
          }}
        </p>
      </div>

      <div v-else class="space-y-2">
        <div
          v-for="p in browsePlugins"
          :key="p.id"
          class="flex items-center justify-between p-4 bg-white dark:bg-neutral-800 rounded-xl border"
        >
          <div class="flex items-center gap-3 min-w-0 flex-1">
            <div
              class="flex-shrink-0 w-10 h-10 rounded-lg bg-neutral-100 dark:bg-neutral-700 flex items-center justify-center"
            >
              <v-remixicon
                name="riPuzzle2Line"
                size="20"
                class="text-neutral-600 dark:text-neutral-300"
              />
            </div>
            <div class="min-w-0">
              <p class="font-medium truncate">{{ p.name }}</p>
              <p
                class="text-xs text-neutral-500 dark:text-neutral-400 truncate"
              >
                {{ p.author }} — {{ p.description }}
              </p>
            </div>
          </div>
          <div class="shrink-0 ml-3">
            <ui-button
              variant="primary"
              :loading="installingFromStore === p.id"
              :disabled="store.installedPlugins.some((ip) => ip.id === p.id)"
              @click="handleInstallFromRegistry(p)"
            >
              {{
                store.installedPlugins.some((ip) => ip.id === p.id)
                  ? 'Installed'
                  : 'Install'
              }}
            </ui-button>
          </div>
        </div>
      </div>
    </template>

    <template v-if="consentPreview">
      <div
        class="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
        @click.self="cancelConsent"
      >
        <div
          class="bg-white dark:bg-neutral-800 rounded-2xl shadow-xl max-w-md w-full mx-4 p-6 space-y-4"
        >
          <div class="flex items-center gap-3">
            <v-remixicon
              :name="consentPreview.manifest.icon || 'riPuzzle2Line'"
              size="32"
              class="text-neutral-600 dark:text-neutral-300"
            />
            <div>
              <h3 class="font-semibold text-lg">
                {{ consentPreview.manifest.name }}
              </h3>
              <p class="text-sm text-neutral-500">
                v{{ consentPreview.manifest.version }}
              </p>
            </div>
          </div>

          <p
            v-if="consentPreview.manifest.description"
            class="text-sm text-neutral-600 dark:text-neutral-400"
          >
            {{ consentPreview.manifest.description }}
          </p>

          <div
            v-if="
              consentPreview.isUpdate &&
              consentPreview.newPermissions.length > 0
            "
            class="p-3 bg-yellow-50 dark:bg-yellow-900/20 rounded-lg border border-yellow-200 dark:border-yellow-800"
          >
            <p class="text-sm font-medium text-yellow-700 dark:text-yellow-400">
              {{
                translations.plugins?.updateNewPerms ||
                'This update requests new permissions:'
              }}
            </p>
            <ul
              class="mt-1 text-xs text-yellow-600 dark:text-yellow-500 space-y-1"
            >
              <li v-for="perm in consentPreview.newPermissions" :key="perm">
                • {{ perm }} — {{ permissionLabel(perm) }}
              </li>
            </ul>
          </div>

          <div v-if="consentPreview.declaredPermissions.length > 0">
            <p class="text-sm font-medium mb-2">
              {{
                translations.plugins?.permissionTitle ||
                'This plugin requests the following permissions:'
              }}
            </p>
            <div class="space-y-2 max-h-48 overflow-y-auto">
              <div
                v-for="perm in consentPreview.declaredPermissions"
                :key="perm"
                class="flex items-center justify-between py-1"
              >
                <div class="flex-1">
                  <span class="text-sm font-medium">{{ perm }}</span>
                  <span class="block text-xs text-neutral-500">{{
                    permissionLabel(perm)
                  }}</span>
                </div>
                <ui-switch
                  :id="`consent-${perm}`"
                  :model-value="consentGrants.includes(perm)"
                  @change="() => toggleConsentPerm(perm)"
                />
              </div>
            </div>
          </div>

          <p
            v-if="consentPreview.isUpdate && consentPreview.existingActive"
            class="text-xs text-neutral-500"
          >
            {{
              translations.plugins?.willReactivate ||
              'The plugin will be reactivated after update.'
            }}
          </p>

          <div class="flex gap-3 justify-end pt-2">
            <ui-button variant="default" @click="cancelConsent">
              {{ translations.plugins?.cancel || 'Cancel' }}
            </ui-button>
            <ui-button
              variant="primary"
              :loading="consenting"
              @click="commitConsent"
            >
              {{
                consentPreview.isUpdate
                  ? translations.plugins?.update || 'Update'
                  : translations.plugins?.install || 'Install'
              }}
            </ui-button>
          </div>
        </div>
      </div>
    </template>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue';
import { usePluginStore } from '@/store/plugins';
import { useTranslations } from '@/composable/useTranslations';
import { openDialog } from '@/lib/native/dialog';
import { backend } from '@/lib/tauri-bridge';
import { fetch as platformFetch } from '@tauri-apps/plugin-http';

const store = usePluginStore();
const { translations } = useTranslations();
const uninstalling = ref(null);
const tab = ref('installed');
const browsing = ref(false);
const browseError = ref(null);
const browsePlugins = ref([]);
const installingFromStore = ref(null);

const consentPreview = ref(null);
const consentGrants = ref([]);
const consenting = ref(false);
const pendingArrayBuffer = ref(null);

function permissionLabel(perm) {
  const labels = {
    'notes:read':
      translations.value.plugins?.permNotesRead ||
      'Read notes, folders, and labels',
    'notes:write':
      translations.value.plugins?.permNotesWrite ||
      'Create, update, and delete notes, folders, and labels',
    filesystem:
      translations.value.plugins?.permFilesystem ||
      'Read and write files on disk',
    network: translations.value.plugins?.permNetwork || 'Make network requests',
    'app:settings':
      translations.value.plugins?.permAppSettings ||
      'Read and modify app settings',
  };
  return labels[perm] || perm;
}

function toggleConsentPerm(perm) {
  const idx = consentGrants.value.indexOf(perm);
  if (idx === -1) {
    consentGrants.value = [...consentGrants.value, perm];
  } else {
    consentGrants.value = consentGrants.value.filter((p) => p !== perm);
  }
}

function cancelConsent() {
  consentPreview.value = null;
  consentGrants.value = [];
  pendingArrayBuffer.value = null;
}

async function commitConsent() {
  if (!pendingArrayBuffer.value || !consentPreview.value) return;
  consenting.value = true;
  try {
    await store.installFromBeax(
      pendingArrayBuffer.value,
      consentPreview.value.isUpdate,
      consentGrants.value.length > 0 ? consentGrants.value : null
    );
    cancelConsent();
  } catch (e) {
    console.error('Failed to install plugin:', e);
    cancelConsent();
  } finally {
    consenting.value = false;
  }
}

async function showConsentForBuffer(arrayBuffer, isUpdate, existingActive) {
  try {
    const preview = await store.previewFromBeax(arrayBuffer);
    preview.isUpdate = preview.isUpdate || isUpdate;
    preview.existingActive = existingActive;
    consentPreview.value = preview;
    consentGrants.value = [...(preview.declaredPermissions || [])];
    pendingArrayBuffer.value = arrayBuffer;
  } catch (e) {
    console.error('Failed to preview plugin:', e);
  }
}

async function fetchCommunity() {
  if (browsePlugins.value.length > 0) return;
  browsing.value = true;
  browseError.value = null;
  try {
    browsePlugins.value = await store.fetchFromRegistry();
  } catch (e) {
    browseError.value = e.message || 'Failed to fetch plugins';
  } finally {
    browsing.value = false;
  }
}

async function downloadFromGitHub(repo) {
  const apiUrl = `https://api.github.com/repos/${repo}/releases/latest`;
  const res = await platformFetch(apiUrl);
  if (!res.ok) {
    const beaxUrl = `https://github.com/${repo}/releases/latest/download/plugin.beax`;
    const beaxRes = await platformFetch(beaxUrl);
    if (!beaxRes.ok) throw new Error(`Failed to download .beax from ${repo}`);
    return await beaxRes.arrayBuffer();
  }
  const release = await res.json();
  const asset = release.assets.find((a) => a.name.endsWith('.beax'));
  if (!asset) {
    const beaxUrl = `https://github.com/${repo}/releases/latest/download/plugin.beax`;
    const beaxRes = await platformFetch(beaxUrl);
    if (!beaxRes.ok) throw new Error(`No .beax asset found in ${repo}`);
    return await beaxRes.arrayBuffer();
  }
  const beaxRes = await platformFetch(asset.browser_download_url);
  return await beaxRes.arrayBuffer();
}

async function handleInstallFromRegistry(p) {
  installingFromStore.value = p.id;
  try {
    const buffer = await downloadFromGitHub(p.repo);
    await showConsentForBuffer(buffer, false, false);
  } catch (e) {
    console.error('Failed to install from registry:', e);
  } finally {
    installingFromStore.value = null;
  }
}

async function handleInstall() {
  try {
    const { canceled, filePaths = [] } = await openDialog({
      title:
        translations.value.plugins?.selectBeax || 'Select .beax plugin file',
      filters: [{ name: 'Beaver Notes Plugin', extensions: ['beax'] }],
      properties: ['openFile'],
    });
    if (canceled || filePaths.length === 0) return;

    const path = filePaths[0];
    const b64Data = await backend.invoke('fs:readData', path);
    const binary = atob(b64Data);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);

    await showConsentForBuffer(bytes.buffer, false, false);
  } catch (e) {
    console.error('Failed to install plugin:', e);
  }
}

async function handleToggle(pluginId, enable) {
  try {
    if (enable) await store.activatePlugin(pluginId);
    else await store.deactivatePlugin(pluginId);
  } catch (e) {
    console.error('Failed to toggle plugin:', e);
  }
}

async function handleUninstall(pluginId) {
  uninstalling.value = pluginId;
  try {
    await store.uninstallPlugin(pluginId);
  } catch (e) {
    console.error('Failed to uninstall plugin:', e);
  } finally {
    uninstalling.value = null;
  }
}
</script>
