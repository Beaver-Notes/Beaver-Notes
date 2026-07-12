<template>
  <div class="workspace-switcher workspace-feature-gated">
    <div v-if="expanded" class="px-3 mb-3">
      <ui-popover placement="bottom-start">
        <template #trigger>
          <div
            ref="triggerEl"
            class="flex items-center gap-2 px-3 py-2 rounded-lg bg-neutral-100 dark:bg-neutral-800 cursor-pointer hover:bg-neutral-200 dark:hover:bg-neutral-700 transition-colors"
          >
            <v-remixicon name="riFolderLine" size="16" class="shrink-0 text-neutral-400" />
            <span class="text-sm font-medium truncate flex-1 text-neutral-700 dark:text-neutral-300">
              {{ activeName }}
            </span>
            <v-remixicon name="riArrowDownSLine" size="16" class="shrink-0 text-neutral-400" />
          </div>
        </template>

        <div :style="{ minWidth: triggerWidth + 'px' }">
          <button
            v-for="ws in workspaces"
            :key="ws.id"
            class="flex w-full items-center gap-2 rounded-lg p-1.5 text-left hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors text-sm"
            :class="ws.id === activeId ? 'text-primary font-medium' : 'text-neutral-600 dark:text-neutral-400'"
            @click="switchWorkspace(ws.id)"
          >
            <v-remixicon name="riFolderLine" size="14" class="shrink-0" />
            <span class="truncate">{{ ws.name }}</span>
            <v-remixicon
              v-if="ws.id === activeId"
              name="riCheckLine"
              size="14"
              class="shrink-0 ml-auto text-primary"
            />
          </button>
          <div class="border-t border-neutral-200 dark:border-neutral-700 my-1" />
          <button
            class="flex w-full items-center gap-2 rounded-lg p-1.5 text-left text-neutral-500 dark:text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors text-sm"
            @click="promptCreate"
          >
            <v-remixicon name="riAddLine" size="14" class="shrink-0" />
            <span>New Workspace</span>
          </button>
        </div>
      </ui-popover>
    </div>

    <div v-else class="px-1 mb-3">
      <ui-popover placement="right-start">
        <template #trigger>
          <button
            v-tooltip:right="'Workspaces'"
            class="w-9 h-9 flex items-center justify-center rounded-lg hover:bg-neutral-200/50 dark:hover:bg-neutral-700/50 text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200 transition-colors"
          >
            <v-remixicon name="riFolderLine" size="20" />
          </button>
        </template>

        <div style="min-width: 200px">
          <button
            v-for="ws in workspaces"
            :key="ws.id"
            class="flex w-full items-center gap-2 rounded-lg p-1.5 text-left hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors text-sm"
            :class="ws.id === activeId ? 'text-primary font-medium' : 'text-neutral-600 dark:text-neutral-400'"
            @click="switchWorkspace(ws.id)"
          >
            <v-remixicon name="riFolderLine" size="14" class="shrink-0" />
            <span class="truncate">{{ ws.name }}</span>
            <v-remixicon
              v-if="ws.id === activeId"
              name="riCheckLine"
              size="14"
              class="shrink-0 ml-auto text-primary"
            />
          </button>
          <div class="border-t border-neutral-200 dark:border-neutral-700 my-1" />
          <button
            class="flex w-full items-center gap-2 rounded-lg p-1.5 text-left text-neutral-500 dark:text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors text-sm"
            @click="promptCreate"
          >
            <v-remixicon name="riAddLine" size="14" class="shrink-0" />
            <span>New Workspace</span>
          </button>
        </div>
      </ui-popover>
    </div>
  </div>
</template>

<script>
import { ref, computed, onMounted, nextTick } from 'vue';
import emitter from 'tiny-emitter/instance';
import { useWorkspaceStore } from '@/store/workspace';

function clearSettingsLocalStorage() {
  const keys = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k) keys.push(k);
  }
  const settingsKeys = [
    'theme', 'selectedLanguage', 'directionPreference', 'color-scheme',
    'zoomLevel', 'selected-font', 'selected-font-code', 'selected-dark-text',
    'visibility-menubar', 'spellcheckEnabled', 'reducedMotion', 'highContrast',
    'advanced-settings', 'autoSync', 'todayDateFormat', 'timeFormat',
    'collapsibleHeading', 'openLastEdited', 'openAfterCreation', 'soundsEnabled',
    'spotlightEnabled', 'toolbarConfig', 'onboardingCompleted',
  ];
  settingsKeys.forEach((k) => localStorage.removeItem(k));
}

export default {
  props: {
    expanded: { type: Boolean, default: false },
  },
  setup() {
    const workspaceStore = useWorkspaceStore();
    const triggerEl = ref(null);
    const triggerWidth = ref(232);

    const workspaces = computed(() => workspaceStore.workspaces);
    const activeId = computed(() => workspaceStore.activeId);
    const activeName = computed(
      () => workspaceStore.activeWorkspace?.name ?? 'Default'
    );

    onMounted(async () => {
      await workspaceStore.retrieve();
      await nextTick();
      if (triggerEl.value) {
        triggerWidth.value = triggerEl.value.offsetWidth;
      }
    });

    async function switchWorkspace(id) {
      await workspaceStore.switchTo(id);
      clearSettingsLocalStorage();
      window.location.reload();
    }

    function promptCreate() {
      emitter.emit('show-dialog', 'prompt', {
        title: 'New Workspace',
        placeholder: 'Workspace name',
        okText: 'Create',
        password: false,
        async onConfirm(name) {
          if (!name || !name.trim()) return;
          const ws = await workspaceStore.create(name.trim(), { copySettings: true });
          await workspaceStore.switchTo(ws.id);
          clearSettingsLocalStorage();
          window.location.reload();
        },
      });
    }

    return {
      triggerEl,
      triggerWidth,
      workspaces,
      activeId,
      activeName,
      switchWorkspace,
      promptCreate,
    };
  },
};
</script>
