<template>
  <div class="min-h-screen flex flex-col items-center justify-center px-6 py-12">
    <div class="w-full max-w-md space-y-6 bg-white dark:bg-neutral-900 rounded-xl border p-6">
      <h1 class="text-lg font-semibold text-neutral-800 dark:text-neutral-100 text-center">{{ tr.resetPassword || 'Reset password' }}</h1>
      <p v-if="done" class="text-sm text-green-600 dark:text-green-400 text-center">{{ tr.resetSuccess || 'Password has been reset. You can now sign in.' }}</p>
      <template v-else>
        <ui-input v-model="newPassword" :password="true" :placeholder="tr.newPasswordPlaceholder || 'New password (min 12 chars)'" class="w-full" />
        <ui-input v-model="confirmPassword" :password="true" :placeholder="tr.confirmPasswordPlaceholder || 'Confirm password'" class="w-full" @keyup.enter="submit" />
        <p v-if="error" class="text-sm text-red-500">{{ error }}</p>
        <ui-button variant="primary" class="w-full" :loading="busy" @click="submit">{{ tr.resetPassword || 'Reset password' }}</ui-button>
      </template>
      <ui-button variant="secondary" class="w-full" @click="goHome">{{ tr.goHome || 'Go home' }}</ui-button>
    </div>
  </div>
</template>
<script>
import { ref, computed, onMounted } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useTranslations } from '@/composable/useTranslations';
export default {
  setup() {
    const route = useRoute();
    const router = useRouter();
    const { translations } = useTranslations();
    const tr = computed(() => translations.value?.auth || translations.value.account || {});
    function fmt(k, params) {
      const raw = tr.value[k] ?? k;
      if (!params) return raw;
      return Object.entries(params).reduce((s, [kk, v]) => s.replace(`{${kk}}`, String(v)), raw);
    }
    const token = ref('');
    const newPassword = ref('');
    const confirmPassword = ref('');
    const error = ref('');
    const busy = ref(false);
    const done = ref(false);
    onMounted(() => { token.value = String(route.query.token || route.params.token || ''); if (!token.value) error.value = 'Missing reset token.'; });
    async function submit() {
      error.value = '';
      if (!token.value) { error.value = 'Missing reset token.'; return; }
      if (newPassword.value.length < 12) { error.value = 'Password must be at least 12 characters.'; return; }
      if (newPassword.value !== confirmPassword.value) { error.value = 'Passwords do not match.'; return; }
      busy.value = true;
      try {
        const { completePasswordReset } = await import('@/lib/api/auth');
        const { useAccountStore } = await import('@/store/account');
        const accountStore = useAccountStore();
        await completePasswordReset(token.value, newPassword.value, { baseUrl: accountStore.serverUrl });
        done.value = true;
      } catch (e) { error.value = e?.message || 'Reset failed.'; } finally { busy.value = false; }
    }
    function goHome() { router.push('/'); }
    return { newPassword, confirmPassword, error, busy, done, submit, goHome, tr, fmt };
  },
};
</script>
