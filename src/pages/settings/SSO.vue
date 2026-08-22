<template>
  <div class="mb-14 w-full max-w-3xl space-y-6">
    <p class="text-sm font-semibold text-neutral-600 dark:text-neutral-300">
      Single Sign-On (SSO)
    </p>

    <section v-if="!isEnterprise" class="space-y-2">
      <div class="space-y-1 bg-neutral-50 dark:bg-neutral-900 rounded-xl border px-4 py-6">
        <p class="text-sm font-medium text-neutral-800 dark:text-neutral-200">
          SSO requires the Enterprise plan
        </p>
        <p class="mt-0.5 text-xs text-neutral-500 dark:text-neutral-400">
          Upgrade to configure SAML or OIDC single sign-on for your workspace.
        </p>
      </div>
    </section>

    <template v-else>
      <!-- Existing configs -->
      <section class="space-y-2">
        <div class="flex items-center justify-between">
          <p class="text-sm font-semibold text-neutral-600 dark:text-neutral-300">
            Configurations
          </p>
          <button
            class="text-xs text-primary dark:text-primary-light hover:underline"
            @click="showForm = !showForm"
          >
            {{ showForm ? 'Cancel' : '+ Add SSO' }}
          </button>
        </div>

        <div v-if="loading" class="text-xs text-neutral-500 py-4">Loading…</div>

        <div v-else-if="configs.length === 0 && !showForm" class="space-y-1 bg-neutral-50 dark:bg-neutral-900 rounded-xl border px-4 py-6">
          <p class="text-sm text-neutral-500 dark:text-neutral-400">
            No SSO configurations yet. Add one to enable single sign-on for your workspace members.
          </p>
        </div>

        <div v-for="cfg in configs" :key="cfg.id" class="bg-neutral-50 dark:bg-neutral-900 rounded-xl border px-4 py-3.5">
          <div class="flex items-center justify-between">
            <div class="space-y-1">
              <div class="flex items-center gap-2">
                <span class="text-sm font-medium text-neutral-800 dark:text-neutral-200">
                  {{ cfg.slug }}
                </span>
                <span class="text-[10px] uppercase font-semibold px-1.5 py-0.5 rounded bg-neutral-200 dark:bg-neutral-700 text-neutral-600 dark:text-neutral-300">
                  {{ cfg.protocol }}
                </span>
              </div>
              <p class="text-xs text-neutral-500 dark:text-neutral-400">
                Login URL: {{ loginUrl(cfg) }}
              </p>
              <p v-if="cfg.allowedEmailDomains" class="text-xs text-neutral-500 dark:text-neutral-400">
                Allowed domains: {{ cfg.allowedEmailDomains }}
              </p>
            </div>
            <div class="flex items-center gap-2">
              <button
                class="text-xs text-neutral-500 hover:text-neutral-800 dark:hover:text-neutral-200"
                @click="editConfig(cfg)"
              >
                Edit
              </button>
              <button
                class="text-xs text-red-500 hover:text-red-700 dark:hover:text-red-400"
                @click="removeConfig(cfg)"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      </section>

      <!-- Create / Edit form -->
      <section v-if="showForm" class="space-y-2">
        <p class="text-sm font-semibold text-neutral-600 dark:text-neutral-300">
          {{ editingId ? 'Edit' : 'New' }} SSO Configuration
        </p>
        <div class="bg-neutral-50 dark:bg-neutral-900 rounded-xl border px-4 py-4 space-y-4">
          <div class="grid grid-cols-2 gap-4">
            <ui-select v-model="form.protocol" label="Protocol">
              <option value="saml">SAML 2.0</option>
              <option value="oidc">OpenID Connect</option>
            </ui-select>
            <ui-input v-model="form.slug" label="Slug" placeholder="my-company" />
          </div>

          <ui-input
            v-model="form.allowedEmailDomains"
            label="Allowed email domains (comma-separated)"
            placeholder="example.com, company.org"
          />

          <!-- SAML fields -->
          <template v-if="form.protocol === 'saml'">
            <ui-input v-model="form.idpEntityId" label="IdP Entity ID" placeholder="https://idp.example.com/metadata" />
            <ui-input v-model="form.idpSsoUrl" label="IdP SSO URL" placeholder="https://idp.example.com/sso/saml" />
            <ui-input v-model="form.idpCert" label="IdP Certificate (PEM)" type="textarea" :rows="4" placeholder="-----BEGIN CERTIFICATE-----\n…\n-----END CERTIFICATE-----" />
            <ui-input v-model="form.spCert" label="SP Certificate (PEM, optional)" type="textarea" :rows="4" placeholder="Leave empty to auto-generate" />
            <ui-input v-model="form.spPrivateKey" label="SP Private Key (PEM, optional)" type="textarea" :rows="4" placeholder="Leave empty to auto-generate" />
          </template>

          <!-- OIDC fields -->
          <template v-if="form.protocol === 'oidc'">
            <ui-input v-model="form.oidcIssuer" label="OIDC Issuer URL" placeholder="https://accounts.example.com" />
            <ui-input v-model="form.oidcClientId" label="Client ID" />
            <ui-input v-model="form.oidcClientSecret" label="Client Secret" type="password" />
          </template>

          <div class="flex items-center gap-3">
            <button
              class="ui-button py-2 text-sm px-4 rounded-lg"
              :disabled="saving"
              @click="saveConfig"
            >
              {{ saving ? 'Saving…' : (editingId ? 'Update' : 'Create') }}
            </button>
            <button
              class="text-xs text-neutral-500 hover:text-neutral-800 dark:hover:text-neutral-200"
              @click="cancelForm"
            >
              Cancel
            </button>
            <p v-if="formError" class="text-xs text-red-500">{{ formError }}</p>
          </div>
        </div>
      </section>
    </template>
  </div>
</template>

<script>
import { ref, reactive, onMounted, computed } from 'vue';
import { useAccountStore } from '@/store/account';
import { useWorkspaceStore } from '@/store/workspace';
import {
  listSsoConfigs,
  createSsoConfig,
  updateSsoConfig,
  deleteSsoConfig,
} from '@/lib/api/sso';
import { getPlans } from '@/lib/api/plans';

export default {
  setup() {
    const accountStore = useAccountStore();
    const workspaceStore = useWorkspaceStore();

    const workspaceId = computed(
      () => workspaceStore.activeId || accountStore.activeWorkspaceId || null,
    );

    const isEnterprise = ref(false);
    const configs = ref([]);
    const loading = ref(false);
    const showForm = ref(false);
    const editingId = ref(null);
    const saving = ref(false);
    const formError = ref('');

    const defaultForm = () => ({
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
    });

    const form = reactive(defaultForm());

    const baseUrl = computed(() => accountStore.serverUrl);

    async function loadConfigs() {
      if (!workspaceId.value) return;
      loading.value = true;
      try {
        configs.value = await listSsoConfigs(workspaceId.value, { baseUrl: baseUrl.value });
      } catch (err) {
        console.error('[sso] load failed:', err);
      } finally {
        loading.value = false;
      }
    }

    async function loadPlan() {
      try {
        const plans = await getPlans({ baseUrl: baseUrl.value });
        isEnterprise.value = plans?.flags?.audit ?? false;
      } catch {
        isEnterprise.value = false;
      }
    }

    function loginUrl(cfg) {
      const host = baseUrl.value || window.location.origin;
      return `${host}/auth/sso/${cfg.slug}/login`;
    }

    function editConfig(cfg) {
      editingId.value = cfg.id;
      Object.assign(form, {
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
      showForm.value = true;
    }

    async function saveConfig() {
      formError.value = '';
      if (!form.slug) {
        formError.value = 'Slug is required.';
        return;
      }
      saving.value = true;
      try {
        const payload = { ...form };
        Object.keys(payload).forEach((k) => {
          if (payload[k] === '' || payload[k] === null) delete payload[k];
        });

        if (editingId.value) {
          await updateSsoConfig(workspaceId.value, editingId.value, payload, { baseUrl: baseUrl.value });
        } else {
          await createSsoConfig(workspaceId.value, payload, { baseUrl: baseUrl.value });
        }
        cancelForm();
        await loadConfigs();
      } catch (err) {
        formError.value = err?.message || 'Failed to save SSO config.';
      } finally {
        saving.value = false;
      }
    }

    async function removeConfig(cfg) {
      if (!confirm(`Delete SSO config "${cfg.slug}"? Members will lose SSO login access.`)) return;
      try {
        await deleteSsoConfig(workspaceId.value, cfg.id, { baseUrl: baseUrl.value });
        await loadConfigs();
      } catch (err) {
        console.error('[sso] delete failed:', err);
      }
    }

    function cancelForm() {
      showForm.value = false;
      editingId.value = null;
      formError.value = '';
      Object.assign(form, defaultForm());
    }

    onMounted(() => {
      loadPlan();
      loadConfigs();
    });

    return {
      isEnterprise,
      configs,
      loading,
      showForm,
      editingId,
      saving,
      formError,
      form,
      loginUrl,
      editConfig,
      saveConfig,
      removeConfig,
      cancelForm,
    };
  },
};
</script>
