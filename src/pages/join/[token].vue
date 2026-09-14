<template>
  <div class="flex min-h-screen items-center justify-center bg-neutral-50 dark:bg-neutral-900 p-6">
    <div class="w-full max-w-sm rounded-xl border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-800 p-6 shadow-lg text-center">
      <div v-if="loading" class="py-8">
        <div class="w-8 h-8 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin mx-auto mb-3"></div>
        <p class="text-sm text-neutral-500">Joining...</p>
      </div>

      <div v-else-if="error" class="py-4">
        <div class="w-10 h-10 mx-auto mb-3 rounded-full bg-red-100 dark:bg-red-900/30 flex items-center justify-center">
          <svg class="w-5 h-5 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4.5c-.77-.833-2.694-.833-3.464 0L3.34 16.5c-.77.833.192 2.5 1.732 2.5z" />
          </svg>
        </div>
        <p class="text-sm text-red-600 dark:text-red-400 mb-4">{{ error }}</p>
        <button
          @click="$router.push('/')"
          class="text-xs text-neutral-500 hover:text-neutral-700 dark:hover:text-neutral-300"
        >
          Go to home
        </button>
      </div>

      <div v-else-if="success" class="py-4">
        <div class="w-10 h-10 mx-auto mb-3 rounded-full bg-emerald-100 dark:bg-emerald-900/30 flex items-center justify-center">
          <svg class="w-5 h-5 text-emerald-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" />
          </svg>
        </div>
        <p class="text-sm text-neutral-700 dark:text-neutral-300 mb-1">
          You've joined the note!
        </p>
        <p class="text-xs text-neutral-500 mb-4">
          Role: {{ result?.role }}
        </p>
        <button
          @click="$router.push(`/note/${result?.noteId}`)"
          class="px-4 py-2 text-xs font-medium rounded-xl bg-emerald-600 text-white hover:bg-emerald-700 transition-colors"
        >
          Open Note
        </button>
      </div>

      <div v-else class="py-4">
        <p class="text-sm text-neutral-700 dark:text-neutral-300 mb-4">
          You've been invited to collaborate on a note.
        </p>
        <button
          @click="join"
          class="px-4 py-2 text-xs font-medium rounded-xl bg-emerald-600 text-white hover:bg-emerald-700 transition-colors"
        >
          Join Note
        </button>
      </div>
    </div>
  </div>
</template>

<script>
import { ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { joinViaInviteLink } from '@/lib/api/collaboration';
import { useAccountStore } from '@/store/account';

export default {
  setup() {
    const route = useRoute();
    const router = useRouter();
    const accountStore = useAccountStore();
    const loading = ref(false);
    const error = ref(null);
    const success = ref(false);
    const result = ref(null);

    async function join() {
      loading.value = true;
      error.value = null;
      try {
        result.value = await joinViaInviteLink(route.params.token, {
          baseUrl: accountStore.serverUrl,
        });
        success.value = true;
      } catch (err) {
        error.value = err.response?.data?.message || 'Failed to join. The link may be invalid or expired.';
      } finally {
        loading.value = false;
      }
    }

    return { loading, error, success, result, join };
  },
};
</script>