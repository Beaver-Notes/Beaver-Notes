<template>
  <div class="mb-14 w-full max-w-3xl space-y-6">
    <p class="text-sm font-semibold text-neutral-600 dark:text-neutral-300">
      Team settings
    </p>

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
            <p class="text-xs text-neutral-500 dark:text-neutral-400">{{ quotaMB }} MB pooled</p>
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
        <div v-for="m in members" :key="m.userId" class="flex items-center gap-3 px-4 py-3.5">
          <div class="min-w-0 flex-1">
            <p class="text-sm font-medium text-neutral-800 dark:text-neutral-200 truncate">{{ m.userId }}</p>
            <p class="mt-0.5 text-xs text-neutral-500 dark:text-neutral-400">role: {{ m.role }} · {{ m.deviceCount }} devices</p>
          </div>
          <ui-select :model-value="m.role" class="w-32" @change="($event) => changeRole(m.userId, $event)">
            <option value="owner">Owner</option>
            <option value="admin">Admin</option>
            <option value="editor">Editor</option>
            <option value="viewer">Viewer</option>
          </ui-select>
          <ui-button icon variant="danger" :aria-label="`Remove ${m.userId}`" @click="removeMember(m.userId)">
            <v-remixicon name="riDeleteBin6Line" />
          </ui-button>
        </div>
        <div v-if="error" class="px-4 py-3">
          <p class="text-sm text-red-500" role="alert">{{ error }}</p>
        </div>
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
          <ui-button v-if="flags.audit" @click="loadAudit">Load</ui-button>
        </div>
      </div>
    </section>
  </div>
</template>

<script>
import { ref, computed, onMounted } from 'vue';
import { useAccountStore } from '@/store/account';
import { useWorkspaceStore } from '@/store/workspace';
import { useTeamAdmin } from '@/composable/useTeamAdmin';
import { getPlans } from '@/lib/api/plans';

export default {
  setup() {
    const accountStore = useAccountStore();
    const workspaceStore = useWorkspaceStore();
    const workspaceId = workspaceStore.activeId || accountStore.activeWorkspaceId;

    const plan = ref('free');
    const flags = ref({ dashboard: false, audit: false });
    const quotaBytes = ref(0);

    const admin = useTeamAdmin(workspaceId);

    const quotaMB = computed(() => (quotaBytes.value / 1024 ** 3).toFixed(0));
    const historyLabel = computed(() => {
      if (flags.value.audit) return 'Enterprise (negotiated)';
      return '1 year';
    });

    onMounted(async () => {
      try {
        const plans = await getPlans({ baseUrl: accountStore.serverUrl });
        plan.value = plans?.plan || 'free';
        flags.value = plans?.flags || flags.value;
        quotaBytes.value = plans?.quotaBytes || 0;
      } catch { /* plans optional */ }
      await admin.loadMembers();
    });

    return {
      plan,
      flags,
      quotaBytes,
      quotaMB,
      historyLabel,
      ...admin,
    };
  },
};
</script>
