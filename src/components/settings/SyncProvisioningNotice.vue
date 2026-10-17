<template>
  <div
    v-if="provisioningIssue"
    data-testid="sync-provisioning-notice"
    :role="provisioningIssue === 'key-changed' ? 'alert' : 'status'"
    class="mx-4 my-3 flex items-center justify-between gap-3 rounded-xl px-3 py-2.5 text-sm"
    :class="
      provisioningIssue === 'key-changed'
        ? 'bg-red-50 text-red-700 dark:bg-red-900/30 dark:text-red-300'
        : 'bg-amber-50 text-amber-800 dark:bg-amber-900/20 dark:text-amber-200'
    "
  >
    <span>
      {{
        provisioningIssue === 'key-changed'
          ? translations.settings?.syncProvisioningKeyChanged ||
            "A device's key changed — for safety we didn't share the key. Review."
          : translations.settings?.syncProvisioningPending ||
            "This device isn't fully synced — waiting for a key from another device."
      }}
    </span>
    <ui-button
      data-testid="provisioning-retry"
      class="shrink-0"
      @click="retryProvisioning"
    >
      {{ translations.settings?.retry || 'Retry' }}
    </ui-button>
  </div>
</template>

<script setup>
import { useCloudWorkspaces } from '@/composable/useCloudWorkspaces';
import { useTranslations } from '@/composable/useTranslations';

const { provisioningIssue, retryProvisioning } = useCloudWorkspaces();
const { translations } = useTranslations();
</script>
