<template>
  <div
    class="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm"
  >
    <div
      class="w-full max-w-sm mx-4 rounded-xl bg-white dark:bg-neutral-900 p-6 shadow-2xl"
    >
      <h2
        class="text-xl font-bold tracking-tight text-neutral-800 dark:text-neutral-200"
      >
        {{
          translations.settings?.unlockAppEncryptionTitle ||
          'Unlock to continue'
        }}
      </h2>
      <p class="mt-2 text-sm text-neutral-500 dark:text-neutral-400">
        {{
          translations.settings?.unlockAppEncryptionBody ||
          'Your notes are encrypted. Enter your encryption passphrase to unlock the app.'
        }}
      </p>
      <p class="mt-1 text-xs text-neutral-400 dark:text-neutral-500">
        Encryption is always active — your notes and assets are protected at
        rest.
      </p>

      <ui-input
        v-model="password"
        type="password"
        :placeholder="translations.settings?.password || 'Passphrase'"
        class="mt-4 w-full"
        :disabled="busy"
        @keyup.enter="unlock"
      />
      <p
        v-if="error"
        class="mt-2 text-xs text-red-500 dark:text-red-400 text-center"
      >
        {{ error }}
      </p>

      <ui-button
        variant="primary"
        class="mt-4 w-full"
        :loading="busy"
        :disabled="!password || busy"
        @click="unlock"
      >
        {{ translations.settings?.unlock || 'Unlock' }}
      </ui-button>
    </div>
  </div>
</template>

<script>
import { ref } from 'vue';
import { verifyPassphrase } from '@/utils/crypto/encryption.js';
import { useTranslations } from '@/composable/useTranslations';

export default {
  emits: ['unlocked'],
  setup(_, { emit }) {
    const { translations } = useTranslations();
    const password = ref('');
    const error = ref('');
    const busy = ref(false);

    async function unlock() {
      if (!password.value || busy.value) return;
      busy.value = true;
      error.value = '';
      try {
        const res = await verifyPassphrase(password.value);
        if (res.ok) {
          password.value = '';
          emit('unlocked');
        } else {
          error.value = res.error || 'Incorrect passphrase.';
        }
      } catch (e) {
        error.value = e?.message || 'Incorrect passphrase.';
      } finally {
        busy.value = false;
      }
    }

    return { password, error, busy, unlock, translations };
  },
};
</script>
