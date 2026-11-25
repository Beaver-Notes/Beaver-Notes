<template>
  <div class="general mb-14 w-full max-w-xl space-y-6">
    <!-- Workspace overview: shown on every plan, not just team/enterprise. -->
    <settings-group :title="tr.workspace || 'Workspace'">
      <settings-row :label="tr.workspaceName || 'Name'">
        <span class="max-w-[14rem] truncate text-sm text-neutral-600 dark:text-neutral-400">
          {{ workspaceName }}
        </span>
      </settings-row>
      <settings-row :label="tr.yourRole || 'Your role'">
        <span class="text-sm text-neutral-600 dark:text-neutral-400">{{ workspaceRoleLabel }}</span>
      </settings-row>
      <settings-row
        v-if="canCustomizeWorkspace"
        :label="tr.customize || 'Customize'"
        :description="tr.customizeDescription || 'Change the name, icon and color of this workspace.'"
      >
        <ui-button variant="secondary" @click="requestWorkspaceCustomize">
          {{ tr.customize || 'Customize' }}
        </ui-button>
      </settings-row>
    </settings-group>

    <!-- Plan overview: storage, plan and retention apply to every plan. -->
    <section class="grid grid-cols-2 gap-2 sm:grid-cols-3">
      <div class="col-span-2 rounded-2xl border bg-neutral-50 px-4 py-3.5 dark:bg-neutral-900 sm:col-span-1">
        <p class="text-sm font-medium text-neutral-800 dark:text-neutral-200">{{ tr.storage || 'Storage' }}</p>
        <p v-if="quotaLabel" class="mt-0.5 text-xs text-neutral-500 dark:text-neutral-400">{{ quotaLabel }}</p>
        <ui-progress-bar :value="storagePercent" class="mt-2.5" />
      </div>
      <div class="rounded-2xl border bg-neutral-50 px-4 py-3.5 dark:bg-neutral-900">
        <p class="text-sm font-medium text-neutral-800 dark:text-neutral-200">{{ tr.plan || 'Plan' }}</p>
        <p class="mt-0.5 text-xs capitalize text-neutral-500 dark:text-neutral-400">{{ plan }}</p>
      </div>
      <div class="rounded-2xl border bg-neutral-50 px-4 py-3.5 dark:bg-neutral-900">
        <p class="text-sm font-medium text-neutral-800 dark:text-neutral-200">{{ tr.history || 'History' }}</p>
        <p class="mt-0.5 text-xs text-neutral-500 dark:text-neutral-400">{{ historyLabel }}</p>
      </div>
    </section>

    <!-- Upgrade gate: the dashboard flag is team/enterprise-only -->
    <section v-if="plansLoaded && !flags.dashboard" class="space-y-2">
      <div
        class="space-y-1 rounded-2xl border bg-neutral-50 px-4 py-5 dark:bg-neutral-900"
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
        <div class="space-y-2 rounded-2xl border border-primary/30 bg-primary/5 p-2">
          <p class="px-2 text-xs font-medium text-primary">
            {{ tr.needsAttention || 'Needs your attention' }}
          </p>
          <div
            v-for="req in joinRequests"
            :key="`${req.type}:${req.id}`"
            class="flex flex-col gap-3 rounded-xl border border-neutral-200/70 bg-white px-3 py-3 dark:border-neutral-800 dark:bg-neutral-950/60 sm:flex-row sm:items-center"
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

      <!-- Members -->
      <settings-group :title="tr.members || 'Members'">
        <div class="p-3 space-y-2">
            <div class="flex flex-col gap-2 sm:flex-row sm:items-center">
              <ui-input
                v-model="inviteInput"
                class="flex-1"
                :placeholder="tr.emailOrUsername || 'Email or username'"
                :aria-label="tr.emailOrUsername || 'Email or username to invite'"
                @keydown.enter="handleAddMember"
              />
              <ui-select v-model="inviteRole" class="sm:w-32" :aria-label="tr.inviteRole || 'Invite role'">
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
            </div>
            <div class="flex flex-wrap items-center gap-x-3 gap-y-1">
              <button
                type="button"
                class="motion-press inline-flex items-center gap-1 rounded text-xs font-medium text-primary dark:text-primary-light hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-secondary disabled:opacity-50"
                :class="inviteLinkCopied ? 'motion-copy-sweep' : ''"
                :disabled="addingMember"
                :title="!isEmailVerified ? verifyTooltip : (tr.copyInviteLink || 'Copy invite link')"
                :aria-label="tr.copyInviteLink || 'Copy invite link'"
                @click="handleCopyInviteLink"
              >
                <v-remixicon
                  :name="inviteLinkCopied ? 'riCheckLine' : 'riFileCopyLine'"
                  size="14"
                  class="inline-block align-[-2px]"
                />
                {{ inviteLinkCopied ? (tr.copied || 'Link copied') : (tr.copyInviteLink || 'Copy invite link') }}
              </button>
              <p v-if="!isEmailVerified" class="text-xs text-amber-600 dark:text-amber-400">
                {{ tr.verifyEmailToInvite || 'Please verify your email to invite members.' }}
              </p>
              <p v-if="inviteSuccess" class="w-full text-xs text-green-600 dark:text-green-400" role="status">
                {{ inviteSuccess }}
              </p>
            </div>
          </div>

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
            <!-- Role selection is a plain inline select; the raw id stays a
                 tooltip / fallback detail. The owner's own row stays a pill. -->
            <ui-select
              v-if="m.userId !== currentUserId"
              class="w-28 shrink-0"
              :model-value="m.role"
              :aria-label="fmt('roleFor', { user: memberLabel(m) })"
              @change="handleChangeRole(m.userId, $event)"
            >
              <option value="owner">{{ tr.owner || 'Owner' }}</option>
              <option value="admin">{{ tr.admin || 'Admin' }}</option>
              <option value="editor">{{ tr.editor || 'Editor' }}</option>
              <option value="viewer">{{ tr.viewer || 'Viewer' }}</option>
            </ui-select>
            <span
              v-else
              class="shrink-0 rounded-full bg-neutral-100 px-2.5 py-1 text-xs font-medium text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300"
            >{{ displayRole(m.role) }}</span>
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
          <p
            v-if="!members.length"
            class="px-4 py-6 text-sm text-neutral-500 dark:text-neutral-400"
          >
            {{ tr.noMembers || 'No members yet.' }}
          </p>
          <p v-if="error" class="px-4 py-3">
            <span class="text-sm text-red-500" role="alert">{{ error }}</span>
          </p>
      </settings-group>

      <!-- Devices & Sessions -->
      <settings-group :title="tr.devicesAndSessions || 'Devices & Sessions'">
        <div class="flex items-center justify-between gap-3 px-4 py-3.5">
          <p class="min-w-0 flex-1 text-xs text-neutral-500 dark:text-neutral-400">
            {{ devicesSummary }}
          </p>
          <ui-button variant="secondary" @click="toggleDevices">
            {{ showDevices ? (tr.hide || 'Hide') : (tr.review || 'Review') }}
          </ui-button>
        </div>
        <template v-if="showDevices">
          <div class="flex items-center justify-end px-4 pt-3">
            <ui-button variant="secondary" @click="handleLoadDevices">{{ tr.refresh || 'Refresh' }}</ui-button>
          </div>
          <div
            v-for="s in sessions"
            :key="s.idHash"
            class="motion-spring-enter flex items-center gap-3 px-4 py-3.5 transition-colors hover:bg-neutral-50 motion-reduce:transition-none dark:hover:bg-neutral-900"
          >
            <div class="min-w-0 flex-1">
              <p class="text-sm font-medium text-neutral-800 dark:text-neutral-200 truncate">
                {{ sessionLabel(s) }}
                <span
                  v-if="s.deviceId && s.deviceId === thisDeviceId"
                  class="ml-1 rounded-full bg-primary/10 px-1.5 py-0.5 text-[11px] font-normal text-primary"
                >{{ tr.thisDevice || 'This device' }}</span>
              </p>
              <p class="mt-0.5 text-xs text-neutral-500 dark:text-neutral-400">
                {{ platformLabel(s) }} · {{ seenLabel(s.lastSeenAt) }}
              </p>
            </div>
            <ui-button
              icon
              variant="danger"
              class="motion-press"
              :aria-label="fmt('revokeSession', { id: sessionLabel(s) })"
              :title="s.deviceId || undefined"
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
              <p class="text-sm font-medium text-neutral-800 dark:text-neutral-200 truncate">
                {{ deviceName(d) }}
                <span
                  v-if="d.deviceId === thisDeviceId"
                  class="ml-1 rounded-full bg-primary/10 px-1.5 py-0.5 text-[11px] font-normal text-primary"
                >{{ tr.thisDevice || 'This device' }}</span>
              </p>
              <p class="mt-0.5 text-xs text-neutral-500 dark:text-neutral-400">
                {{ platformLabel(d) }} · {{ seenLabel(d.lastSeen) }}
              </p>
            </div>
          </div>
          <p v-if="devices.length === 0 && sessions.length === 0" class="px-4 py-3">
            <span class="text-xs text-neutral-500 dark:text-neutral-400">{{ tr.noDevices || 'No devices or active sessions.' }}</span>
          </p>
        </template>
      </settings-group>

      <!-- Audit (Enterprise only — the section is hidden, not gated with a card) -->
      <settings-group v-if="flags.audit" :title="tr.auditLogs || 'Audit logs'">
        <div class="flex items-center justify-end px-4 py-3">
          <ui-button variant="secondary" @click="handleLoadAudit">{{ tr.load || 'Load' }}</ui-button>
        </div>
        <ul v-if="auditLogs.length > 0" class="space-y-1 px-4 py-3">
          <li
            v-for="log in auditLogs"
            :key="log.id"
            class="break-words text-xs text-neutral-500 dark:text-neutral-400"
          >
            {{ log.createdAt }} · {{ log.action }}
          </li>
        </ul>
      </settings-group>

      <!-- SSO (Enterprise only — hidden otherwise) -->
      <section v-if="flags.audit" class="space-y-2">
        <div class="flex items-center justify-between gap-3 px-1">
          <p class="text-sm font-semibold text-neutral-600 dark:text-neutral-300">{{ tr.sso || 'Single Sign-On (SSO)' }}</p>
          <ui-button variant="secondary" @click="sso.showForm = !sso.showForm">
            {{ sso.showForm ? (tr.cancel || 'Cancel') : (tr.addSso || 'Add SSO') }}
          </ui-button>
        </div>

        <template>
          <div v-if="sso.loading" class="px-1 text-xs text-neutral-500">{{ tr.ssoLoading || 'Loading…' }}</div>

          <div v-else-if="sso.configs.length === 0 && !sso.showForm" class="space-y-1 rounded-2xl border bg-neutral-50 px-4 py-6 dark:bg-neutral-900">
            <p class="text-sm text-neutral-500 dark:text-neutral-400">
              {{ tr.noSso || 'No SSO configurations yet. Add one to enable single sign-on for your workspace members.' }}
            </p>
          </div>

          <div v-for="cfg in sso.configs" :key="cfg.id" class="rounded-2xl border bg-neutral-50 px-4 py-3.5 dark:bg-neutral-900">
            <div class="flex items-start justify-between gap-3">
              <div class="min-w-0 space-y-1">
                <div class="flex flex-wrap items-center gap-2">
                  <span class="break-all text-sm font-medium text-neutral-800 dark:text-neutral-200">{{ cfg.slug }}</span>
                  <span class="rounded bg-neutral-200 px-1.5 py-0.5 text-xs font-semibold text-neutral-600 dark:bg-neutral-700 dark:text-neutral-300">{{ cfg.protocol }}</span>
                </div>
                <p class="break-all text-xs text-neutral-500 dark:text-neutral-400">
                  {{ fmt('loginUrl', { url: sso.loginUrl(cfg) }) }}
                </p>
                <p v-if="cfg.allowedEmailDomains" class="break-words text-xs text-neutral-500 dark:text-neutral-400">
                  {{ fmt('allowedDomains', { domains: cfg.allowedEmailDomains }) }}
                </p>
              </div>
              <div class="flex shrink-0 items-center gap-1">
                <ui-button icon :aria-label="tr.edit || 'Edit'" @click="sso.editConfig(cfg)">
                  <v-remixicon name="riEditLine" />
                </ui-button>
                <ui-button icon variant="danger" :aria-label="tr.delete || 'Delete'" @click="sso.removeConfig(cfg)">
                  <v-remixicon name="riDeleteBin6Line" />
                </ui-button>
              </div>
            </div>
          </div>

          <!-- Create / Edit form -->
          <div v-if="sso.showForm" class="space-y-4 rounded-2xl border bg-neutral-50 px-4 py-4 dark:bg-neutral-900">
            <p class="text-sm font-medium text-neutral-800 dark:text-neutral-200">
              {{ sso.editingId ? (tr.editSso || 'Edit SSO Configuration') : (tr.newSso || 'New SSO Configuration') }}
            </p>
            <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
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

            <div class="flex flex-wrap items-center gap-3">
              <ui-button variant="primary" :disabled="sso.saving" @click="sso.saveConfig">
                {{ sso.saving ? (tr.saving || 'Saving…') : (sso.editingId ? (tr.update || 'Update') : (tr.create || 'Create')) }}
              </ui-button>
              <ui-button variant="secondary" @click="sso.cancelForm">{{ tr.cancel || 'Cancel' }}</ui-button>
              <p v-if="sso.formError" class="text-xs text-red-500">{{ sso.formError }}</p>
            </div>
          </div>
        </template>
      </section>
    </template>

    <!-- Dev-only data switch (break-ui). `isDevData` is `import.meta.env.DEV`,
         so this control never renders in a production build. -->
    <div
      v-if="isDevData"
      class="fixed bottom-4 left-1/2 z-[60] flex -translate-x-1/2 gap-1 rounded-full border border-neutral-300 bg-neutral-100 p-1 shadow-sm [font-family:system-ui] text-xs dark:border-neutral-700 dark:bg-neutral-800"
      role="group"
      aria-label="Demo data"
    >
      <button
        v-for="m in devModes"
        :key="m"
        type="button"
        class="rounded-full px-2.5 py-1"
        :class="devDataMode === m
          ? 'bg-white text-neutral-900 shadow dark:bg-neutral-950 dark:text-neutral-100'
          : 'text-neutral-600 dark:text-neutral-300'"
        @click="setDevData(m)"
      >{{ m }}</button>
    </div>
  </div>
</template>

<script>
import { ref, reactive, computed, onMounted, watch } from 'vue';
import { useRouter } from 'vue-router';
import emitter from 'tiny-emitter/instance';
import { useAccountStore } from '@/store/account';
import { useWorkspaceStore } from '@/store/workspace';
import { useTeamAdmin } from '@/composable/useTeamAdmin';
import { getPlans } from '@/lib/api/plans';
import { listSsoConfigs, createSsoConfig, updateSsoConfig, deleteSsoConfig } from '@/lib/api/sso';
import { useTranslations } from '@/composable/useTranslations';
import { useDialog } from '@/lib/dialog';
import { useClipboard } from '@/composable/clipboard';
import { roleLabel } from '@/utils/roleLabel';
import SettingsGroup from '@/components/settings/SettingsGroup.vue';
import SettingsRow from '@/components/settings/SettingsRow.vue';
import { deviceDisplayName, devicePlatform } from '@/utils/device/device-label';
import { getSyncDeviceId } from '@/utils/sync/sync-repository';
import { triggerInteractionHaptic } from '@/lib/native/haptics';

export default {
  components: { SettingsGroup },
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
      return s ? deviceDisplayName(s) || tr.value.unknownDevice || 'Unknown device' : 'Unknown device';
    }
    // Presence is only claimed where the server actually bumps a timestamp on
    // activity (auth sessions); device rows show relative last-seen instead of
    // pretending an Online/Offline verdict, and raw ids stay in tooltips.
    function deviceName(d) {
      return d ? deviceDisplayName(d) || tr.value.unknownDevice || 'Unknown device' : 'Unknown device';
    }
    function platformLabel(row) {
      const platform = devicePlatform(row);
      return platform ? platform[0].toUpperCase() + platform.slice(1) : '';
    }
    // Relative "last seen" — minutes/hours/days, then the raw timestamp.
    function seenLabel(lastSeen) {
      const t = lastSeen ? new Date(lastSeen).getTime() : NaN;
      if (!Number.isFinite(t)) return tr.value.never || 'never';
      const diff = Date.now() - t;
      if (diff < 60 * 1000) return tr.value.seenJustNow || 'just now';
      if (diff < 60 * 60 * 1000) {
        const n = Math.floor(diff / (60 * 1000));
        return (tr.value.seenMinutes || '{n} min ago').replace('{n}', n);
      }
      if (diff < 24 * 60 * 60 * 1000) {
        const n = Math.floor(diff / (60 * 60 * 1000));
        return (tr.value.seenHours || '{n} h ago').replace('{n}', n);
      }
      if (diff < 7 * 24 * 60 * 60 * 1000) {
        const n = Math.floor(diff / (24 * 60 * 60 * 1000));
        return (tr.value.seenDays || '{n} d ago').replace('{n}', n);
      }
      return new Date(t).toLocaleDateString();
    }
    // The id this very install reports to the sync server, for the
    // "This device" badge (async — resolved in onMounted).
    const thisDeviceId = ref(null);

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

    // Dev-only data switch (break-ui). The segmented control, every fixture
    // value and its wiring live inside this `import.meta.env.DEV` block: Vite
    // replaces the flag with `false` and strips all of it from production
    // builds, leaving only the inert stubs below. Fixture values enter through
    // the same refs the API loaders write (admin.*, plan, flags, sso), so the
    // template never knows the difference.
    const isDevData = import.meta.env.DEV;
    const devModes = ['Demo', 'Worst case', 'Empty', 'One', '1,000 rows'];
    const devDataMode = ref(null); // active fixture label; null = live API data
    let applyDevFixture = () => {};
    let setDevData = () => {};
    if (import.meta.env.DEV) {
      const DEV_PARAM = {
        Demo: 'demo',
        'Worst case': 'worst',
        Empty: 'empty',
        One: 'one',
        '1,000 rows': 'huge',
      };
      const DEV_LABEL = Object.fromEntries(
        Object.entries(DEV_PARAM).map(([label, param]) => [param, label]),
      );

      function devReadLabel() {
        const query = window.location.hash.split('?')[1] || '';
        return DEV_LABEL[new URLSearchParams(query).get('data')] || null;
      }

      function devWriteLabel(label) {
        const base = window.location.hash.split('?')[0];
        // replaceState, not `location.hash =`: this is a hash-mode router, so
        // assigning the hash navigates. App.vue keys the route component on
        // `fullPath` (useAppShell.js:513), so a new query string destroys and
        // remounts the whole settings page — the fixture click looked slow.
        window.history.replaceState(
          null,
          '',
          label ? `${base}?data=${DEV_PARAM[label]}` : base,
        );
      }

      const devUuid = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
      const devAnonId = '9f8e7d6c-5b4a-4c3d-8e2f-1a0b9c8d7e6f';
      // Longest a device/session label can be: the server slices the
      // x-device-label request header to 128 chars, and the header is
      // free-form client data (Beaver-Sync src/middleware/auth.js:52).
      const devLongLabel =
        'Samsung Galaxy S25 Ultra SM-S938B — Diensthandy Aleksandra Wiśniewska-Kowalczyk, München HQ';
      const devNow = Date.now();
      const devIso = (msAgo) => new Date(devNow - msAgo).toISOString();

      // Plan figures come straight from Beaver-Sync src/lib/plans.js: team is
      // 100GB + 25GB×seats (125GB at the default seat), enterprise quota is
      // literally Number.MAX_SAFE_INTEGER and historyDays is null ("—").
      const devPlanKind = {
        plan: 'team',
        flags: { dashboard: true, audit: true },
        quotaBytes: 125 * 1024 ** 3,
        historyDays: 365,
      };
      const devPlanWorst = {
        plan: 'enterprise',
        flags: { dashboard: true, audit: true },
        quotaBytes: Number.MAX_SAFE_INTEGER,
        historyDays: null,
      };

      const devMember = (n, username, role, deviceCount, extra = {}) => ({
        userId: devUuid(n),
        username,
        role,
        deviceCount,
        lastSeen: null,
        createdAt: devIso(8e8),
        ...extra,
      });

      const devDemoRows = (ownerId) => ({
        members: [
          { userId: ownerId, username: 'jamie', role: 'owner', deviceCount: 1, lastSeen: null, createdAt: devIso(9e8) },
          devMember(3, 'alice', 'admin', 2, { lastSeen: devIso(6e5) }),
          devMember(4, 'bob-the-builder', 'editor', 5, { lastSeen: devIso(36e5) }),
        ],
        requests: [
          { type: 'workspace', id: 'req-1', workspaceId: 'ws-1', accountId: devUuid(1), username: 'ines', role: 'viewer', createdAt: devIso(36e5) },
          { type: 'note', id: 'req-2', noteId: 'note-1', accountId: devUuid(2), username: 'carl', role: 'editor', createdAt: devIso(72e5) },
        ],
        devices: [
          { userId: devUuid(3), deviceId: 'dev-a', label: 'Safari on macOS', lastSeen: devIso(6e5), createdAt: devIso(8e8) },
          { userId: devUuid(4), deviceId: 'dev-b', label: 'Chrome on Windows', lastSeen: devIso(36e5), createdAt: devIso(7e8) },
        ],
        sessions: [
          { userId: devUuid(3), idHash: 'hash-a', deviceLabel: 'Safari on macOS', deviceId: 'dev-a', ipSubnet: '192.168.1.0/24', lastSeenAt: devIso(6e5), revoked: false, createdAt: devIso(8e8) },
          { userId: devUuid(4), idHash: 'hash-b', deviceLabel: 'Chrome on Windows', deviceId: 'dev-b', ipSubnet: '10.0.0.0/8', lastSeenAt: devIso(36e5), revoked: false, createdAt: devIso(7e8) },
        ],
        logs: [
          { id: 'log-1', createdAt: devIso(9e5), action: 'member_added' },
          { id: 'log-2', createdAt: devIso(18e5), action: 'login' },
          { id: 'log-3', createdAt: devIso(27e5), action: 'note_edited' },
        ],
        configs: [
          { id: 'sso-1', protocol: 'saml', slug: 'acme', allowedEmailDomains: 'example.com' },
        ],
      });

      // One worst-case dataset, failures spread across rows: long hyphenated
      // username (schema max 32, /^[a-zA-Z0-9_-]{3,32}$/ — account.js:20),
      // null username falling back to a bare UUID, the 3-char minimum name,
      // every deviceCount from 0 up, and label/session worst cases below.
      const devWorstRows = (ownerId) => ({
        members: [
          { userId: ownerId, username: 'a-wisniewska-kowalczyk', role: 'owner', deviceCount: 1, lastSeen: null, createdAt: devIso(9e8) },
          devMember(2, null, 'admin', 47, { userId: devAnonId }),
          devMember(3, 'jay', 'viewer', 0),
          devMember(4, 'bartholomew-fitzgerald', 'editor', 12),
          devMember(5, 'sean-obrien-osulleabhain', 'editor', 3),
          devMember(6, 'wang-xiuying', 'viewer', 1),
          devMember(7, 'dana', 'admin', 2),
          devMember(8, 'northwind-onboarding-lead', 'editor', 9),
        ],
        requests: [
          { type: 'workspace', id: 'req-1', workspaceId: 'ws-1', accountId: devUuid(1), username: 'a-wisniewska-kowalczyk', role: 'admin', createdAt: devIso(36e5) },
          { type: 'note', id: 'req-2', noteId: 'note-1', accountId: devAnonId, username: null, role: 'editor', createdAt: devIso(72e5) },
          { type: 'workspace', id: 'req-3', workspaceId: 'ws-1', accountId: devUuid(9), username: 'jay', role: 'viewer', createdAt: devIso(108e5) },
        ],
        devices: [
          { userId: devUuid(4), deviceId: 'dev-c', label: 'Dell U2723QE — Docking-Station Berlin HQ, Etage 3, Platz 17', lastSeen: devIso(1728e5), createdAt: devIso(8e8) },
          { userId: devUuid(2), deviceId: 'dev-d', label: devLongLabel, lastSeen: null, createdAt: devIso(7e8) },
        ],
        sessions: [
          { userId: devUuid(2), idHash: 'hash-x', deviceLabel: devLongLabel, deviceId: 'dev-d', ipSubnet: '2001:db8:85a3:0:0:8a2e:370:7334', lastSeenAt: devIso(45e3), revoked: false, createdAt: devIso(8e8) },
          { userId: devUuid(3), idHash: 'hash-y', deviceLabel: 'J', deviceId: null, ipSubnet: null, lastSeenAt: null, revoked: false, createdAt: devIso(7e8) },
          { userId: devUuid(5), idHash: 'hash-z', deviceLabel: 'Safari on macOS', deviceId: 'dev-e', ipSubnet: '192.168.1.0/24', lastSeenAt: devIso(7776e5), revoked: false, createdAt: devIso(6e8) },
        ],
        logs: [
          { id: 'log-1', createdAt: devIso(6e4), action: 'account_vault_key_params_published' },
          { id: 'log-2', createdAt: devIso(12e4), action: 'workspace_key_provisioned' },
          { id: 'log-3', createdAt: devIso(18e4), action: 'yjs_push_batch' },
          { id: 'log-4', createdAt: devIso(24e4), action: 'verification_email_requested' },
          { id: 'log-5', createdAt: devIso(3e5), action: 'member_removed' },
          { id: 'log-6', createdAt: devIso(36e4), action: 'password_reset_complete' },
          { id: 'log-7', createdAt: devIso(42e4), action: 'note_preclaim_purged' },
          { id: 'log-8', createdAt: devIso(48e4), action: 'kem_keypair_updated' },
        ],
        // slug: /^[a-z0-9-]+$/ with no max length (sso-admin.js:131);
        // allowedEmailDomains is an unbounded comma-separated string.
        configs: [
          {
            id: 'sso-1',
            protocol: 'saml',
            slug: 'northwind-industries-holdings-sso',
            idpEntityId: 'https://idp.northwind-industries-holdings.example.com/metadata/enterprise/saml/v2',
            allowedEmailDomains:
              'northwind-industries-holdings.example.com, sub.department.region.example.co.uk, internal.northwind-industries-holdings.example.com',
          },
        ],
      });

      // 1,284 members: no seat cap is armed until billing provisions seats
      // (Beaver-Sync organizations.js:495-501) and the admin members endpoint
      // is unpaginated (admin.js:65), so this is a reachable upper bound.
      const devHugeMembers = (ownerId) => {
        const roles = ['admin', 'editor', 'viewer'];
        const rows = [{
          userId: ownerId,
          username: 'a-wisniewska-kowalczyk',
          role: 'owner',
          deviceCount: 1,
          lastSeen: null,
          createdAt: devIso(9e8),
        }];
        for (let i = 1; i < 1284; i += 1) {
          rows.push(devMember(
            i + 10,
            i % 100 === 7 ? `a-wisniewska-kowalczyk-${i}` : `member-${String(i).padStart(4, '0')}`,
            roles[i % 3],
            i % 7,
            { lastSeen: i % 5 === 0 ? null : devIso(i * 6e4) },
          ));
        }
        return rows;
      };

      function devFixture(label, ownerId, thisDeviceId) {
        const isWorst = label === 'Worst case' || label === '1,000 rows';
        const plan = isWorst ? devPlanWorst : devPlanKind;
        const demo = devDemoRows(ownerId);
        const worst = devWorstRows(ownerId);
        let rows;
        if (label === 'Empty') {
          rows = { members: [], requests: [], devices: [], sessions: [], logs: [], configs: [] };
        } else if (label === 'One') {
          rows = Object.fromEntries(
            Object.entries(demo).map(([key, list]) => [key, list.slice(0, 1)]),
          );
        } else if (label === '1,000 rows') {
          rows = { ...worst, members: devHugeMembers(ownerId) };
        } else if (label === 'Worst case') {
          rows = worst;
        } else {
          rows = demo;
        }
        const sessions = rows.sessions.map((s, i) =>
          (i === 0 && thisDeviceId ? { ...s, deviceId: thisDeviceId } : s),
        );
        return { ...plan, ...rows, sessions };
      }

      applyDevFixture = () => {
        const label = devDataMode.value;
        if (!label) return;
        const fx = devFixture(label, currentUserId.value || devUuid(1), thisDeviceId.value);
        admin.members.value = fx.members;
        admin.devices.value = fx.devices;
        admin.sessions.value = fx.sessions;
        admin.auditLogs.value = fx.logs;
        admin.joinRequests.value = fx.requests;
        sso.configs = fx.configs;
        plan.value = fx.plan;
        flags.value = fx.flags;
        quotaBytes.value = fx.quotaBytes;
        historyDays.value = fx.historyDays;
        plansLoaded.value = true;
        admin.error.value = '';
      };

      setDevData = (label) => {
        devDataMode.value = label;
        devWriteLabel(label);
        applyDevFixture();
      };

      devDataMode.value = devReadLabel();
    }

    async function loadSsoConfigs() {
      if (devDataMode.value) { applyDevFixture(); return; }
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
    const { copyToClipboard } = useClipboard();

    // Enterprise quota is Number.MAX_SAFE_INTEGER on the server; printing it
    // as a GB figure would claim 8,388,608 GB, so it reads as unlimited.
    const quotaLabel = computed(() => {
      if (quotaBytes.value >= Number.MAX_SAFE_INTEGER) {
        return copy('unlimited', 'Unlimited');
      }
      if (!quotaBytes.value) return '';
      return `${(quotaBytes.value / 1024 ** 3).toFixed(0)} GB pooled`;
    });
    // Workspace identity is local data: shown on every plan, from the store
    // the switcher already keeps in sync.
    const workspace = computed(() => workspaceStore.activeWorkspace || null);
    const workspaceName = computed(
      () => workspace.value?.name || tr.value.unknownWorkspace || '—',
    );
    const workspaceRoleLabel = computed(() => {
      const ws = workspace.value;
      if (!ws) return '—';
      if (ws.local) return tr.value.localWorkspace || 'On this device';
      return ws.role ? displayRole(ws.role) : '—';
    });
    // Same rule as the switcher: the device holder owns a local workspace.
    const canCustomizeWorkspace = computed(() => {
      const ws = workspace.value;
      if (!ws) return false;
      return ws.local || ws.role === 'owner' || ws.role === 'admin';
    });
    // The workspace switcher owns the customize dialog; asking for it there
    // keeps one implementation of the local/cloud save paths.
    function requestWorkspaceCustomize() {
      if (workspace.value) emitter.emit('customize-workspace', workspace.value.id);
    }
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

    const showDevices = ref(false);
    function toggleDevices() {
      showDevices.value = !showDevices.value;
    }

    async function loadPlans() {
      if (devDataMode.value) { applyDevFixture(); return; }
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
      if (!import.meta.env.DEV) return;
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
      if (devDataMode.value) { applyDevFixture(); return; }
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
      try {
        thisDeviceId.value = await getSyncDeviceId();
      } catch { /* badge only — absence hides it */ }
      // Re-apply so the fixture's first session can carry the real device id
      // and the "This device" badge has something to match against.
      if (devDataMode.value) applyDevFixture();
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
      storagePercent,
      historyLabel,
      devicesSummary,
      thisDeviceId,
      deviceName,
      platformLabel,
      seenLabel,
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
      displayRole,
      goToUpgrade,
      admin,
      inviteInput,
      inviteRole,
      addingMember,
      inviteSuccess,
      inviteLinkCopied,
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
      isDevData,
      devModes,
      devDataMode,
      setDevData,
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
