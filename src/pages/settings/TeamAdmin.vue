<template>
  <div class="mb-14 w-full max-w-3xl space-y-6">
    <p class="text-sm font-semibold text-neutral-600 dark:text-neutral-300">
      {{ tr.teamSettings || 'Team settings' }}
    </p>

    <!-- Upgrade gate: the dashboard flag is team/enterprise-only -->
    <section v-if="plansLoaded && !flags.dashboard" class="space-y-2">
      <div
        class="space-y-1 bg-neutral-50 dark:bg-neutral-900 rounded-xl border px-4 py-6"
      >
        <p class="text-sm font-medium text-neutral-800 dark:text-neutral-200">
          {{ tr.dashboardRequires || 'Team dashboard requires the Team or Enterprise plan' }}
        </p>
        <p class="mt-0.5 text-xs text-neutral-500 dark:text-neutral-400">
          {{ tr.upgradeToManage || 'Upgrade to manage members, devices and sessions for your workspace.' }}
        </p>
      </div>
    </section>

    <template v-else>
      <!-- Overview -->
      <section class="space-y-2">
        <div class="space-y-1 bg-neutral-50 dark:bg-neutral-900 rounded-xl border">
          <div class="flex flex-col gap-3 px-4 py-3.5">
            <div class="flex items-center justify-between">
              <p class="text-sm font-medium text-neutral-800 dark:text-neutral-200">{{ tr.plan || 'Plan' }}</p>
              <p class="text-xs text-neutral-500 dark:text-neutral-400 capitalize">{{ plan }}</p>
            </div>
            <div class="flex items-center justify-between">
              <p class="text-sm font-medium text-neutral-800 dark:text-neutral-200">{{ tr.storage || 'Storage' }}</p>
              <p class="text-xs text-neutral-500 dark:text-neutral-400">{{ quotaGB }} GB pooled</p>
            </div>
            <div class="flex items-center justify-between">
              <p class="text-sm font-medium text-neutral-800 dark:text-neutral-200">{{ tr.history || 'History' }}</p>
              <p class="text-xs text-neutral-500 dark:text-neutral-400">{{ historyLabel }}</p>
            </div>
          </div>
        </div>
      </section>

      <!-- Members -->
      <section class="space-y-2">
        <p class="text-sm font-semibold text-neutral-600 dark:text-neutral-300">{{ tr.members || 'Members' }}</p>
        <div class="space-y-1 bg-neutral-50 dark:bg-neutral-900 rounded-xl border">
          <div class="flex flex-col gap-2 px-4 py-3.5 sm:flex-row sm:items-center">
            <ui-input
              v-model="inviteInput"
              class="flex-1"
              :placeholder="tr.emailOrUsername || 'Email or username'"
              :aria-label="tr.emailOrUsername || 'Email or username to invite'"
              @keydown.enter="handleAddMember"
            />
            <ui-select v-model="inviteRole" class="w-32" :aria-label="tr.inviteRole || 'Invite role'">
              <option value="editor">{{ tr.editor || 'Editor' }}</option>
              <option value="viewer">{{ tr.viewer || 'Viewer' }}</option>
              <option value="admin">{{ tr.admin || 'Admin' }}</option>
            </ui-select>
            <ui-button
              variant="primary"
              :disabled="addingMember || !isEmailVerified"
              :title="!isEmailVerified ? verifyTooltip : undefined"
              @click="handleAddMember"
            >
              {{ addingMember ? (tr.inviting || 'Inviting…') : (tr.invite || 'Invite') }}
            </ui-button>
          </div>
          <p v-if="!isEmailVerified" class="px-4 text-xs text-amber-600 dark:text-amber-400">
            {{ tr.verifyEmailToInvite || 'Please verify your email to invite members.' }}
          </p>
          <p v-if="inviteSuccess" class="px-4 text-xs text-green-600 dark:text-green-400" role="status">
            {{ inviteSuccess }}
          </p>

          <div v-for="m in members" :key="m.userId" class="flex items-center gap-3 px-4 py-3.5">
            <div class="min-w-0 flex-1">
              <p class="text-sm font-medium text-neutral-800 dark:text-neutral-200 truncate">{{ m.userId }}</p>
              <p class="mt-0.5 text-xs text-neutral-500 dark:text-neutral-400">{{ fmt('roleLabel', { role: m.role, count: m.deviceCount }) }}</p>
            </div>
            <ui-select
              :model-value="m.role"
              class="w-32"
              :disabled="m.userId === currentUserId && m.role === 'owner'"
              :aria-label="fmt('roleFor', { user: m.userId })"
              @change="($event) => handleChangeRole(m.userId, $event)"
            >
              <option value="owner">{{ tr.owner || 'Owner' }}</option>
              <option value="admin">{{ tr.admin || 'Admin' }}</option>
              <option value="editor">{{ tr.editor || 'Editor' }}</option>
              <option value="viewer">{{ tr.viewer || 'Viewer' }}</option>
            </ui-select>
            <ui-button
              icon
              variant="danger"
              :aria-label="fmt('removeUser', { user: m.userId })"
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
          <p class="text-sm font-semibold text-neutral-600 dark:text-neutral-300">{{ tr.devicesAndSessions || 'Devices & Sessions' }}</p>
          <ui-button variant="secondary" @click="handleLoadDevices">{{ tr.refresh || 'Refresh' }}</ui-button>
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
                {{ s.deviceId || (tr.unknownDevice || 'Unknown device') }} · {{ fmt('lastSeen', { time: s.lastSeenAt || (tr.never || 'never') }) }}
              </p>
            </div>
            <ui-button
              icon
              variant="danger"
              :aria-label="fmt('revokeSession', { id: s.idHash })"
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
            <span class="text-xs text-neutral-500 dark:text-neutral-400">{{ tr.noDevices || 'No devices or active sessions.' }}</span>
          </p>
        </div>
      </section>

      <!-- Audit -->
      <section class="space-y-2">
        <div class="space-y-1 bg-neutral-50 dark:bg-neutral-900 rounded-xl border px-4 py-3.5">
          <div class="flex items-center justify-between gap-3">
            <div class="min-w-0 flex-1">
              <p class="text-sm font-medium text-neutral-800 dark:text-neutral-200">{{ tr.auditLogs || 'Audit logs' }}</p>
              <p v-if="!flags.audit" class="mt-0.5 text-xs text-neutral-500 dark:text-neutral-400">
                {{ tr.auditEnterprise || 'Audit logs are available on the Enterprise plan.' }}
              </p>
            </div>
            <ui-button v-if="flags.audit" @click="handleLoadAudit">{{ tr.load || 'Load' }}</ui-button>
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

      <!-- SSO -->
      <section class="space-y-2">
        <div class="flex items-center justify-between">
          <p class="text-sm font-semibold text-neutral-600 dark:text-neutral-300">{{ tr.sso || 'Single Sign-On (SSO)' }}</p>
          <button
            v-if="flags.audit"
            class="text-xs text-primary dark:text-primary-light hover:underline"
            @click="sso.showForm = !sso.showForm"
          >
            {{ sso.showForm ? (tr.cancel || 'Cancel') : (tr.addSso || '+ Add SSO') }}
          </button>
        </div>

        <div v-if="!flags.audit" class="space-y-1 bg-neutral-50 dark:bg-neutral-900 rounded-xl border px-4 py-6">
          <p class="text-sm text-neutral-500 dark:text-neutral-400">
            {{ tr.ssoRequiresEnterprise || 'SSO requires the Enterprise plan.' }}
          </p>
        </div>

        <template v-else>
          <div v-if="sso.loading" class="text-xs text-neutral-500 py-4">{{ tr.ssoLoading || 'Loading…' }}</div>

          <div v-else-if="sso.configs.length === 0 && !sso.showForm" class="space-y-1 bg-neutral-50 dark:bg-neutral-900 rounded-xl border px-4 py-6">
            <p class="text-sm text-neutral-500 dark:text-neutral-400">
              {{ tr.noSso || 'No SSO configurations yet. Add one to enable single sign-on for your workspace members.' }}
            </p>
          </div>

          <div v-for="cfg in sso.configs" :key="cfg.id" class="bg-neutral-50 dark:bg-neutral-900 rounded-xl border px-4 py-3.5">
            <div class="flex items-center justify-between">
              <div class="space-y-1">
                <div class="flex items-center gap-2">
                  <span class="text-sm font-medium text-neutral-800 dark:text-neutral-200">{{ cfg.slug }}</span>
                  <span class="text-[10px] uppercase font-semibold px-1.5 py-0.5 rounded bg-neutral-200 dark:bg-neutral-700 text-neutral-600 dark:text-neutral-300">{{ cfg.protocol }}</span>
                </div>
                <p class="text-xs text-neutral-500 dark:text-neutral-400">
                  {{ fmt('loginUrl', { url: sso.loginUrl(cfg) }) }}
                </p>
                <p v-if="cfg.allowedEmailDomains" class="text-xs text-neutral-500 dark:text-neutral-400">
                  {{ fmt('allowedDomains', { domains: cfg.allowedEmailDomains }) }}
                </p>
              </div>
              <div class="flex items-center gap-2">
                <button class="text-xs text-neutral-500 hover:text-neutral-800 dark:hover:text-neutral-200" @click="sso.editConfig(cfg)">{{ tr.edit || 'Edit' }}</button>
                <button class="text-xs text-red-500 hover:text-red-700 dark:hover:text-red-400" @click="sso.removeConfig(cfg)">{{ tr.delete || 'Delete' }}</button>
              </div>
            </div>
          </div>

          <!-- Create / Edit form -->
          <div v-if="sso.showForm" class="bg-neutral-50 dark:bg-neutral-900 rounded-xl border px-4 py-4 space-y-4">
            <p class="text-sm font-medium text-neutral-800 dark:text-neutral-200">
              {{ sso.editingId ? (tr.editSso || 'Edit SSO Configuration') : (tr.newSso || 'New SSO Configuration') }}
            </p>
            <div class="grid grid-cols-2 gap-4">
              <ui-select v-model="sso.form.protocol" :label="tr.protocol || 'Protocol'">
                <option value="saml">SAML 2.0</option>
                <option value="oidc">OpenID Connect</option>
              </ui-select>
              <ui-input v-model="sso.form.slug" :label="tr.slug || 'Slug'" placeholder="my-company" />
            </div>
            <ui-input v-model="sso.form.allowedEmailDomains" :label="tr.allowedDomainsLabel || 'Allowed email domains (comma-separated)'" placeholder="example.com, company.org" />

            <template v-if="sso.form.protocol === 'saml'">
              <ui-input v-model="sso.form.idpEntityId" label="IdP Entity ID" placeholder="https://idp.example.com/metadata" />
              <ui-input v-model="sso.form.idpSsoUrl" label="IdP SSO URL" placeholder="https://idp.example.com/sso/saml" />
              <ui-input v-model="sso.form.idpCert" label="IdP Certificate (PEM)" type="textarea" :rows="4" placeholder="-----BEGIN CERTIFICATE-----\n…\n-----END CERTIFICATE-----" />
              <ui-input v-model="sso.form.spCert" label="SP Certificate (PEM, optional)" type="textarea" :rows="4" placeholder="Leave empty to auto-generate" />
              <ui-input v-model="sso.form.spPrivateKey" label="SP Private Key (PEM, optional)" type="textarea" :rows="4" placeholder="Leave empty to auto-generate" />
            </template>

            <template v-if="sso.form.protocol === 'oidc'">
              <ui-input v-model="sso.form.oidcIssuer" label="OIDC Issuer URL" placeholder="https://accounts.example.com" />
              <ui-input v-model="sso.form.oidcClientId" label="Client ID" />
              <ui-input v-model="sso.form.oidcClientSecret" label="Client Secret" type="password" />
            </template>

            <div class="flex items-center gap-3">
              <button class="ui-button py-2 text-sm px-4 rounded-lg" :disabled="sso.saving" @click="sso.saveConfig">
                {{ sso.saving ? (tr.saving || 'Saving…') : (sso.editingId ? (tr.update || 'Update') : (tr.create || 'Create')) }}
              </button>
              <button class="text-xs text-neutral-500 hover:text-neutral-800 dark:hover:text-neutral-200" @click="sso.cancelForm">{{ tr.cancel || 'Cancel' }}</button>
              <p v-if="sso.formError" class="text-xs text-red-500">{{ sso.formError }}</p>
            </div>
          </div>
        </template>
      </section>
    </template>
  </div>
</template>

<script>
import { ref, reactive, computed, onMounted, watch } from 'vue';
import { useAccountStore } from '@/store/account';
import { useWorkspaceStore } from '@/store/workspace';
import { useTeamAdmin } from '@/composable/useTeamAdmin';
import { getPlans } from '@/lib/api/plans';
import { listSsoConfigs, createSsoConfig, updateSsoConfig, deleteSsoConfig } from '@/lib/api/sso';
import { useTranslations } from '@/composable/useTranslations';

export default {
  setup() {
    const accountStore = useAccountStore();
    const workspaceStore = useWorkspaceStore();
    const { translations } = useTranslations();
    const tr = computed(() => translations.value?.teamAdmin || {});
    function fmt(key, params) {
      const raw = tr.value[key] ?? key;
      if (!params) return raw;
      return Object.entries(params).reduce((s, [k, v]) => s.replace(`{${k}}`, String(v)), raw);
    }

    const workspaceId = computed(
      () => workspaceStore.activeId || accountStore.activeWorkspaceId || null
    );
    const currentUserId = computed(
      () => accountStore.activeAccount?.id || accountStore.profile?.id || null
    );
    const isEmailVerified = computed(() => {
      const v = accountStore.profile?.emailVerified;
      return v === true || v === null || v === undefined;
    });
    const verifyTooltip = computed(() => tr.value.verifyTooltip || 'Please verify your email to invite members.');

    const plan = ref('free');
    const flags = ref({ dashboard: false, audit: false });
    const quotaBytes = ref(0);
    const historyDays = ref(null);
    const plansLoaded = ref(false);

    const admin = useTeamAdmin(() => workspaceId.value);

    // SSO state
    const sso = reactive({
      configs: [],
      loading: false,
      showForm: false,
      editingId: null,
      saving: false,
      formError: '',
      form: {
        protocol: 'saml',
        slug: '',
        idpEntityId: '',
        idpSsoUrl: '',
        idpCert: '',
        spCert: '',
        spPrivateKey: '',
        oidcIssuer: '',
        oidcClientId: '',
        oidcClientSecret: '',
        allowedEmailDomains: '',
      },
    });

    function resetSsoForm() {
      sso.showForm = false;
      sso.editingId = null;
      sso.formError = '';
      Object.assign(sso.form, {
        protocol: 'saml', slug: '', idpEntityId: '', idpSsoUrl: '', idpCert: '',
        spCert: '', spPrivateKey: '', oidcIssuer: '', oidcClientId: '', oidcClientSecret: '',
        allowedEmailDomains: '',
      });
    }

    async function loadSsoConfigs() {
      if (!workspaceId.value) return;
      sso.loading = true;
      try {
        sso.configs = await listSsoConfigs(workspaceId.value, { baseUrl: accountStore.serverUrl });
      } catch (err) {
        console.error('[sso] load failed:', err);
      } finally {
        sso.loading = false;
      }
    }

    function ssoLoginUrl(cfg) {
      const host = accountStore.serverUrl || window.location.origin;
      return `${host}/auth/sso/${cfg.slug}/login`;
    }

    function ssoEditConfig(cfg) {
      sso.editingId = cfg.id;
      Object.assign(sso.form, {
        protocol: cfg.protocol,
        slug: cfg.slug,
        idpEntityId: cfg.idpEntityId || '',
        idpSsoUrl: cfg.idpSsoUrl || '',
        idpCert: cfg.idpCert ? '(exists — leave blank to keep)' : '',
        spCert: '',
        spPrivateKey: '',
        oidcIssuer: cfg.oidcIssuer || '',
        oidcClientId: cfg.oidcClientId || '',
        oidcClientSecret: '',
        allowedEmailDomains: cfg.allowedEmailDomains || '',
      });
      sso.showForm = true;
    }

    async function ssoSaveConfig() {
      sso.formError = '';
      if (!sso.form.slug) {
        sso.formError = 'Slug is required.';
        return;
      }
      sso.saving = true;
      try {
        const payload = { ...sso.form };
        Object.keys(payload).forEach((k) => {
          if (payload[k] === '' || payload[k] === null) delete payload[k];
        });
        if (sso.editingId) {
          await updateSsoConfig(workspaceId.value, sso.editingId, payload, { baseUrl: accountStore.serverUrl });
        } else {
          await createSsoConfig(workspaceId.value, payload, { baseUrl: accountStore.serverUrl });
        }
        resetSsoForm();
        await loadSsoConfigs();
      } catch (err) {
        sso.formError = err?.message || 'Failed to save SSO config.';
      } finally {
        sso.saving = false;
      }
    }

    async function ssoRemoveConfig(cfg) {
      if (!confirm(`Delete SSO config "${cfg.slug}"? Members will lose SSO login access.`)) return;
      try {
        await deleteSsoConfig(workspaceId.value, cfg.id, { baseUrl: accountStore.serverUrl });
        await loadSsoConfigs();
      } catch (err) {
        console.error('[sso] delete failed:', err);
      }
    }

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
        const email = inviteInput.value.trim();
        await admin.addMemberByEmail(inviteInput.value, inviteRole.value);
        inviteSuccess.value = fmt('invitationSent', { email });
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
      if (flags.value.audit) {
        await loadSsoConfigs();
      }
    });

    watch(workspaceId, () => {
      if (flags.value.dashboard) {
        refreshAdmin();
      }
      if (flags.value.audit) {
        loadSsoConfigs();
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
      isEmailVerified,
      verifyTooltip,
      tr,
      fmt,
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
      sso: {
        configs: computed(() => sso.configs),
        loading: computed(() => sso.loading),
        showForm: computed({ get: () => sso.showForm, set: (v) => { sso.showForm = v; } }),
        editingId: computed(() => sso.editingId),
        saving: computed(() => sso.saving),
        formError: computed(() => sso.formError),
        form: sso.form,
        loginUrl: ssoLoginUrl,
        editConfig: ssoEditConfig,
        saveConfig: ssoSaveConfig,
        removeConfig: ssoRemoveConfig,
        cancelForm: resetSsoForm,
      },
    };
  },
};
</script>
