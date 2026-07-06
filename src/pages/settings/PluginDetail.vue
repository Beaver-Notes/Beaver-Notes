<template>
  <div class="space-y-6">
    <router-link
      :to="'/settings/plugins'"
      class="inline-flex items-center text-sm text-neutral-500 hover:text-primary transition-colors"
    >
      <v-remixicon name="riArrowLeftLine" size="16" class="ltr:mr-1 rtl:ml-1" />
      {{ translations.plugins?.backToList || 'Back to plugins' }}
    </router-link>

    <div v-if="!plugin" class="py-8 text-center text-neutral-500">
      {{ translations.plugins?.notFound || 'Plugin not found' }}
    </div>

    <template v-else>
      <div class="flex items-start gap-4">
        <div
          class="flex-shrink-0 w-14 h-14 rounded-xl bg-neutral-100 dark:bg-neutral-700 flex items-center justify-center"
        >
          <v-remixicon
            :name="plugin.manifest.icon || 'riPuzzle2Line'"
            size="28"
            class="text-neutral-600 dark:text-neutral-300"
          />
        </div>
        <div class="flex-1 min-w-0">
          <h2 class="text-xl font-semibold">{{ plugin.manifest.name }}</h2>
          <p class="text-sm text-neutral-500 dark:text-neutral-400">
            v{{ plugin.manifest.version }}
            <span v-if="plugin.manifest.author">
              by {{ plugin.manifest.author }}</span
            >
          </p>
          <p
            v-if="plugin.manifest.description"
            class="text-sm text-neutral-600 dark:text-neutral-300 mt-1"
          >
            {{ plugin.manifest.description }}
          </p>
        </div>
        <div class="flex items-center gap-3 shrink-0">
          <ui-switch
            :id="`plugin-toggle-${plugin.id}`"
            :model-value="plugin.state === 'active'"
            @change="(val) => handleToggle(val)"
          />
          <ui-button
            variant="danger"
            :loading="uninstalling"
            @click="handleUninstall"
          >
            {{ translations.plugins?.uninstall || 'Uninstall' }}
          </ui-button>
        </div>
      </div>

      <div
        v-if="plugin.state === 'error'"
        class="p-4 bg-red-50 dark:bg-red-900/20 rounded-lg border border-red-200 dark:border-red-800"
      >
        <p class="text-red-600 dark:text-red-400 text-sm">
          {{ plugin.error || 'Error loading plugin' }}
        </p>
      </div>

      <ui-card padding="p-4">
        <h3 class="font-medium mb-3">
          {{ translations.plugins?.permissions || 'Permissions' }}
        </h3>
        <div v-if="declaredPermissions.length > 0" class="space-y-3">
          <div
            v-for="perm in declaredPermissions"
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
              :id="`grant-${pluginId}-${perm}`"
              :model-value="grantedPermissions.includes(perm)"
              @change="() => togglePermission(perm)"
            />
          </div>
        </div>
        <p v-else class="text-sm text-neutral-500">
          {{
            translations.plugins?.noPermissions || 'No permissions requested'
          }}
        </p>
        <div
          v-if="declaredPermissions.length > 0"
          class="mt-3 pt-3 border-t border-neutral-200 dark:border-neutral-700"
        >
          <p class="text-xs text-neutral-400 dark:text-neutral-500">
            {{
              translations.plugins?.permEnforcedNote ||
              "Toggling a permission off will block API calls that require it. It does not restrict the plugin's general JavaScript execution."
            }}
          </p>
        </div>
      </ui-card>

      <ui-card
        v-if="plugin.manifest.planes && plugin.manifest.planes.length > 0"
        padding="p-4"
      >
        <h3 class="font-medium mb-3">
          {{ translations.plugins?.planes || 'Planes' }}
        </h3>
        <div class="space-y-2">
          <div
            v-for="plane in plugin.manifest.planes"
            :key="plane"
            class="flex items-start gap-2"
          >
            <span
              class="px-2 py-1 text-xs rounded-md bg-primary/10 text-primary shrink-0"
              >{{ plane }}</span
            >
            <span class="text-xs text-neutral-500 leading-relaxed">{{
              planeDescription(plane)
            }}</span>
          </div>
        </div>
      </ui-card>

      <ui-card v-if="manifestSettings" padding="p-4">
        <h3 class="font-medium mb-4">
          {{ translations.plugins?.pluginSettings || 'Plugin Settings' }}
        </h3>
        <SettingsForm :schema="manifestSettings" :plugin-id="plugin.id" />
      </ui-card>

      <ui-card v-else-if="settingsFn" padding="p-4">
        <h3 class="font-medium mb-4">
          {{ translations.plugins?.pluginSettings || 'Plugin Settings' }}
        </h3>
        <div ref="settingsRoot" class="plugin-settings-root"></div>
      </ui-card>

      <ui-card v-else padding="p-4">
        <h3 class="font-medium mb-3">
          {{ translations.plugins?.pluginSettings || 'Plugin Settings' }}
        </h3>
        <p class="text-sm text-neutral-500">
          {{
            translations.plugins?.noSettings ||
            'This plugin has no configurable settings.'
          }}
        </p>
      </ui-card>
    </template>
  </div>
</template>

<script setup>
import { ref, computed, watch, onMounted, nextTick } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { usePluginStore } from '@/store/plugins';
import { useTranslations } from '@/composable/useTranslations';
import { createPluginAPI } from '@/plugins/PluginAPI';
import { createPluginStorage } from '@/plugins/PluginStorage';
import SettingsForm from '@/components/plugins/SettingsForm.vue';

const route = useRoute();
const router = useRouter();
const store = usePluginStore();
const { translations } = useTranslations();
const uninstalling = ref(false);
const settingsRoot = ref(null);
const settingsFn = ref(null);

const pluginId = computed(() => route.params.pluginId);
const plugin = computed(() =>
  store.installedPlugins.find((p) => p.id === pluginId.value)
);
const manifestSettings = computed(
  () => plugin.value?.manifest?.settings || null
);

const declaredPermissions = computed(() => {
  const p = plugin.value;
  if (!p) return [];
  return store.getDeclaredPermissions(p.id);
});

const grantedPermissions = computed(() => {
  const p = plugin.value;
  if (!p) return [];
  return store.getPluginGrants(p.id);
});

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

function planeDescription(plane) {
  const descs = {
    app:
      translations.value.plugins?.planeAppDesc ||
      'Access to note data, folders, labels, app settings, network requests, and app events.',
    editor:
      translations.value.plugins?.planeEditorDesc ||
      'Full access to the editor context, including TipTap extensions, toolbar items, and slash commands. Editor plugins have broad JavaScript access.',
  };
  return descs[plane] || '';
}

async function togglePermission(perm) {
  const current = [...grantedPermissions.value];
  const idx = current.indexOf(perm);
  if (idx === -1) {
    current.push(perm);
  } else {
    current.splice(idx, 1);
  }
  await store.setPluginGrants(pluginId.value, current);
}

async function handleToggle(enable) {
  try {
    if (enable) {
      await store.activatePlugin(pluginId.value);
    } else {
      await store.deactivatePlugin(pluginId.value);
    }
  } catch (e) {
    console.error('Failed to toggle plugin:', e);
  }
}

async function handleUninstall() {
  uninstalling.value = true;
  try {
    await store.uninstallPlugin(pluginId.value);
    router.push('/settings/plugins');
  } catch (e) {
    console.error('Failed to uninstall plugin:', e);
  } finally {
    uninstalling.value = false;
  }
}

async function loadSettingsComponent() {
  const p = plugin.value;
  if (!p) return;

  const settingsFnResult = await store.getPluginSettings(pluginId.value);
  if (settingsFnResult) {
    settingsFn.value = settingsFnResult;
    await nextTick();
    mountSettingsComponent();
  }
}

function mountSettingsComponent() {
  if (!settingsRoot.value || !settingsFn.value) return;

  const root = settingsRoot.value;
  root.innerHTML = '';

  const storage = createPluginStorage(pluginId.value);
  const pluginData = plugin.value;
  const api = createPluginAPI(pluginId.value, pluginData.manifest);

  settingsFn.value({
    root,
    ui: api.ui.components,
    storage: {
      get: (k, d) => storage.get(k, d),
      set: (k, v) => storage.set(k, v),
    },
    pluginId: pluginId.value,
  });
}

watch(plugin, (newPlugin) => {
  if (newPlugin && !manifestSettings.value) {
    loadSettingsComponent();
  }
});

onMounted(() => {
  if (plugin.value && !manifestSettings.value) {
    loadSettingsComponent();
  }
});
</script>
