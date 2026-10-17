<template>
  <ui-modal
    :model-value="show"
    content-class="max-w-sm"
    @close="$emit('close')"
    @update:model-value="!$event && $emit('close')"
  >
    <template #header>
      <div class="flex flex-row items-center gap-4">
        <div
          class="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-primary/10"
        >
          <v-remixicon name="riUserAddLine" size="24" class="text-primary" />
        </div>
        <h3 class="font-semibold text-lg">
          {{ translations.joinInvite?.title || 'Join note' }}
        </h3>
      </div>
    </template>

    <p v-if="error" class="text-sm text-red-500 mb-4" role="alert">
      {{ error }}
    </p>

    <!-- Pending is not success: a require-approval link answers 202
         { pending: true } and grants nothing until an editor approves. -->
    <div v-else-if="pending" class="text-center py-2">
      <div
        class="w-10 h-10 mx-auto mb-3 rounded-full bg-amber-100 dark:bg-amber-900/30 flex items-center justify-center"
      >
        <v-remixicon name="riTimeLine" size="20" class="text-amber-500" />
      </div>
      <p class="text-sm text-neutral-700 dark:text-neutral-300 mb-1">
        {{ translations.joinInvite?.pendingTitle || 'Request sent — awaiting approval' }}
      </p>
      <p class="text-xs text-neutral-500 mb-4">
        {{ translations.joinInvite?.pendingBody || 'A note editor must approve you before you can open this note.' }}
      </p>
    </div>

    <div v-else-if="success" class="text-center py-2">
      <div
        class="w-10 h-10 mx-auto mb-3 rounded-full bg-emerald-100 dark:bg-emerald-900/30 flex items-center justify-center"
      >
        <v-remixicon name="riCheckLine" size="20" class="text-emerald-500" />
      </div>
      <p class="text-sm text-neutral-700 dark:text-neutral-300 mb-1">
        {{ translations.joinInvite?.successTitle || "You've joined the note!" }}
      </p>
      <p class="text-xs text-neutral-500 mb-4">
        {{ translations.joinInvite?.role || 'Role' }}: {{ result?.role }}
      </p>
    </div>

    <p v-else-if="!error" class="text-sm text-neutral-700 dark:text-neutral-300 mb-4">
      {{ translations.joinInvite?.invitedTo || "You've been invited to collaborate on a note." }}
    </p>

    <template #actions>
      <ui-button
        v-if="pending"
        class="w-full motion-press"
        variant="primary"
        :disabled="loading"
        :loading="loading"
        @click="join"
      >
        {{ translations.joinInvite?.checkAgain || 'Check again' }}
      </ui-button>

      <ui-button
        v-else-if="success"
        class="w-full motion-press"
        variant="primary"
        @click="openNote"
      >
        {{ translations.joinInvite?.openNote || 'Open Note' }}
      </ui-button>

      <ui-button
        v-else-if="error"
        class="w-full motion-press"
        variant="primary"
        @click="goToHome"
      >
        {{ translations.joinInvite?.goToHome || 'Go to home' }}
      </ui-button>

      <ui-button
        v-else-if="isAuthenticated"
        class="w-full motion-press"
        variant="primary"
        :disabled="loading"
        :loading="loading"
        @click="join"
      >
        {{ translations.joinInvite?.join || 'Join Note' }}
      </ui-button>

      <ui-button
        v-else
        class="w-full motion-press"
        variant="primary"
        @click="goToSignIn"
      >
        {{ translations.joinInvite?.signInToAccept || 'Sign in to accept' }}
      </ui-button>
    </template>
  </ui-modal>
</template>

<script>
import { ref, computed, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useTranslations } from '@/composable/useTranslations';
import { joinViaInviteLink } from '@/lib/api/collaboration';
import { useAccountStore } from '@/store/account';
import { triggerInteractionHaptic } from '@/lib/native/haptics';

export default {
  name: 'JoinInviteDialog',
  props: {
    show: { type: Boolean, default: false },
    token: { type: String, default: '' },
  },
  emits: ['close'],
  setup(props, { emit }) {
    const { translations } = useTranslations();
    const route = useRoute();
    const router = useRouter();
    const accountStore = useAccountStore();
    const loading = ref(false);
    const error = ref(null);
    const success = ref(false);
    const pending = ref(false);
    const result = ref(null);

    const isAuthenticated = computed(() => accountStore.isAuthenticated);

    // Fresh token on every open: any earlier join attempt must not leak
    // a stale success (or error) into the next invite.
    watch(
      () => [props.show, props.token],
      ([show]) => {
        if (show) {
          loading.value = false;
          error.value = null;
          pending.value = false;
          success.value = false;
          result.value = null;
        }
      }
    );

    async function join() {
      if (!props.token || loading.value) return;
      loading.value = true;
      error.value = null;
      try {
        result.value = await joinViaInviteLink(props.token, {
          baseUrl: accountStore.serverUrl,
        });
        if (result.value?.pending) {
          pending.value = true;
          success.value = false;
        } else {
          pending.value = false;
          success.value = true;
          triggerInteractionHaptic('intro');
        }
      } catch (err) {
        error.value =
          err.response?.data?.message ||
          translations.value.joinInvite?.failed ||
          'Failed to join. The link may be invalid or expired.';
      } finally {
        loading.value = false;
      }
    }

    // Signed-out users need a way forward: sign in, then come back to this
    // token. The account settings surface honours `returnTo` after sign-in,
    // and returning to the Index with `?join=` reopens this modal.
    function goToSignIn() {
      router.push({
        name: 'Settings-Account',
        query: { returnTo: `/?join=${props.token}` },
      });
    }

    // Refresh the shared-note grants before navigating: the note page bounces
    // to home when the id is not yet in the local store, and a fresh join has
    // never been fetched or materialized.
    async function openNote() {
      const noteId = result.value?.noteId;
      if (!noteId) return;
      try {
        const { useSharedNotes } = await import('@/composable/useSharedNotes');
        await useSharedNotes().refreshSharedNotes();
      } catch {
        // Navigation still attempts the note; the page shows its own error.
      }
      router.push(`/note/${noteId}`);
    }

    function goToHome() {
      emit('close');
      if (route.path !== '/') router.push('/');
    }

    return {
      translations,
      loading,
      error,
      success,
      pending,
      result,
      isAuthenticated,
      join,
      goToSignIn,
      goToHome,
      openNote,
    };
  },
};
</script>
