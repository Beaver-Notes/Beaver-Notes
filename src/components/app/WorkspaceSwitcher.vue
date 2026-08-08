<template>
  <div v-if="isAuthenticated">
    <ui-popover :placement="expanded ? 'bottom-start' : 'right-start'">
      <template #trigger>
        <!-- Expanded: full-width pill trigger -->
        <div
          v-if="expanded"
          ref="triggerEl"
          class="transition-colors duration-150 rounded-lg flex items-center h-10 w-full px-2 gap-2 cursor-pointer text-neutral-500 dark:text-neutral-400 hover:bg-neutral-200/50 dark:hover:bg-neutral-700/50 hover:text-neutral-900 dark:hover:text-neutral-100"
        >
          <span
            class="shrink-0 w-6 h-6 rounded-md flex items-center justify-center text-sm leading-none bg-primary/10 text-primary"
          >
            <span v-if="activeEmoji">{{ activeEmoji }}</span>
            <v-remixicon v-else name="riFolderLine" size="14" />
          </span>
          <span
            class="text-sm font-medium truncate flex-1 min-w-0 text-neutral-700 dark:text-neutral-300"
          >
            {{ activeName }}
          </span>
          <span
            v-if="activeRole && activeRole !== 'owner'"
            class="shrink-0 text-[10px] leading-none px-1.5 py-1 rounded-full bg-neutral-200 dark:bg-neutral-700 text-neutral-500 dark:text-neutral-400 uppercase font-medium"
          >
            {{ activeRole }}
          </span>
          <v-remixicon
            name="riExpandUpDownLine"
            size="14"
            class="shrink-0 text-neutral-400"
          />
        </div>

        <!-- Collapsed: compact avatar trigger -->
        <button
          v-else
          v-tooltip:right="'Workspaces'"
          aria-label="Workspaces"
          class="w-9 h-9 flex items-center justify-center rounded-lg hover:bg-neutral-200/50 dark:hover:bg-neutral-700/50 text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200 transition-colors"
        >
          <span
            class="w-6 h-6 rounded-md flex items-center justify-center text-sm leading-none bg-primary/10 text-primary"
          >
            <span v-if="activeEmoji">{{ activeEmoji }}</span>
            <v-remixicon v-else name="riFolderLine" size="14" />
          </span>
        </button>
      </template>

      <div class="min-w-[220px] py-1">
        <div
          class="px-2.5 pb-1.5 text-[11px] font-semibold uppercase tracking-widest text-neutral-400 dark:text-neutral-500 select-none"
        >
          Workspaces
        </div>

        <button
          v-for="ws in workspaces"
          :key="ws.id"
          class="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors text-sm"
          @click="switchWorkspace(ws.id)"
        >
          <span
            class="shrink-0 w-6 h-6 rounded-md flex items-center justify-center text-sm leading-none"
            :class="
              ws.id === activeId
                ? 'bg-primary/10 text-primary'
                : 'bg-neutral-100 dark:bg-neutral-800 text-neutral-400'
            "
          >
            <span v-if="ws.emoji">{{ ws.emoji }}</span>
            <v-remixicon v-else name="riFolderLine" size="14" />
          </span>

          <span
            class="truncate flex-1 min-w-0"
            :class="
              ws.id === activeId
                ? 'text-primary font-medium'
                : 'text-neutral-700 dark:text-neutral-300'
            "
          >
            {{ ws.name }}
          </span>

          <span
            v-if="ws.role && ws.role !== 'owner'"
            class="shrink-0 text-[10px] leading-none px-1.5 py-1 rounded-full bg-neutral-200 dark:bg-neutral-700 text-neutral-500 dark:text-neutral-400 uppercase font-medium"
          >
            {{ ws.role }}
          </span>

          <v-remixicon
            v-if="ws.id === activeId"
            name="riCheckLine"
            size="14"
            class="shrink-0 text-primary"
          />
        </button>

        <div
          v-if="isPaid"
          class="border-t border-neutral-200 dark:border-neutral-700 my-1"
        />

        <button
          v-if="isPaid"
          class="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left text-neutral-500 dark:text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors text-sm"
          @click="promptCreate"
        >
          <span
            class="shrink-0 w-6 h-6 rounded-md flex items-center justify-center bg-neutral-100 dark:bg-neutral-800"
          >
            <v-remixicon name="riAddLine" size="14" />
          </span>
          <span>New Workspace</span>
        </button>

        <button
          v-if="isPaid"
          class="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left text-neutral-500 dark:text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors text-sm"
          @click="promptJoin"
        >
          <span
            class="shrink-0 w-6 h-6 rounded-md flex items-center justify-center bg-neutral-100 dark:bg-neutral-800"
          >
            <v-remixicon name="riLoginBoxLine" size="14" />
          </span>
          <span>Join Workspace</span>
        </button>
      </div>
    </ui-popover>
  </div>
</template>

<script>
import { ref, computed, onMounted, nextTick } from 'vue';
import emitter from 'tiny-emitter/instance';
import { useWorkspaceStore } from '@/store/workspace';
import { useAccountStore } from '@/store/account';

function clearSettingsLocalStorage() {
  const settingsKeys = [
    'theme',
    'selectedLanguage',
    'directionPreference',
    'color-scheme',
    'zoomLevel',
    'selected-font',
    'selected-font-code',
    'selected-dark-text',
    'visibility-menubar',
    'spellcheckEnabled',
    'reducedMotion',
    'highContrast',
    'advanced-settings',
    'todayDateFormat',
    'timeFormat',
    'collapsibleHeading',
    'openLastEdited',
    'openAfterCreation',
    'soundsEnabled',
    'spotlightEnabled',
    'toolbarConfig',
    'onboardingCompleted',
  ];
  settingsKeys.forEach((k) => localStorage.removeItem(k));
}

export default {
  props: {
    expanded: { type: Boolean, default: false },
  },
  setup() {
    const workspaceStore = useWorkspaceStore();
    const accountStore = useAccountStore();
    const triggerEl = ref(null);

    const workspaces = computed(() => workspaceStore.workspaces);
    const activeId = computed(() => workspaceStore.activeId);
    const activeName = computed(
      () => workspaceStore.activeWorkspace?.name ?? 'Default',
    );
    const activeEmoji = computed(
      () => workspaceStore.activeWorkspace?.emoji ?? '',
    );
    const activeRole = computed(
      () => workspaceStore.activeWorkspace?.role ?? null,
    );
    const isAuthenticated = computed(() => accountStore.isAuthenticated);
    const isPaid = computed(() => accountStore.isPaidPlan);

    onMounted(async () => {
      await workspaceStore.retrieve();
      await nextTick();
    });

    async function switchWorkspace(id) {
      if (id === activeId.value) return;
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
          const ws = await workspaceStore.create(name.trim(), {
            copySettings: true,
          });
          await workspaceStore.switchTo(ws.id);
          clearSettingsLocalStorage();
          window.location.reload();
        },
      });
    }

    function promptJoin() {
      emitter.emit('show-dialog', 'prompt', {
        title: 'Join Workspace',
        placeholder: 'Paste invite token',
        okText: 'Join',
        password: false,
        async onConfirm(token) {
          if (!token || !token.trim()) return;
          try {
            const { useCloudWorkspaces } =
              await import('@/composable/useCloudWorkspaces');
            const cloud = useCloudWorkspaces();
            await cloud.joinWorkspace(token.trim());
            await workspaceStore.retrieve();
            clearSettingsLocalStorage();
            window.location.reload();
          } catch (err) {
            emitter.emit('show-dialog', 'alert', {
              title: 'Join Failed',
              description: err?.message || 'Invalid or expired invite token.',
            });
          }
        },
      });
    }

    return {
      triggerEl,
      workspaces,
      activeId,
      activeName,
      activeEmoji,
      activeRole,
      isAuthenticated,
      isPaid,
      switchWorkspace,
      promptCreate,
      promptJoin,
    };
  },
};
</script>
