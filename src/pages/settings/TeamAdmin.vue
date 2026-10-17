<template>
  <div class="mb-14 w-full max-w-3xl space-y-6">
    <p class="text-sm font-semibold text-neutral-600 dark:text-neutral-300">
      {{ tr.teamSettings || 'Team settings' }}
    </p>

    <!-- Upgrade gate: the dashboard flag is team/enterprise-only -->
    <section v-if="plansLoaded && !flags.dashboard" class="space-y-2">
      <div
        class="space-y-1 bg-white dark:bg-neutral-950 rounded-xl border px-4 py-6"
      >
        <p class="text-sm font-medium text-neutral-800 dark:text-neutral-200">
          {{ tr.dashboardRequires || 'Team dashboard requires the Team or Enterprise plan' }}
        </p>
        <p class="mt-0.5 text-xs text-neutral-500 dark:text-neutral-400">
          {{ tr.upgradeToManage || 'Upgrade to manage members, devices and sessions for your workspace.' }}
        </p>
        <ui-button class="mt-3" variant="primary" @click="goToUpgrade">
          {{ tr.upgrade || 'Upgrade' }}
        </ui-button>
      </div>
    </section>

    <template v-else>
      <!-- Pending join requests: first thing an admin sees -->
      <section v-if="joinRequests.length" class="space-y-2">
        <p class="text-sm font-semibold text-neutral-600 dark:text-neutral-300">
          {{ tr.pendingRequests || 'Pending requests' }}
        </p>
        <div class="space-y-2 rounded-xl border border-primary/30 bg-primary/10 p-2">
          <p class="px-2 text-xs font-medium text-primary">
            {{ tr.needsAttention || 'Needs your attention' }}
          </p>
          <div
            v-for="req in joinRequests"
            :key="`${req.type}:${req.id}`"
            class="flex flex-col gap-3 rounded-lg border border-neutral-100 bg-white px-3 py-3 dark:border-neutral-800 dark:bg-neutral-950/60 sm:flex-row sm:items-center"
          >
            <div class="flex min-w-0 flex-1 items-center gap-3">
              <ui-user-avatar :name="req.username || req.accountId" :size="32" />
              <div class="min-w-0">
                <p class="text-sm font-medium text-neutral-800 dark:text-neutral-200 truncate">
                  {{ req.username || req.accountId }}
                </p>
                <p class="mt-0.5 text-xs text-neutral-500 dark:text-neutral-400">
                  {{ requestLabel(req) }}
                </p>
              </div>
            </div>
            <div class="flex flex-col gap-2 sm:flex-row">
              <ui-button
                variant="primary"
                class="motion-press max-md:h-11"
                @click="handleApproveRequest(req)"
              >
                {{ tr.approve || 'Approve' }}
              </ui-button>
              <ui-button
                variant="secondary"
                class="motion-press max-md:h-11"
                @click="handleDenyRequest(req)"
              >
                {{ tr.deny || 'Deny' }}
              </ui-button>
            </div>
          </div>
        </div>
      </section>

      <!-- Plan overview -->
      <section class="grid grid-cols-2 gap-2 sm:grid-cols-3">
        <div class="col-span-2 rounded-xl border bg-white px-4 py-3.5 dark:bg-neutral-950 sm:col-span-1">
          <p class="text-sm font-medium text-neutral-800 dark:text-neutral-200">{{ tr.storage || 'Storage' }}</p>
          <p class="mt-0.5 text-xs text-neutral-500 dark:text-neutral-400">{{ quotaGB }} GB pooled</p>
          <div
            class="mt-2.5 h-1.5 w-full overflow-hidden rounded-full bg-neutral-200 dark:bg-neutral-800"
            role="progressbar"
            aria-valuemin="0"
            aria-valuemax="100"
            :aria-valuenow="storagePercent"
          >
            <div
              class="h-full rounded-full bg-primary transition-all duration-300"
              :style="{ width: storagePercent + '%' }"
            ></div>
          </div>
        </div>
        <div class="rounded-xl border bg-white px-4 py-3.5 dark:bg-neutral-950">
          <p class="text-sm font-medium text-neutral-800 dark:text-neutral-200">{{ tr.plan || 'Plan' }}</p>
          <p class="mt-0.5 text-xs capitalize text-neutral-500 dark:text-neutral-400">{{ plan }}</p>
        </div>
        <div class="rounded-xl border bg-white px-4 py-3.5 dark:bg-neutral-950">
          <p class="text-sm font-medium text-neutral-800 dark:text-neutral-200">{{ tr.history || 'History' }}</p>
          <p class="mt-0.5 text-xs text-neutral-500 dark:text-neutral-400">{{ historyLabel }}</p>
        </div>
      </section>

      <!-- Members -->
      <section class="space-y-2">
        <p class="text-sm font-semibold text-neutral-600 dark:text-neutral-300">{{ tr.members || 'Members' }}</p>
        <div class="divide-y divide-neutral-200 rounded-xl border bg-white dark:divide-neutral-800 dark:border-neutral-800 dark:bg-neutral-950">
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
              class="motion-press"
              :disabled="addingMember"
              :title="!isEmailVerified ? verifyTooltip : undefined"
              @click="handleAddMember"
            >
              {{ addingMember ? (tr.inviting || 'Inviting…') : (tr.invite || 'Invite') }}
            </ui-button>
            <ui-button
              variant="secondary"
              class="motion-press"
              :class="inviteLinkCopied ? 'motion-copy-sweep' : ''"
              :disabled="addingMember"
              :title="!isEmailVerified ? verifyTooltip : (tr.copyInviteLink || 'Copy invite link')"
              @click="handleCopyInviteLink"
            >
              <v-remixicon
                :name="inviteLinkCopied ? 'riCheckLine' : 'riFileCopyLine'"
                size="18"
                class="inline-block align-[-3px]"
              />
              {{ tr.copyLink || 'Copy link' }}
            </ui-button>
          </div>
          <p v-if="!isEmailVerified" class="px-4 text-xs text-amber-600 dark:text-amber-400">
            {{ tr.verifyEmailToInvite || 'Please verify your email to invite members.' }}
          </p>
          <p v-if="inviteSuccess" class="px-4 text-xs text-green-600 dark:text-green-400" role="status">
            {{ inviteSuccess }}
          </p>

          <div
            v-for="m in members"
            :key="m.userId"
            class="motion-spring-enter flex items-center gap-3 px-4 py-3.5 transition-colors hover:bg-neutral-50 motion-reduce:transition-none dark:hover:bg-neutral-900"
          >
            <ui-user-avatar :name="memberLabel(m)" :size="32" />
            <div class="min-w-0 flex-1">
              <p
                class="text-sm font-medium text-neutral-800 dark:text-neutral-200 truncate"
                :title="m.userId"
              >
                {{ memberLabel(m) }}
              </p>
              <p class="mt-0.5 text-xs text-neutral-500 dark:text-neutral-400 truncate">
                {{ fmt('roleLabel', { role: displayRole(m.role), count: m.deviceCount }) }}
              </p>
            </div>
            <!-- Static role pill: role selection stays in the tap-to-open sheet,
                 the only place a ui-select changes a member's role. -->
            <span
              v-if="m.userId === currentUserId && m.role === 'owner'"
              class="shrink-0 rounded-full bg-neutral-100 px-2.5 py-1 text-xs font-medium text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300"
            >{{ displayRole(m.role) }}</span>
            <button
              v-else
              type="button"
              class="motion-press shrink-0 rounded-full bg-neutral-100 px-2.5 py-1 text-xs font-medium text-neutral-600 hover:bg-neutral-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-secondary dark:bg-neutral-800 dark:text-neutral-300 dark:hover:bg-neutral-700"
              :aria-label="fmt('roleFor', { user: memberLabel(m) })"
              @click="openMemberSheet(m)"
            >
              {{ displayRole(m.role) }}
              <v-remixicon name="riArrowRightSLine" size="14" class="rtl:rotate-180" />
            </button>
            <ui-button
              icon
              variant="danger"
              class="motion-press"
              :aria-label="fmt('removeUser', { user: memberLabel(m) })"
              @click="handleRemoveMember(m)"
            >
              <v-remixicon name="riDeleteBin6Line" />
            </ui-button>
          </div>
          <p v-if="error" class="px-4 py-3">
            <span class="text-sm text-red-500" role="alert">{{ error }}</span>
          </p>
        </div>

        <ui-modal
          v-model="memberSheet.open"
          :title="memberSheet.member ? memberLabel(memberSheet.member) : ''"
        >
          <div v-if="memberSheet.member" class="space-y-4">
            <ui-select
              :model-value="memberSheet.member.role"
              :label="fmt('roleFor', { user: memberLabel(memberSheet.member) })"
              @change="($event) => handleChangeRole(memberSheet.member.userId, $event)"
            >
              <option value="owner">{{ tr.owner || 'Owner' }}</option>
              <option value="admin">{{ tr.admin || 'Admin' }}</option>
              <option value="editor">{{ tr.editor || 'Editor' }}</option>
              <option value="viewer">{{ tr.viewer || 'Viewer' }}</option>
            </ui-select>
            <ui-button
              variant="danger"
              class="w-full max-md:h-11"
              @click="handleRemoveFromSheet"
            >
              <v-remixicon
                name="riDeleteBin6Line"
                size="18"
                class="inline-block align-[-3px] ltr:mr-1 rtl:ml-1"
              />
              {{ tr.remove || 'Remove' }}
            </ui-button>
          </div>
        </ui-modal>
      </section>

      <!-- Devices & Sessions -->
      <section class="space-y-2">
        <div class="flex items-center justify-between gap-3 rounded-xl border bg-white px-4 py-3.5 dark:bg-neutral-950">
          <div class="min-w-0 flex-1">
            <p class="text-sm font-medium text-neutral-800 dark:text-neutral-200">
              {{ tr.devicesAndSessions || 'Devices & Sessions' }}
            </p>
            <p class="mt-0.5 text-xs text-neutral-500 dark:text-neutral-400">
              {{ devicesSummary }}
            </p>
          </div>
          <ui-button variant="secondary" class="max-md:h-11" @click="toggleDevices">
            {{ showDevices ? (tr.hide || 'Hide') : (tr.review || 'Review') }}
          </ui-button>
        </div>
        <div v-if="showDevices" class="divide-y divide-neutral-200 rounded-xl border bg-white dark:divide-neutral-800 dark:border-neutral-800 dark:bg-neutral-950">
          <div class="flex items-center justify-end px-4 pt-3">
            <ui-button variant="secondary" @click="handleLoadDevices">{{ tr.refresh || 'Refresh' }}</ui-button>
          </div>
          <div
            v-for="s in sessions"
            :key="s.idHash"
            class="motion-spring-enter flex items-center gap-3 px-4 py-3.5 transition-colors hover:bg-neutral-50 motion-reduce:transition-none dark:hover:bg-neutral-900"
          >
            <div class="min-w-0 flex-1">
              <div class="flex items-center gap-2">
                <p class="text-sm font-medium text-neutral-800 dark:text-neutral-200 truncate">
                  {{ s.deviceLabel }}
                </p>
                <span
                  class="inline-flex items-center gap-1 text-xs"
                  :class="isOnline(s.lastSeenAt) ? 'text-emerald-600 dark:text-emerald-400' : 'text-neutral-400 dark:text-neutral-500'"
                >
                  <span
                    class="inline-block h-1.5 w-1.5 rounded-full"
                    :class="isOnline(s.lastSeenAt) ? 'bg-emerald-500' : 'bg-neutral-400 dark:bg-neutral-600'"
                  ></span>
                  {{ isOnline(s.lastSeenAt) ? (tr.online || 'Online') : (tr.offline || 'Offline') }}
                </span>
              </div>
              <p class="mt-0.5 text-xs text-neutral-500 dark:text-neutral-400">
                {{ s.deviceId || (tr.unknownDevice || 'Unknown device') }} · {{ fmt('lastSeen', { time: s.lastSeenAt || (tr.never || 'never') }) }}
              </p>
            </div>
            <ui-button
              icon
              variant="danger"
              class="motion-press"
              :aria-label="fmt('revokeSession', { id: sessionLabel(s) })"
              @click="handleRevoke(s)"
            >
              <v-remixicon name="riShieldKeyholeLine" />
            </ui-button>
          </div>
          <div
            v-for="d in devices"
            :key="d.deviceId"
            class="motion-spring-enter flex items-center gap-3 px-4 py-3.5 transition-colors hover:bg-neutral-50 motion-reduce:transition-none dark:hover:bg-neutral-900"
          >
            <div class="min-w-0 flex-1">
              <div class="flex items-center gap-2">
                <p class="text-sm font-medium text-neutral-800 dark:text-neutral-200 truncate">{{ d.label }}</p>
                <span
                  class="inline-flex items-center gap-1 text-xs"
                  :class="isOnline(d.lastSeen) ? 'text-emerald-600 dark:text-emerald-400' : 'text-neutral-400 dark:text-neutral-500'"
                >
                  <span
                    class="inline-block h-1.5 w-1.5 rounded-full"
                    :class="isOnline(d.lastSeen) ? 'bg-emerald-500' : 'bg-neutral-400 dark:bg-neutral-600'"
                  ></span>
                  {{ isOnline(d.lastSeen) ? (tr.online || 'Online') : (tr.offline || 'Offline') }}
                </span>
              </div>
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
        <div class="space-y-1 bg-white dark:bg-neutral-950 rounded-xl border px-4 py-3.5">
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
              {{ log.createdAt }} · {{ log.action }}
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
            class="text-xs text-primary dark:text-primary-light hover:underline rounded focus-visible:ring-2 focus-visible:ring-secondary"
            @click="sso.showForm = !sso.showForm"
          >
            {{ sso.showForm ? (tr.cancel || 'Cancel') : (tr.addSso || '+ Add SSO') }}
          </button>
        </div>

        <div v-if="!flags.audit" class="space-y-1 bg-white dark:bg-neutral-950 rounded-xl border px-4 py-6">
          <p class="text-sm text-neutral-500 dark:text-neutral-400">
            {{ tr.ssoRequiresEnterprise || 'SSO requires the Enterprise plan.' }}
          </p>
        </div>

        <template v-else>
          <div v-if="sso.loading" class="text-xs text-neutral-500 py-4">{{ tr.ssoLoading || 'Loading…' }}</div>

          <div v-else-if="sso.configs.length === 0 && !sso.showForm" class="space-y-1 bg-white dark:bg-neutral-950 rounded-xl border px-4 py-6">
            <p class="text-sm text-neutral-500 dark:text-neutral-400">
              {{ tr.noSso || 'No SSO configurations yet. Add one to enable single sign-on for your workspace members.' }}
            </p>
          </div>

          <div v-for="cfg in sso.configs" :key="cfg.id" class="bg-white dark:bg-neutral-950 rounded-xl border px-4 py-3.5">
            <div class="flex items-center justify-between">
              <div class="space-y-1">
                <div class="flex items-center gap-2">
                  <span class="text-sm font-medium text-neutral-800 dark:text-neutral-200">{{ cfg.slug }}</span>
                  <span class="text-xs font-semibold px-1.5 py-0.5 rounded bg-neutral-200 dark:bg-neutral-700 text-neutral-600 dark:text-neutral-300">{{ cfg.protocol }}</span>
                </div>
                <p class="text-xs text-neutral-500 dark:text-neutral-400">
                  {{ fmt('loginUrl', { url: sso.loginUrl(cfg) }) }}
                </p>
                <p v-if="cfg.allowedEmailDomains" class="text-xs text-neutral-500 dark:text-neutral-400">
                  {{ fmt('allowedDomains', { domains: cfg.allowedEmailDomains }) }}
                </p>
              </div>
              <div class="flex items-center gap-2">
                <button type="button" class="text-xs text-neutral-500 hover:text-neutral-800 rounded px-1 focus-visible:ring-2 focus-visible:ring-secondary dark:hover:text-neutral-200" @click="sso.editConfig(cfg)">{{ tr.edit || 'Edit' }}</button>
                <button type="button" class="text-xs text-red-500 hover:text-red-700 rounded px-1 focus-visible:ring-2 focus-visible:ring-secondary dark:hover:text-red-400" @click="sso.removeConfig(cfg)">{{ tr.delete || 'Delete' }}</button>
              </div>
            </div>
          </div>

          <!-- Create / Edit form -->
          <div v-if="sso.showForm" class="bg-white dark:bg-neutral-950 rounded-xl border px-4 py-4 space-y-4">
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
              <ui-button variant="primary" :disabled="sso.saving" @click="sso.saveConfig">
                {{ sso.saving ? (tr.saving || 'Saving…') : (sso.editingId ? (tr.update || 'Update') : (tr.create || 'Create')) }}
              </ui-button>
              <button
                type="button"
                class="text-xs text-neutral-500 hover:text-neutral-800 focus-visible:ring-2 focus-visible:ring-secondary rounded dark:hover:text-neutral-200"
                @click="sso.cancelForm"
              >{{ tr.cancel || 'Cancel' }}</button>
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
import { useRouter } from 'vue-router';
import { useAccountStore } from '@/store/account';
import { useWorkspaceStore } from '@/store/workspace';
import { useTeamAdmin } from '@/composable/useTeamAdmin';
import { getPlans } from '@/lib/api/plans';
import { listSsoConfigs, createSsoConfig, updateSsoConfig, deleteSsoConfig } from '@/lib/api/sso';
import { useTranslations } from '@/composable/useTranslations';
import { useDialog } from '@/lib/dialog';
import { useClipboard } from '@/composable/clipboard';
import { roleLabel } from '@/utils/roleLabel';
import { triggerInteractionHaptic } from '@/lib/native/haptics';

export default {
  setup() {
    const accountStore = useAccountStore();
    const workspaceStore = useWorkspaceStore();
    const router = useRouter();
    const { translations } = useTranslations();
    const dialog = useDialog();
    const tr = computed(() => translations.value?.teamAdmin || {});
    function fmt(key, params) {
      const raw = tr.value[key] ?? key;
      if (!params) return raw;
      return Object.entries(params).reduce((s, [k, v]) => s.replace(`{${k}}`, String(v)), raw);
    }
    // Same as fmt, but with an English fallback that still carries the name.
    function copy(key, fallback, params) {
      const raw = tr.value[key] || fallback;
      if (!params) return raw;
      return Object.entries(params).reduce((s, [k, v]) => s.replace(`{${k}}`, String(v)), raw);
    }
    // Never show an admin a bare account UUID, and never a member's email: the
    // server no longer sends it. Prefer the username, keep the raw id only as a
    // tooltip / fallback detail.
    function memberLabel(m) {
      return m?.username || m?.userId;
    }
    function displayRole(role) {
      return roleLabel(role, translations.value);
    }
    function sessionLabel(s) {
      return s?.deviceLabel || s?.deviceId || tr.value.unknownDevice || 'Unknown device';
    }
    // Client-computed presence: Online when lastSeen is within 5 minutes.
    function isOnline(lastSeen) {
      if (!lastSeen) return false;
      const t = new Date(lastSeen).getTime();
      return Number.isFinite(t) && Date.now() - t < 5 * 60 * 1000;
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
        idpCert: cfg.idpCert ? '(exists; leave blank to keep)' : '',
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
      dialog.confirm({
        title: copy('removeSsoTitle', 'Delete SSO config "{slug}"?', { slug: cfg.slug }),
        body: copy('removeSsoBody', 'Members will lose SSO login access.'),
        icon: 'riDeleteBin6Line',
        okText: tr.value.delete || 'Delete',
        cancelText: translations.value?.dialog?.cancel || 'Cancel',
        okVariant: 'danger',
        onConfirm: async () => {
          try {
            await deleteSsoConfig(workspaceId.value, cfg.id, { baseUrl: accountStore.serverUrl });
            await loadSsoConfigs();
          } catch (err) {
            console.error('[sso] delete failed:', err);
          }
        },
      });
    }

    const inviteInput = ref('');
    const inviteRole = ref('editor');
    const addingMember = ref(false);
    const inviteSuccess = ref('');
    const inviteLinkCopied = ref(false);
    const { copyState: inviteCopyState, copyToClipboard } = useClipboard();

    const quotaGB = computed(() => (quotaBytes.value / 1024 ** 3).toFixed(0));
    // Pooled-storage usage comes from the account subscription (owner's org
    // plan); fall back to 0 so the meter never renders a fake number.
    const storagePercent = computed(() => {
      const pct = Number(accountStore.storageUsedPercent);
      if (!Number.isFinite(pct)) return 0;
      return Math.min(100, Math.max(0, pct));
    });
    // Only the figure getPlans actually returns: an em dash when the plan
    // response doesn't state a retention, never a fabricated "Unlimited".
    const historyLabel = computed(() => {
      if (historyDays.value === null) return copy('historyNotSpecified', '—');
      return `${historyDays.value} days`;
    });
    const devicesSummary = computed(() => {
      const d = admin.devices.value?.length || 0;
      const s = admin.sessions.value?.length || 0;
      if (!d && !s) return tr.value.noDevices || 'No devices or active sessions.';
      return copy('devicesSessionsCounts', 'Devices: {devices} · Sessions: {sessions}', {
        devices: d,
        sessions: s,
      });
    });

    // Phones hide the inline role select + remove button; both live in a
    // tap-to-open sheet instead (see openMemberSheet).
    const memberSheet = reactive({ open: false, member: null });
    function openMemberSheet(m) {
      memberSheet.member = m;
      memberSheet.open = true;
    }
    function handleRemoveFromSheet() {
      const m = memberSheet.member;
      memberSheet.open = false;
      if (m) handleRemoveMember(m);
    }

    const showDevices = ref(false);
    function toggleDevices() {
      showDevices.value = !showDevices.value;
    }

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

    // Reuse the Account billing flow, preselecting Team so the gate leads
    // straight to the plan that unlocks this dashboard.
    function goToUpgrade() {
      router.push({ path: '/settings/account', query: { upgrade: 'team' } });
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

    // Adds the member (like Invite) but copies the shareable workspace link
    // instead of relying on an email delivery — the recipient opens the
    // `beaver-notes://join-ws/<token>` deep link to join.
    async function handleCopyInviteLink() {
      inviteSuccess.value = '';
      const identifier = inviteInput.value.trim();
      if (!identifier) {
        admin.error.value = tr.value.enterIdentifier || 'Enter an email or username.';
        return;
      }
      addingMember.value = true;
      try {
        const res = await admin.generateInviteLink(inviteInput.value, inviteRole.value);
        if (!res?.inviteUrl) throw new Error('No invite link returned.');
        await copyToClipboard(res.inviteUrl);
        inviteLinkCopied.value = true;
        inviteSuccess.value = copy('inviteLinkCopied', 'Invite link copied.');
        inviteInput.value = '';
        await admin.loadMembers();
        setTimeout(() => { inviteLinkCopied.value = false; }, 2000);
      } catch (err) {
        admin.error.value = err?.message || 'Failed to create invite link.';
      } finally {
        addingMember.value = false;
      }
    }

    function requestLabel(req) {
      const kind = req.type === 'note'
        ? (tr.value.noteLink || 'Note link')
        : (tr.value.workspace || 'Workspace');
      return `${kind} · ${displayRole(req.role || 'editor')}`;
    }

    async function handleApproveRequest(req) {
      try {
        await admin.approveJoinRequest(req);
      } catch (err) {
        admin.error.value = err?.message || 'Failed to approve request.';
      }
    }

    async function handleDenyRequest(req) {
      try {
        await admin.denyJoinRequest(req);
      } catch (err) {
        admin.error.value = err?.message || 'Failed to deny request.';
      }
    }

    async function handleChangeRole(userId, role) {
      try {
        await admin.changeRole(userId, role);
      } catch (err) {
        admin.error.value = err?.message || 'Failed to change role.';
      }
    }

    function handleRemoveMember(member) {
      const label = memberLabel(member);
      dialog.confirm({
        title: copy('removeMemberTitle', 'Remove {user}?', { user: label }),
        body: copy(
          'removeMemberBody',
          '{user} loses access to this workspace and its shared notes.',
          { user: label },
        ),
        icon: 'riDeleteBin6Line',
        okText: tr.value.remove || 'Remove',
        cancelText: translations.value?.dialog?.cancel || 'Cancel',
        okVariant: 'danger',
        onConfirm: async () => {
          triggerInteractionHaptic('danger');
          try {
            await admin.removeMember(member.userId);
          } catch (err) {
            admin.error.value = err?.message || 'Failed to remove member.';
          }
        },
      });
    }

    function handleRevoke(session) {
      const label = sessionLabel(session);
      dialog.confirm({
        title: copy('revokeSessionTitle', 'Revoke session for {device}?', { device: label }),
        body: copy(
          'revokeSessionBody',
          '{device} is signed out. They can sign in again on that device.',
          { device: label },
        ),
        icon: 'riShieldKeyholeLine',
        okText: tr.value.revoke || 'Revoke',
        cancelText: translations.value?.dialog?.cancel || 'Cancel',
        okVariant: 'danger',
        onConfirm: async () => {
          triggerInteractionHaptic('danger');
          try {
            await admin.revoke(session.idHash);
          } catch (err) {
            admin.error.value = err?.message || 'Failed to revoke session.';
          }
        },
      });
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
      await Promise.allSettled([
        admin.loadMembers(),
        admin.loadDevices(),
        admin.loadJoinRequests(),
      ]);
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
      storagePercent,
      historyLabel,
      devicesSummary,
      memberSheet,
      openMemberSheet,
      handleRemoveFromSheet,
      showDevices,
      toggleDevices,
      plansLoaded,
      currentUserId,
      isEmailVerified,
      verifyTooltip,
      tr,
      fmt,
      memberLabel,
      sessionLabel,
      isOnline,
      displayRole,
      goToUpgrade,
      admin,
      inviteInput,
      inviteRole,
      addingMember,
      inviteSuccess,
      inviteLinkCopied,
      inviteCopyState,
      members: admin.members,
      devices: admin.devices,
      sessions: admin.sessions,
      auditLogs: admin.auditLogs,
      joinRequests: admin.joinRequests,
      error: admin.error,
      requestLabel,
      handleApproveRequest,
      handleDenyRequest,
      handleAddMember,
      handleCopyInviteLink,
      handleChangeRole,
      handleRemoveMember,
      handleRevoke,
      handleLoadDevices,
      handleLoadAudit,
      // Return the reactive directly: a plain object of nested computed refs
      // would not unwrap in the template (render gets the ref object itself,
      // so `sso.configs.length` is undefined and the v-for crashes the page).
      sso: Object.assign(sso, {
        loginUrl: ssoLoginUrl,
        editConfig: ssoEditConfig,
        saveConfig: ssoSaveConfig,
        removeConfig: ssoRemoveConfig,
        cancelForm: resetSsoForm,
      }),
    };
  },
};
</script>
