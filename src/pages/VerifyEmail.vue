<template>
  <div class="min-h-screen flex flex-col items-center justify-center px-6 py-12">
    <div class="w-full max-w-md space-y-6 bg-white dark:bg-neutral-900 rounded-xl border p-6">
      <div class="flex flex-col items-center gap-3">
        <v-remixicon :name="iconName" size="32" :class="iconClass" />
        <h1 class="text-lg font-semibold text-neutral-800 dark:text-neutral-100">{{ title }}</h1>
        <p class="text-sm text-center text-neutral-500 dark:text-neutral-400">{{ message }}</p>
      </div>
      <div v-if="status === 'error'" class="flex flex-col gap-3">
        <ui-button variant="primary" class="w-full" :loading="sending" :disabled="sending || cooldown > 0" @click="resend">
          {{ cooldown > 0 ? `Resend (${cooldown}s)` : 'Resend verification email' }}
        </ui-button>
        <ui-button variant="secondary" class="w-full" @click="goHome">Go home</ui-button>
      </div>
      <ui-button v-else-if="status === 'success'" variant="primary" class="w-full" @click="goHome">Go home</ui-button>
      <div v-else class="flex justify-center py-4">
        <ui-spinner :size="24" />
      </div>
    </div>
  </div>
</template>

<script>
import { ref, computed, onMounted } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useAccountStore } from '@/store/account';

export default {
  setup() {
    const route = useRoute();
    const router = useRouter();
    const accountStore = useAccountStore();
    const status = ref('loading');
    const title = ref('Verifying…');
    const message = ref('Please wait while we verify your email.');
    const sending = ref(false);
    const cooldown = ref(0);
    let timer = null;

    const iconName = computed(() => {
      if (status.value === 'success') return 'riCheckboxCircleLine';
      if (status.value === 'error') return 'riErrorWarningLine';
      return 'riLoader4Line';
    });
    const iconClass = computed(() => {
      if (status.value === 'success') return 'text-green-600 dark:text-green-400';
      if (status.value === 'error') return 'text-amber-600 dark:text-amber-400';
      return 'text-neutral-400 animate-spin';
    });

    async function verify(token) {
      try {
        const { confirmEmailVerification } = await import('@/lib/api/account');
        await confirmEmailVerification(token, { baseUrl: accountStore.serverUrl });
        status.value = 'success';
        title.value = 'Email verified';
        message.value = 'Your email has been verified. You can now invite collaborators.';
        // refresh profile so banner disappears
        try {
          const { getAccount } = await import('@/lib/api/account');
          const data = await getAccount({ baseUrl: accountStore.serverUrl });
          if (data?.profile) accountStore.setProfile(data.profile);
        } catch {}
      } catch (err) {
        status.value = 'error';
        const code = err?.code || err?.body?.error;
        if (code === 'token_expired') {
          title.value = 'Link expired';
          message.value = 'This verification link has expired. Request a new one.';
        } else {
          title.value = 'Verification failed';
          message.value = err?.message || 'Invalid or expired verification token.';
        }
      }
    }

    async function resend() {
      if (sending.value || cooldown.value > 0) return;
      sending.value = true;
      try {
        const { requestEmailVerification } = await import('@/lib/api/account');
        await requestEmailVerification({ baseUrl: accountStore.serverUrl });
        title.value = 'Email sent';
        message.value = 'Check your inbox for a new verification link.';
        cooldown.value = 60;
        timer = setInterval(() => {
          cooldown.value -= 1;
          if (cooldown.value <= 0) { clearInterval(timer); timer = null; }
        }, 1000);
      } catch (err) {
        message.value = err?.message || 'Failed to resend email.';
      } finally {
        sending.value = false;
      }
    }

    function goHome() {
      router.push('/');
    }

    onMounted(() => {
      const token = route.query.token || route.params.token || route.query.t;
      if (!token || typeof token !== 'string') {
        status.value = 'error';
        title.value = 'Missing token';
        message.value = 'No verification token found in the URL.';
        return;
      }
      verify(token);
    });

    return { status, title, message, iconName, iconClass, sending, cooldown, resend, goHome };
  },
};
</script>
