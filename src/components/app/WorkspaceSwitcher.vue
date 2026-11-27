<template>
  <div v-if="isAuthenticated">
    <ui-popover
      v-model="popoverOpen"
      :sheet="sheetMode"
      :placement="expanded ? 'bottom-start' : 'right-start'"
    >
      <template #trigger>
        <!-- Expanded: full-width pill trigger -->
        <div
          v-if="expanded"
          ref="triggerEl"
          data-testid="workspace-switcher-trigger"
          class="transition-colors duration-150 rounded-xl flex items-center h-10 mobile:h-11 w-full gap-2 cursor-pointer"
        >
          <span
            class="w-6 h-6 rounded-md flex items-center justify-center text-sm leading-none"
            :style="{
              backgroundColor: `${activeColor || '#64748b'}20`,
              color: activeColor || '#64748b',
            }"
          >
            <span v-if="activeEmoji">{{ activeEmoji }}</span>
            <v-remixicon v-else name="riFolderLine" size="14" />
          </span>
          <span
            class="text-sm font-medium truncate flex-1 min-w-0 text-neutral-700 dark:text-neutral-300"
          >
            {{ activeName }}
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
          data-testid="workspace-switcher-trigger"
          class="w-9 h-9 flex items-center justify-center rounded-xl hover:bg-neutral-200/50 dark:hover:bg-neutral-700/50 text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200 transition-colors"
        >
          <span
            class="w-9 h-9 rounded-xl flex items-center justify-center text-sm leading-none"
            :style="{
              backgroundColor: `${activeColor || '#64748b'}20`,
              color: activeColor || '#64748b',
            }"
          >
            <span v-if="activeEmoji">{{ activeEmoji }}</span>
            <v-remixicon v-else name="riFolderLine" size="14" />
          </span>
        </button>
      </template>

      <div class="min-w-[240px] py-1">
        <div
          class="px-2.5 pb-1.5 text-xs font-semibold font-bold text-neutral-500 dark:text-neutral-400 select-none"
        >
          Accounts
        </div>

        <div v-for="acct in accounts" :key="acct.id">
          <button
            :data-testid="
              acct.id === activeAccountId
                ? 'account-option-active'
                : 'account-option'
            "
            class="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 mobile:py-3.5 text-left hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors text-sm"
            @click="switchToAccount(acct.id)"
          >
            <span
              class="shrink-0 w-6 h-6 rounded-md flex items-center justify-center text-xs leading-none uppercase"
              :class="
                acct.id === activeAccountId
                  ? 'bg-primary/10 text-primary'
                  : 'bg-neutral-100 dark:bg-neutral-800 text-neutral-400 dark:text-neutral-200'
              "
            >
              {{ accountInitial(acct) }}
            </span>

            <span
              class="truncate flex-1 min-w-0"
              :class="
                acct.id === activeAccountId
                  ? 'text-primary font-medium'
                  : 'text-neutral-700 dark:text-neutral-300'
              "
            >
              {{ accountLabel(acct) }}
            </span>

            <span
              v-if="paidFeaturesEnabled && accountPlan(acct)"
              class="shrink-0 text-xs leading-none px-1.5 py-1 rounded-full bg-neutral-200 dark:bg-neutral-700 text-neutral-500 dark:text-neutral-400 font-medium"
            >
              {{ accountPlan(acct) }}
            </span>

            <v-remixicon
              v-if="acct.id === activeAccountId"
              name="riCheckLine"
              size="14"
              class="shrink-0 text-primary"
            />
          </button>

          <!-- Only the active account has a live workspace list; another
               account's workspaces appear after one switch. -->
          <div v-if="acct.id === activeAccountId" class="pl-3">
            <div v-for="ws in workspaces" :key="ws.id">
              <button
                :data-testid="
                  ws.id === activeId
                    ? 'workspace-option-active'
                    : 'workspace-option'
                "
                class="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 mobile:py-3.5 text-left transition-colors text-sm"
                :class="
                  ws.id === activeId
                    ? 'bg-primary/10'
                    : 'hover:bg-neutral-100 dark:hover:bg-neutral-800'
                "
                @click="switchWorkspace(ws.id)"
              >
                <span
                  class="shrink-0 w-6 h-6 rounded-md flex items-center justify-center text-sm leading-none"
                  :style="{
                    backgroundColor: `${ws.color || '#64748b'}20`,
                    color: ws.color || '#64748b',
                  }"
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

                <!-- Customize + team settings are always visible: on phones
                     there is no hover, and hiding management behind one made
                     them undiscoverable. -->
                <span
                  v-if="canCustomizeWorkspace(ws)"
                  class="shrink-0 -mr-1 flex items-center gap-0.5"
                >
                  <button
                    class="p-1.5 rounded-lg hover:bg-neutral-200 dark:hover:bg-neutral-700 motion-press"
                    :aria-label="`Customize ${ws.name}`"
                    @click.stop="promptRename(ws)"
                  >
                    <v-remixicon
                      name="riEditLine"
                      size="14"
                      class="text-neutral-400"
                    />
                  </button>
                  <button
                    v-if="canManageWorkspace(ws)"
                    class="p-1.5 rounded-lg hover:bg-neutral-200 dark:hover:bg-neutral-700 motion-press"
                    :aria-label="`Team settings for ${ws.name}`"
                    @click.stop="goToTeamSettings(ws)"
                  >
                    <v-remixicon
                      name="riSettingsLine"
                      size="14"
                      class="text-neutral-400"
                    />
                  </button>
                </span>

                <span
                  v-if="ws.local"
                  class="shrink-0 text-xs leading-none px-1.5 py-1 rounded-full bg-neutral-200 dark:bg-neutral-700 text-neutral-500 dark:text-neutral-400 font-medium"
                >
                  Local
                </span>

                <v-remixicon
                  v-if="ws.id === activeId"
                  name="riCheckLine"
                  size="14"
                  class="shrink-0 text-primary"
                />
              </button>
            </div>
          </div>
        </div>

        <template v-if="paidFeaturesEnabled && archived.length">
          <div
            class="px-2.5 pb-1.5 pt-2 text-xs font-semibold font-bold text-neutral-500 dark:text-neutral-400 select-none"
          >
            Deleted (restorable 10 days)
          </div>
          <div
            v-for="ws in archived"
            :key="ws.id"
            class="flex items-center gap-2.5 rounded-lg px-2.5 py-1.5 mobile:py-3.5 text-sm text-neutral-500 dark:text-neutral-400"
          >
            <span
              class="shrink-0 w-6 h-6 rounded-md flex items-center justify-center bg-neutral-100 dark:bg-neutral-800"
            >
              <v-remixicon name="riDeleteBin6Line" size="14" />
            </span>
            <span class="truncate flex-1 min-w-0">{{ ws.name }}</span>
            <button
              class="p-1.5 rounded-lg hover:bg-neutral-200 dark:hover:bg-neutral-700 motion-press"
              :aria-label="`Restore ${ws.name}`"
              :title="archivedUntil(ws)"
              @click="restoreArchived(ws)"
            >
              <v-remixicon name="riArrowGoBackLine" size="14" />
            </button>
          </div>
        </template>

        <template v-if="paidFeaturesEnabled && pendingRequests.length">
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

        <div class="border-t border-neutral-200 dark:border-neutral-700 my-1 px-2" />

        <button
          v-if="canCreateWorkspace"
          class="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 mobile:py-3.5 text-left text-neutral-500 dark:text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors text-sm"
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
          v-if="paidFeaturesEnabled && isPaid"
          class="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 mobile:py-3.5 text-left text-neutral-500 dark:text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors text-sm"
          @click="promptJoin"
        >
          <span
            class="shrink-0 w-6 h-6 rounded-md flex items-center justify-center bg-neutral-100 dark:bg-neutral-800"
          >
            <v-remixicon name="riLoginBoxLine" size="14" />
          </span>
          <span>Join Workspace</span>
        </button>

        <button
          v-if="paidFeaturesEnabled"
          data-testid="add-account"
          class="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 mobile:py-3.5 text-left text-neutral-500 dark:text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors text-sm"
          @click="addAccount"
        >
          <span
            class="shrink-0 w-6 h-6 rounded-md flex items-center justify-center bg-neutral-100 dark:bg-neutral-800"
          >
            <v-remixicon name="riUserAddLine" size="14" />
          </span>
          <span>Add account</span>
        </button>

        <button
          v-if="activeAccount"
          data-testid="account-signout"
          :data-account-id="activeAccountId"
          class="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 mobile:py-3.5 text-left text-neutral-500 dark:text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors text-sm"
          @click="promptSignOut"
        >
          <span
            class="shrink-0 w-6 h-6 rounded-md flex items-center justify-center bg-neutral-100 dark:bg-neutral-800"
          >
            <v-remixicon name="riLogoutBoxRLine" size="14" />
          </span>
          <span>Sign out</span>
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
import { ref, computed, onMounted, nextTick, watch } from 'vue';
import { useRouter } from 'vue-router';
import emitter from 'tiny-emitter/instance';
import { useWorkspaceStore } from '@/store/workspace';
import { useAccountStore } from '@/store/account';
import { getTranslations } from '@/utils/i18n/getTranslations';
import { normalizeInviteToken } from '@/lib/api/collaboration';
import { useDialog } from '@/lib/dialog';
import { useCloudWorkspaces } from '@/composable/useCloudWorkspaces';
import { getActiveAccountId, listAccounts } from '@/lib/accounts-index';
import {
  listArchivedWorkspaces,
  renameLocalWorkspace,
  restoreLocalWorkspace,
} from '@/lib/native/workspaces';
import { signOutAccount, switchAccount } from '@/composable/useAccountAuth';
import { isPhoneRuntime } from '@/lib/tauri/runtime';
import { foldState } from '@/lib/foldable';
import { PAID_FEATURES_ENABLED } from '@/utils/paid-features';
import WorkspaceFormDialog from './WorkspaceFormDialog.vue';

export default {
  components: {
    WorkspaceFormDialog,
  },
  props: {
    expanded: { type: Boolean, default: false },
  },
  setup() {
    const translations = getTranslations();
    const workspaceStore = useWorkspaceStore();
    const accountStore = useAccountStore();
    const cloud = useCloudWorkspaces();
    const router = useRouter();
    const triggerEl = ref(null);
    const popoverOpen = ref(false);
    // Phones get a bottom sheet: a dropdown anchored to the top of a phone screen
    // has no room for the list, and its 36px rows are under the touch minimum.
    // The rail is a popover context, not a sheet one: a bottom sheet from a rail
    // button is a phone interaction on what may be a 951px canvas.
    const sheetMode = isPhoneRuntime() && !foldState.isFoldable;
    const formDialogShow = ref(false);
    const formDialogMode = ref('create');
    const formDialogWorkspace = ref(null);
    const archived = ref([]);

    const workspaces = computed(() => workspaceStore.workspaces);
    const pendingRequests = computed(() => cloud.pendingRequests);
    const activeId = computed(() => workspaceStore.activeId);
    const activeWs = computed(
      () =>
        workspaces.value.find((w) => w.id === activeId.value) ??
        workspaces.value[0],
    );
    const activeName = computed(() => activeWs.value?.name ?? 'Default');
    const activeEmoji = computed(() => activeWs.value?.emoji ?? '');
    const activeColor = computed(() => activeWs.value?.color ?? '#64748b');
    const paidFeaturesEnabled = PAID_FEATURES_ENABLED;
    const isAuthenticated = computed(() => accountStore.isAuthenticated);
    const isPaid = computed(() => paidFeaturesEnabled && accountStore.isPaidPlan);
    const accounts = computed(() => listAccounts());
    const activeAccountId = computed(() => getActiveAccountId());
    const activeAccount = computed(
      () => accounts.value.find((a) => a.id === activeAccountId.value) ?? null,
    );
    // teamWorkspaces is the plan capability that permits creating extra
    // workspaces. Starter and pro get exactly one workspace, so they may still
    // create it when they currently have none and the count is known.
    const canCreateWorkspace = computed(() => {
      if (!paidFeaturesEnabled) return false;
      if (accountStore.planLimits?.flags?.teamWorkspaces === true) return true;
      if (!isPaid.value) return false;
      const list = workspaces.value.filter((w) => !w.local);
      if (!list || workspaceStore.loading) return false;
      return list.length === 0;
    });

    function accountLabel(acct) {
      return acct?.label || acct?.email || 'Account';
    }

    function accountInitial(acct) {
      return accountLabel(acct).trim().charAt(0) || '?';
    }

    // The plan badge reads the account record, not the store: it has to be
    // right for every account in the list, not only the active one. Migration
    // and sign-in leave `subscription` null, so `planLimits` is the real source.
    function accountPlan(acct) {
      const plan = acct?.subscription?.plan || acct?.planLimits?.plan;
      return typeof plan === 'string' ? plan : '';
    }

    const canManageWorkspace = (ws) =>
      paidFeaturesEnabled &&
      accountStore.planLimits?.flags?.dashboard === true &&
      (ws.role === 'owner' || ws.role === 'admin');
    const canCustomizeWorkspace = (ws) =>
      ws.local ||
      (paidFeaturesEnabled && (ws.role === 'owner' || ws.role === 'admin'));

    // Deleted local workspaces whose files are still kept: restoring is just a
    // move back, so the list is read on every open instead of being cached.
    async function loadArchived() {
      archived.value = (await listArchivedWorkspaces().catch(() => [])) || [];
    }

    function archivedUntil(ws) {
      const at = Date.parse(ws?.archivedAt || '');
      if (!Number.isFinite(at)) return '';
      const until = new Date(at + 10 * 24 * 60 * 60 * 1000);
      return `Restorable until ${until.toLocaleDateString()}`;
    }

    async function restoreArchived(ws) {
      try {
        await restoreLocalWorkspace(ws.id);
        await workspaceStore.retrieve();
        await loadArchived();
      } catch (err) {
        useDialog().alert({
          title: 'Restore failed',
          description: err?.message || 'The kept copy is no longer available.',
        });
      }
    }

    onMounted(async () => {
      await workspaceStore.retrieve();
      if (paidFeaturesEnabled && accountStore.isAuthenticated) {
        cloud.fetchMyPendingRequests().catch(() => {
          /* pending list is non-critical */
        });
        await loadArchived();
      }
      await nextTick();
    });

    watch(popoverOpen, (open) => {
      if (paidFeaturesEnabled && open && accountStore.isAuthenticated)
        loadArchived();
    });

    // Switching is in place now: the leaving workspace is flushed and the
    // arriving one is initialised in the same window, so there is nothing to
    // warn about.
    async function switchWorkspace(id) {
      if (id === activeId.value) return;
      popoverOpen.value = false;
      await switchAccount({
        accountId: activeAccountId.value,
        workspaceId: id,
      });
    }

    async function switchToAccount(id) {
      if (id === activeAccountId.value) return;
      popoverOpen.value = false;
      await switchAccount({ accountId: id });
    }

    async function addAccount() {
      if (!paidFeaturesEnabled) return;
      popoverOpen.value = false;
      router.push({ path: '/settings/account', query: { addAccount: '1' } });
    }

    function promptSignOut() {
      const acct = activeAccount.value;
      if (!acct) return;
      popoverOpen.value = false;
      const dialog = useDialog();
      dialog.confirm({
        title: 'Sign out?',
        body: `${accountLabel(
          acct,
        )} stops syncing. Notes already on this device stay, and you can sign back in later.`,
        okText: 'Sign out',
        cancelText: 'Cancel',
        icon: 'riLogoutBoxRLine',
        onConfirm: () => signOutAccount(acct.id),
      });
    }

    function promptCreate() {
      // Stops a stale render from opening the dialog on a plan that cannot create workspaces.
      if (!canCreateWorkspace.value) return;
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
      let created = null;
      if (wasCreate) {
        created = await workspaceStore.create(name.trim(), {
          copySettings: true,
          emoji,
          color,
        });
      } else {
        const wsId = formDialogWorkspace.value?.id;
        if (wsId) {
          if (formDialogWorkspace.value.local) {
            // Local workspaces live in the Rust registry, which has no
            // emoji/color fields — only the rename persists.
            await renameLocalWorkspace(wsId, name.trim());
            const ws = workspaceStore.workspaces.find((w) => w.id === wsId);
            if (ws) ws.name = name.trim();
          } else {
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
      }
      // A new workspace is switched to in place and lands on its notes list.
      // Forcing the settings page here stranded mobile users in Settings with
      // no way back to the workspace they had just created (F25).
      if (created) {
        await switchAccount({
          accountId: activeAccountId.value,
          workspaceId: created.id,
        });
      }
    }

    function promptRename(ws) {
      formDialogMode.value = 'edit';
      formDialogWorkspace.value = ws;
      formDialogShow.value = true;
    }

    // Team settings manages the workspace it was opened for: if that isn't the
    // active one, switch first so the settings page shows the right team.
    async function goToTeamSettings(ws) {
      if (!paidFeaturesEnabled) return;
      if (ws && ws.id !== activeId.value) {
        await switchAccount({
          accountId: activeAccountId.value,
          workspaceId: ws.id,
        });
      } else {
        popoverOpen.value = false;
      }
      router.push('/settings/workspace');
    }

    function promptJoin() {
      if (!paidFeaturesEnabled) return;
      emitter.emit('show-dialog', 'prompt', {
        title: translations.workspace.joinWorkspace || 'Join Workspace',
        placeholder:
          translations.workspace.pasteInviteToken ||
          'Paste invite link or token',
        okText: translations.workspace.join || 'Join',
        password: false,
        async onConfirm(token) {
          const inviteToken = normalizeInviteToken(token);
          if (!inviteToken) return;
          try {
            const raw = await cloud.joinWorkspace(inviteToken);
            // A require-approval invite grants nothing yet: show the pending
            // state instead of opening the workspace as if the join succeeded.
            if (raw?.pending) {
              emitter.emit('show-dialog', 'alert', {
                title: 'Awaiting approval',
                description:
                  'Your request was sent. A workspace owner must approve you before you can join.',
              });
              return;
            }
            // The joined workspace shows up in the list without a reload.
            await workspaceStore.retrieve();
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
      translations,
      triggerEl,
      popoverOpen,
      sheetMode,
      workspaces,
      archived,
      pendingRequests,
      activeId,
      activeName,
      activeEmoji,
      activeColor,
      isAuthenticated,
      isPaid,
      paidFeaturesEnabled,
      accounts,
      activeAccountId,
      activeAccount,
      accountLabel,
      accountInitial,
      accountPlan,
      canCreateWorkspace,
      canManageWorkspace,
      canCustomizeWorkspace,
      archivedUntil,
      restoreArchived,
      switchWorkspace,
      switchToAccount,
      addAccount,
      promptSignOut,
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
