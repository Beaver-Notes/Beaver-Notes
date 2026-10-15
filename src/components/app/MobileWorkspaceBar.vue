<template>
  <div
    v-if="isAuthenticated && activeWorkspaceName"
    data-testid="mobile-workspace-bar"
    class="w-full px-4 pt-2 first:pt-[calc(var(--app-safe-area-top)+0.5rem)]"
  >
    <ui-popover v-model="showPicker" placement="bottom">
      <template #trigger>
        <button
          type="button"
          data-testid="mobile-workspace-trigger"
          class="inline-flex max-w-full items-center gap-2 rounded-full bg-white/80 py-1.5 pl-3 pr-2 text-sm font-medium text-neutral-800 shadow-sm ring-1 ring-black/5 backdrop-blur transition-transform active:scale-[0.97] dark:bg-neutral-900/80 dark:text-neutral-200 dark:ring-white/10"
          :aria-label="activeWorkspaceName"
        >
          <span class="min-w-0 flex-1 truncate text-left">{{
            activeWorkspaceName
          }}</span>
          <span
            v-if="activeWorkspaceRole"
            class="shrink-0 rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-semibold text-primary"
          >
            {{ activeWorkspaceRole }}
          </span>
          <v-remixicon name="riArrowDownSLine" size="16" class="shrink-0" />
        </button>
      </template>
      <template #content>
        <div class="p-1 min-w-[220px]">
          <button
            v-for="ws in workspaces"
            :key="ws.id"
            type="button"
            class="w-full flex items-center gap-2 px-3 py-2 rounded-xl text-sm text-left transition-colors"
            :class="
              ws.id === activeWorkspaceId
                ? 'bg-primary/10 text-primary font-medium'
                : 'text-neutral-700 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-800'
            "
            @click="switchWs(ws.id)"
          >
            <span class="truncate">{{ ws.name || 'Workspace' }}</span>
            <v-remixicon
              v-if="ws.id === activeWorkspaceId"
              name="riCheckLine"
              size="14"
              class="ltr:ml-auto rtl:mr-auto text-primary"
            />
          </button>
        </div>
      </template>
    </ui-popover>
  </div>
</template>

<script setup>
import { computed, ref } from 'vue';
import { useAccountStore } from '@/store/account';
import { useWorkspaceStore } from '@/store/workspace';

const accountStore = useAccountStore();
const workspaceStore = useWorkspaceStore();
const showPicker = ref(false);

const isAuthenticated = computed(() => accountStore.isAuthenticated);
const workspaces = computed(() => workspaceStore.workspaces);
const activeWorkspaceId = computed(() => workspaceStore.activeId);
const activeWorkspace = computed(() =>
  workspaces.value.find((w) => w.id === activeWorkspaceId.value),
);
const activeWorkspaceName = computed(() => activeWorkspace.value?.name || '');
const activeWorkspaceRole = computed(() => activeWorkspace.value?.role || '');

async function switchWs(id) {
  showPicker.value = false;
  await workspaceStore.switchTo(id);
  window.location.reload();
}
</script>
