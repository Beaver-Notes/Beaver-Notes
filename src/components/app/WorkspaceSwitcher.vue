<template>
  <div v-if="isAuthenticated">
    <ui-popover
      v-model="popoverOpen"
      :placement="expanded ? 'bottom-start' : 'right-start'"
    >
      <template #trigger>
        <!-- Expanded: full-width pill trigger -->
        <div
          v-if="expanded"
          ref="triggerEl"
          class="transition-colors duration-150 rounded-xl flex items-center h-10 w-full px-2 gap-2 cursor-pointer text-neutral-500 dark:text-neutral-400 hover:bg-neutral-200/50 dark:hover:bg-neutral-700/50 hover:text-neutral-900 dark:hover:text-neutral-100"
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
            class="shrink-0 text-xs leading-none px-1.5 py-1 rounded-full bg-neutral-200 dark:bg-neutral-700 text-neutral-500 dark:text-neutral-400 font-bold font-medium"
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
          class="px-2.5 pb-1.5 text-xs font-semibold font-bold text-neutral-500 dark:text-neutral-400 select-none"
        >
          Workspaces
        </div>

        <div v-for="ws in workspaces" :key="ws.id" class="group relative">
          <button
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
              class="shrink-0 text-xs leading-none px-1.5 py-1 rounded-full bg-neutral-200 dark:bg-neutral-700 text-neutral-500 dark:text-neutral-400 font-bold font-medium"
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
          <button
            v-if="canManageWorkspace(ws)"
            class="absolute ltr:right-1 rtl:left-1 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-neutral-200 dark:hover:bg-neutral-700 transition-opacity"
            @click.stop="promptRename(ws)"
            aria-label="Rename workspace"
          >
            <v-remixicon name="riEditLine" size="12" class="text-neutral-400" />
          </button>
          <button
            v-if="canManageWorkspace(ws)"
            class="absolute ltr:right-6 rtl:left-6 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-neutral-200 dark:hover:bg-neutral-700 transition-opacity"
            @click.stop="goToTeamSettings"
            aria-label="Team settings"
          >
            <v-remixicon
              name="riSettingsLine"
              size="12"
              class="text-neutral-400"
            />
          </button>
        </div>

        <template v-if="pendingRequests.length">
          <div
            class="px-2.5 pb-1.5 pt-2 text-xs font-semibold font-bold text-neutral-500 dark:text-neutral-400 select-none"
          >
            Awaiting approval
          </div>
          <div
            v-for="req in pendingRequests"
            :key="req.id"
            class="flex items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-sm text-neutral-500 dark:text-neutral-400"
          >
            <span
              class="shrink-0 w-6 h-6 rounded-md flex items-center justify-center bg-amber-100 dark:bg-amber-900/30 text-amber-500"
            >
              <v-remixicon name="riTimeLine" size="14" />
            </span>
            <span class="truncate flex-1 min-w-0">Awaiting owner approval</span>
          </div>
        </template>

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

    <WorkspaceFormDialog
      v-model:show="formDialogShow"
      :mode="formDialogMode"
      :workspace="formDialogWorkspace"
      :submit-handler="handleFormConfirm"
      @close="() => (formDialogShow = false)"
    />
  </div>
</template>

<script>
import { ref, computed, onMounted, nextTick } from 'vue';
import { useRouter } from 'vue-router';
import emitter from 'tiny-emitter/instance';
import { useWorkspaceStore } from '@/store/workspace';
import { useAccountStore } from '@/store/account';
import { getPlans } from '@/lib/api/plans';
import { normalizeInviteToken } from '@/lib/api/collaboration';
import { useDialog } from '@/lib/dialog';
import { useCloudWorkspaces } from '@/composable/useCloudWorkspaces';
import WorkspaceFormDialog from './WorkspaceFormDialog.vue';

export default {
  components: {
    WorkspaceFormDialog,
  },
  props: {
    expanded: { type: Boolean, default: false },
  },
  setup() {
    const workspaceStore = useWorkspaceStore();
    const accountStore = useAccountStore();
    const cloud = useCloudWorkspaces();
    const router = useRouter();
    const triggerEl = ref(null);
    const popoverOpen = ref(false);
    const dashboardFlag = ref(false);
    const formDialogShow = ref(false);
    const formDialogMode = ref('create');
    const formDialogWorkspace = ref(null);

    const workspaces = computed(() => workspaceStore.workspaces);
    const pendingRequests = cloud.pendingRequests;
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

    function canManageWorkspace(ws) {
      return (
        dashboardFlag.value && (ws.role === 'owner' || ws.role === 'admin')
      );
    }

    onMounted(async () => {
      await workspaceStore.retrieve();
      if (accountStore.isAuthenticated) {
        getPlans({ baseUrl: accountStore.serverUrl })
          .then((plans) => {
            dashboardFlag.value = Boolean(plans?.flags?.dashboard);
          })
          .catch(() => {
            /* plans optional */
          });
        cloud.fetchMyPendingRequests().catch(() => {
          /* pending list is non-critical */
        });
      }
      await nextTick();
    });

    // A workspace switch re-boots the app: the Yjs workspace doc, note store and
    // sync engine are all initialised from the active workspace at startup and
    // there is no in-place switch path (only a full teardown for sign-out).
    // Replacing that safely is a larger change, so warn before the reload
    // instead of doing it silently. Global settings are NOT cleared any more:
    // only the active workspace changes.
    function reloadForWorkspace(name) {
      const dialog = useDialog();
      dialog.confirm({
        title: 'Switch workspace?',
        body: `The app reloads to open ${
          name ? `"${name}"` : 'this workspace'
        }. Your settings stay as they are.`,
        okText: 'Switch',
        cancelText: 'Cancel',
        icon: 'riFolderLine',
        onConfirm: () => window.location.reload(),
      });
    }

    async function switchWorkspace(id) {
      if (id === activeId.value) return;
      popoverOpen.value = false;
      const target = workspaces.value.find((w) => w.id === id);
      const dialog = useDialog();
      dialog.confirm({
        title: 'Switch workspace?',
        body: `The app reloads to open ${
          target?.name ? `"${target.name}"` : 'this workspace'
        }. Your settings stay as they are.`,
        okText: 'Switch',
        cancelText: 'Cancel',
        icon: 'riFolderLine',
        onConfirm: async () => {
          await workspaceStore.switchTo(id);
          window.location.reload();
        },
      });
    }

    function promptCreate() {
      formDialogMode.value = 'create';
      formDialogWorkspace.value = null;
      formDialogShow.value = true;
    }

    // Awaited by WorkspaceFormDialog: it keeps the button loading until this
    // settles and shows any thrown error inline, so we deliberately let errors
    // propagate instead of swallowing them into a separate alert.
    async function handleFormConfirm({ name, emoji, color }) {
      if (!name.trim()) throw new Error('Workspace name is required.');
      const wasCreate = formDialogMode.value === 'create';
      if (wasCreate) {
        const ws = await workspaceStore.create(name.trim(), {
          copySettings: true,
          emoji,
          color,
        });
        await workspaceStore.switchTo(ws.id);
      } else {
        const wsId = formDialogWorkspace.value?.id;
        if (wsId) {
          const cloud = await import('@/composable/useCloudWorkspaces');
          await cloud
            .useCloudWorkspaces()
            .updateWorkspaceDecoration(wsId, { emoji, color });
          if (name !== formDialogWorkspace.value.name) {
            await workspaceStore.rename(wsId, name);
          } else {
            const ws = workspaceStore.workspaces.find((w) => w.id === wsId);
            if (ws) {
              ws.emoji = emoji;
              ws.color = color;
            }
          }
        }
      }
      // Renaming/re-decorating updates in place; only a new workspace needs
      // the reload to load its data.
      if (wasCreate) reloadForWorkspace(name.trim());
    }

    function promptRename(ws) {
      formDialogMode.value = 'edit';
      formDialogWorkspace.value = ws;
      formDialogShow.value = true;
    }

    function goToTeamSettings() {
      popoverOpen.value = false;
      router.push('/settings/workspace');
    }

    function promptJoin() {
      emitter.emit('show-dialog', 'prompt', {
        title: 'Join Workspace',
        placeholder: 'Paste invite link or token',
        okText: 'Join',
        password: false,
        async onConfirm(token) {
          const inviteToken = normalizeInviteToken(token);
          if (!inviteToken) return;
          try {
            const raw = await cloud.joinWorkspace(inviteToken);
            // A require-approval invite grants nothing yet: show the pending
            // state instead of reloading as if the join succeeded.
            if (raw?.pending) {
              emitter.emit('show-dialog', 'alert', {
                title: 'Awaiting approval',
                description:
                  'Your request was sent. A workspace owner must approve you before you can join.',
              });
              return;
            }
            await workspaceStore.retrieve();
            reloadForWorkspace();
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
      popoverOpen,
      workspaces,
      pendingRequests,
      activeId,
      activeName,
      activeEmoji,
      activeRole,
      isAuthenticated,
      isPaid,
      canManageWorkspace,
      switchWorkspace,
      promptCreate,
      promptRename,
      goToTeamSettings,
      promptJoin,
      formDialogShow,
      formDialogMode,
      formDialogWorkspace,
      handleFormConfirm,
    };
  },
};
</script>
