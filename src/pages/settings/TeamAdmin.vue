<template>
  <div class="mb-14 w-full max-w-3xl space-y-6">
    <p class="text-sm font-semibold text-neutral-600 dark:text-neutral-300">
      Team settings
    </p>

    <!-- Upgrade gate: the dashboard flag is team/enterprise-only -->
    <section v-if="plansLoaded && !flags.dashboard" class="space-y-2">
      <div
        class="space-y-1 bg-neutral-50 dark:bg-neutral-900 rounded-xl border px-4 py-6"
      >
        <p class="text-sm font-medium text-neutral-800 dark:text-neutral-200">
          Team dashboard requires the Team or Enterprise plan
        </p>
        <p class="mt-0.5 text-xs text-neutral-500 dark:text-neutral-400">
          Upgrade to manage members, devices and sessions for your workspace.
        </p>
      </div>
    </section>

    <template v-else>
      <!-- Overview -->
      <section class="space-y-2">
        <div class="space-y-1 bg-neutral-50 dark:bg-neutral-900 rounded-xl border">
          <div class="flex flex-col gap-3 px-4 py-3.5">
            <div class="flex items-center justify-between">
              <p class="text-sm font-medium text-neutral-800 dark:text-neutral-200">Plan</p>
              <p class="text-xs text-neutral-500 dark:text-neutral-400 capitalize">{{ plan }}</p>
            </div>
            <div class="flex items-center justify-between">
              <p class="text-sm font-medium text-neutral-800 dark:text-neutral-200">Storage</p>
              <p class="text-xs text-neutral-500 dark:text-neutral-400">{{ quotaGB }} GB pooled</p>
            </div>
            <div class="flex items-center justify-between">
              <p class="text-sm font-medium text-neutral-800 dark:text-neutral-200">History</p>
              <p class="text-xs text-neutral-500 dark:text-neutral-400">{{ historyLabel }}</p>
            </div>
          </div>
        </div>
      </section>

      <!-- Members -->
      <section class="space-y-2">
        <p class="text-sm font-semibold text-neutral-600 dark:text-neutral-300">Members</p>
        <div class="space-y-1 bg-neutral-50 dark:bg-neutral-900 rounded-xl border">
          <div class="flex flex-col gap-2 px-4 py-3.5 sm:flex-row sm:items-center">
            <ui-input
              v-model="inviteInput"
              class="flex-1"
              placeholder="Email or username"
              :aria-label="'Email or username to invite'"
              @keydown.enter="handleAddMember"
            />
            <ui-select v-model="inviteRole" class="w-32" :aria-label="'Invite role'">
              <option value="editor">Editor</option>
              <option value="viewer">Viewer</option>
              <option value="admin">Admin</option>
            </ui-select>
            <ui-button variant="primary" :disabled="addingMember" @click="handleAddMember">
              {{ addingMember ? 'Inviting…' : 'Invite' }}
            </ui-button>
          </div>
          <p v-if="inviteSuccess" class="px-4 text-xs text-green-600 dark:text-green-400" role="status">
            {{ inviteSuccess }}
          </p>

          <div v-for="m in members" :key="m.userId" class="flex items-center gap-3 px-4 py-3.5">
            <div class="min-w-0 flex-1">
              <p class="text-sm font-medium text-neutral-800 dark:text-neutral-200 truncate">{{ m.userId }}</p>
              <p class="mt-0.5 text-xs text-neutral-500 dark:text-neutral-400">role: {{ m.role }} · {{ m.deviceCount }} devices</p>
            </div>
            <ui-select
              :model-value="m.role"
              class="w-32"
              :disabled="m.userId === currentUserId && m.role === 'owner'"
              :aria-label="`Role for ${m.userId}`"
              @change="($event) => handleChangeRole(m.userId, $event)"
            >
              <option value="owner">Owner</option>
              <option value="admin">Admin</option>
              <option value="editor">Editor</option>
              <option value="viewer">Viewer</option>
            </ui-select>
            <ui-button
              icon
              variant="danger"
              :aria-label="`Remove ${m.userId}`"
              @click="handleRemoveMember(m.userId)"
            >
              <v-remixicon name="riDeleteBin6Line" />
            </ui-button>
          </div>
          <p v-if="error" class="px-4 py-3">
            <span class="text-sm text-red-500" role="alert">{{ error }}</span>
          </p>
        </div>
      </section>

      <!-- Devices & Sessions -->
      <section class="space-y-2">
        <div class="flex items-center justify-between">
          <p class="text-sm font-semibold text-neutral-600 dark:text-neutral-300">Devices & Sessions</p>
          <ui-button variant="secondary" @click="handleLoadDevices">Refresh</ui-button>
        </div>
        <div class="space-y-1 bg-neutral-50 dark:bg-neutral-900 rounded-xl border">
          <div
            v-for="s in sessions"
            :key="s.idHash"
            class="flex items-center gap-3 px-4 py-3.5"
          >
            <div class="min-w-0 flex-1">
              <p class="text-sm font-medium text-neutral-800 dark:text-neutral-200 truncate">
                {{ s.deviceLabel }}
              </p>
              <p class="mt-0.5 text-xs text-neutral-500 dark:text-neutral-400">
                {{ s.deviceId || 'Unknown device' }} · last seen {{ s.lastSeenAt || 'never' }}
              </p>
            </div>
            <ui-button
              icon
              variant="danger"
              :aria-label="`Revoke session ${s.idHash}`"
              @click="handleRevoke(s.idHash)"
            >
              <v-remixicon name="riShieldKeyholeLine" />
            </ui-button>
          </div>
          <div
            v-for="d in devices"
            :key="d.deviceId"
            class="flex items-center gap-3 px-4 py-3.5"
          >
            <div class="min-w-0 flex-1">
              <p class="text-sm font-medium text-neutral-800 dark:text-neutral-200 truncate">{{ d.label }}</p>
              <p class="mt-0.5 text-xs text-neutral-500 dark:text-neutral-400">{{ d.deviceId }}</p>
            </div>
          </div>
          <p v-if="devices.length === 0 && sessions.length === 0" class="px-4 py-3">
            <span class="text-xs text-neutral-500 dark:text-neutral-400">No devices or active sessions.</span>
          </p>
        </div>
      </section>

      <!-- Audit -->
      <section class="space-y-2">
        <div class="space-y-1 bg-neutral-50 dark:bg-neutral-900 rounded-xl border px-4 py-3.5">
          <div class="flex items-center justify-between gap-3">
            <div class="min-w-0 flex-1">
              <p class="text-sm font-medium text-neutral-800 dark:text-neutral-200">Audit logs</p>
              <p v-if="!flags.audit" class="mt-0.5 text-xs text-neutral-500 dark:text-neutral-400">
                Audit logs are available on the Enterprise plan.
              </p>
            </div>
            <ui-button v-if="flags.audit" @click="handleLoadAudit">Load</ui-button>
          </div>
          <ul v-if="flags.audit && auditLogs.length > 0" class="space-y-1 pt-2">
            <li
              v-for="log in auditLogs"
              :key="log.id"
              class="text-xs text-neutral-500 dark:text-neutral-400"
            >
              {{ log.createdAt }} — {{ log.action }}
            </li>
          </ul>
        </div>
      </section>
    </template>
  </div>
</template>

<script>
import { ref, computed, onMounted, watch } from 'vue';
import { useAccountStore } from '@/store/account';
import { useWorkspaceStore } from '@/store/workspace';
import { useTeamAdmin } from '@/composable/useTeamAdmin';
import { getPlans } from '@/lib/api/plans';

export default {
  setup() {
    const accountStore = useAccountStore();
    const workspaceStore = useWorkspaceStore();

    const workspaceId = computed(
      () => workspaceStore.activeId || accountStore.activeWorkspaceId || null
    );
    const currentUserId = computed(
      () => accountStore.activeAccount?.id || accountStore.profile?.id || null
    );

    const plan = ref('free');
    const flags = ref({ dashboard: false, audit: false });
    const quotaBytes = ref(0);
    const historyDays = ref(null);
    const plansLoaded = ref(false);

    const admin = useTeamAdmin(() => workspaceId.value);

    const inviteInput = ref('');
    const inviteRole = ref('editor');
    const addingMember = ref(false);
    const inviteSuccess = ref('');

    const quotaGB = computed(() => (quotaBytes.value / 1024 ** 3).toFixed(0));
    const historyLabel = computed(() => {
      if (flags.value.audit) return 'Enterprise (negotiated)';
      if (historyDays.value === null) return 'Unlimited';
      return `${historyDays.value} days`;
    });

    async function loadPlans() {
      try {
        const plans = await getPlans({ baseUrl: accountStore.serverUrl });
        plan.value = plans?.plan || 'free';
        flags.value = plans?.flags || flags.value;
        quotaBytes.value = plans?.quotaBytes || 0;
        historyDays.value = plans?.historyDays ?? null;
      } catch { /* plans optional */ } finally {
        plansLoaded.value = true;
      }
    }

    async function handleAddMember() {
      inviteSuccess.value = '';
      addingMember.value = true;
      try {
        await admin.addMemberByEmail(inviteInput.value, inviteRole.value);
        inviteSuccess.value = `Invitation sent to ${inviteInput.value.trim()}.`;
        inviteInput.value = '';
        await admin.loadMembers();
      } catch (err) {
        admin.error.value = err?.message || 'Failed to invite member.';
      } finally {
        addingMember.value = false;
      }
    }

    async function handleChangeRole(userId, role) {
      try {
        await admin.changeRole(userId, role);
      } catch (err) {
        admin.error.value = err?.message || 'Failed to change role.';
      }
    }

    async function handleRemoveMember(userId) {
      try {
        await admin.removeMember(userId);
      } catch (err) {
        admin.error.value = err?.message || 'Failed to remove member.';
      }
    }

    async function handleRevoke(sessionHash) {
      try {
        await admin.revoke(sessionHash);
      } catch (err) {
        admin.error.value = err?.message || 'Failed to revoke session.';
      }
    }

    async function handleLoadDevices() {
      try {
        await admin.loadDevices();
      } catch (err) {
        admin.error.value = err?.message || 'Failed to load devices.';
      }
    }

    async function handleLoadAudit() {
      try {
        await admin.loadAudit();
      } catch (err) {
        admin.error.value = err?.message || 'Failed to load audit logs.';
      }
    }

    async function refreshAdmin() {
      if (!workspaceId.value) return;
      await Promise.allSettled([admin.loadMembers(), admin.loadDevices()]);
    }

    onMounted(async () => {
      await loadPlans();
      if (flags.value.dashboard) {
        await refreshAdmin();
      }
    });

    watch(workspaceId, () => {
      if (flags.value.dashboard) {
        refreshAdmin();
      }
    });

    return {
      plan,
      flags,
      quotaBytes,
      quotaGB,
      historyLabel,
      plansLoaded,
      currentUserId,
      admin,
      inviteInput,
      inviteRole,
      addingMember,
      inviteSuccess,
      members: admin.members,
      devices: admin.devices,
      sessions: admin.sessions,
      auditLogs: admin.auditLogs,
      error: admin.error,
      handleAddMember,
      handleChangeRole,
      handleRemoveMember,
      handleRevoke,
      handleLoadDevices,
      handleLoadAudit,
    };
  },
};
</script>
