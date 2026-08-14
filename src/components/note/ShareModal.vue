<template>
  <ui-modal
    :model-value="modelValue"
    content-class="max-w-md"
    @close="$emit('update:modelValue', false)"
  >
    <template #header>
      <div class="flex items-center gap-2">
        <v-remixicon name="riShareLine" size="20" />
        <span class="font-semibold">Share note</span>
      </div>
    </template>

    <template #actions>
      <div class="flex justify-end pb-2">
        <ui-button variant="primary" @click="$emit('update:modelValue', false)">
          Done
        </ui-button>
      </div>
    </template>

    <div class="space-y-5">
      <div
        v-if="sharing.key"
        class="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2.5 py-1 text-xs font-medium text-primary dark:bg-primary/20"
      >
        <v-remixicon name="riCheckLine" size="12" />
        Collaboration enabled
      </div>

      <!-- Section 1 — Collaborate -->
      <section class="space-y-3">
        <h3 class="text-xs font-semibold uppercase tracking-wide text-neutral-500 dark:text-neutral-400">
          Collaborate
        </h3>

        <div class="flex flex-col gap-2 sm:flex-row">
          <ui-input
            v-model="inviteInput"
            class="flex-1"
            type="text"
            placeholder="username or email"
            @keydown.enter="handleInvite"
          />
          <ui-select
            v-model="inviteRole"
            :options="INVITE_ROLE_OPTIONS"
            class="sm:w-32"
          />
          <ui-button
            variant="primary"
            :disabled="!inviteInput.trim() || inviting"
            :loading="inviting"
            @click="handleInvite"
          >
            <v-remixicon name="riUserAddLine" class="mr-1" size="16" />
            Invite
          </ui-button>
        </div>

        <p v-if="sharing.error.value" role="alert" class="text-sm text-red-500">
          {{ sharing.error.value }}
        </p>

        <div v-if="sharing.collaborators.value.length" class="space-y-2">
          <p class="text-sm font-medium text-neutral-700 dark:text-neutral-300">
            Collaborators
          </p>
          <ui-list class="space-y-1">
            <ui-list-item
              v-for="collab in sharing.collaborators.value"
              :key="collab.userId"
              class="gap-2"
            >
              <ui-user-avatar
                :name="collab.username || collab.email || 'Unknown'"
                :size="32"
              />
              <div class="min-w-0 flex-1">
                <p class="truncate text-sm font-medium text-neutral-900 dark:text-neutral-100">
                  {{ collab.username || collab.email || 'Unknown' }}
                </p>
                <p class="text-xs text-neutral-500 dark:text-neutral-400">
                  {{ collab.role }}
                </p>
              </div>
              <button
                class="shrink-0 p-1.5 text-neutral-400 transition-colors hover:text-red-500 dark:hover:text-red-400"
                title="Remove collaborator"
                @click="handleRemove(collab.userId)"
              >
                <v-remixicon name="riCloseLine" size="16" />
              </button>
            </ui-list-item>
          </ui-list>
        </div>

        <div v-else-if="sharing.loading.value" class="flex justify-center py-4">
          <ui-spinner size="20" />
        </div>

        <p
          v-else
          class="py-3 text-center text-sm text-neutral-500 dark:text-neutral-400"
        >
          No collaborators yet. Invite someone to start collaborating.
        </p>
      </section>

      <!-- Section 2 — Invite link -->
      <section class="space-y-3 border-t border-neutral-200 pt-4 dark:border-neutral-700">
        <h3 class="text-xs font-semibold uppercase tracking-wide text-neutral-500 dark:text-neutral-400">
          Invite link
        </h3>

        <div class="flex flex-col gap-2 sm:flex-row">
          <ui-select
            v-model="linkRole"
            :options="LINK_ROLE_OPTIONS"
            class="flex-1"
          />
          <ui-select
            v-model="linkExpiry"
            :options="EXPIRY_OPTIONS"
            class="flex-1"
          />
        </div>

        <ui-button
          variant="primary"
          class="w-full"
          :loading="linkLoading"
          @click="createLink"
        >
          Create invite link
        </ui-button>

        <p v-if="linkError" role="alert" class="text-xs text-red-500">
          {{ linkError }}
        </p>

        <ui-list v-if="inviteLinks.length" class="space-y-2">
          <ui-list-item
            v-for="link in inviteLinks"
            :key="link.id"
            class="gap-2 bg-neutral-50 dark:bg-neutral-800"
          >
            <div class="min-w-0 flex-1">
              <p class="truncate text-xs font-medium text-neutral-700 dark:text-neutral-300">
                {{ getInviteUrl(link.token) }}
              </p>
              <p class="text-[10px] text-neutral-500 dark:text-neutral-400">
                {{ link.role }} ·
                {{ link.expiresAt ? 'Expires ' + formatDate(link.expiresAt) : 'No expiry' }}
              </p>
            </div>
            <button
              class="shrink-0 p-1.5 text-neutral-400 transition-colors hover:text-neutral-600 dark:hover:text-neutral-300"
              :title="copyState === 1 && copiedToken === link.token ? 'Copied' : 'Copy link'"
              @click="copyLink(link.token)"
            >
              <v-remixicon
                :name="copyState === 1 && copiedToken === link.token ? 'riCheckLine' : 'riFileCopyLine'"
                size="16"
              />
            </button>
            <span
              v-if="copyState === 1 && copiedToken === link.token"
              class="text-xs font-medium text-primary"
            >
              Copied
            </span>
            <button
              class="shrink-0 p-1.5 text-neutral-400 transition-colors hover:text-red-500 dark:hover:text-red-400"
              title="Revoke link"
              @click="handleRevokeLink(link.id)"
            >
              <v-remixicon name="riDeleteBinLine" size="16" />
            </button>
          </ui-list-item>
        </ui-list>
      </section>
    </div>
  </ui-modal>
</template>

<script>
import { ref, watch, onMounted } from 'vue';
import { useNoteSharing } from '@/composable/useNoteSharing';
import { useClipboard } from '@/composable/clipboard';

const INVITE_ROLE_OPTIONS = [
  { value: 'editor', text: 'Editor' },
  { value: 'viewer', text: 'Viewer' },
];

const LINK_ROLE_OPTIONS = [
  { value: 'editor', text: 'Can edit' },
  { value: 'viewer', text: 'Can view' },
];

const EXPIRY_OPTIONS = [
  { value: 'never', text: 'Never expires' },
  { value: '86400000', text: '24 hours' },
  { value: '604800000', text: '7 days' },
  { value: '2592000000', text: '30 days' },
];

export default {
  props: {
    modelValue: { type: Boolean, default: false },
    noteId: { type: String, required: true },
  },
  emits: ['update:modelValue'],
  setup(props) {
    const sharing = useNoteSharing();
    const inviteInput = ref('');
    const inviteRole = ref('editor');
    const inviting = ref(false);
    const { inviteLinks, linkLoading, fetchLinks, generateLink, revokeLink } = sharing;
    const linkRole = ref('editor');
    const linkExpiry = ref('never');
    const linkError = ref('');
    const { copyState, copyToClipboard } = useClipboard();
    const copiedToken = ref('');

    function getInviteUrl(token) {
      return `beaver-notes://join/${token}`;
    }

    async function createLink() {
      linkLoading.value = true;
      linkError.value = '';
      try {
        await generateLink(props.noteId, {
          role: linkRole.value,
          expiresIn: linkExpiry.value === 'never' ? null : parseInt(linkExpiry.value, 10),
        });
      } catch (err) {
        linkError.value = err?.message || 'Failed to create invite link';
        console.error('[ShareModal] createLink failed:', err);
      } finally {
        linkLoading.value = false;
      }
    }

    async function copyLink(token) {
      await copyToClipboard(getInviteUrl(token));
      if (copyState.value === 1) {
        copiedToken.value = token;
      }
    }

    function handleRevokeLink(linkId) {
      revokeLink(props.noteId, linkId);
    }

    function formatDate(dateStr) {
      return new Date(dateStr).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    }

    watch(
      () => props.modelValue,
      async (open) => {
        if (open && props.noteId) {
          try {
            await sharing.fetchCollaborators(props.noteId);
          } catch {
            // Errors handled internally by useNoteSharing
          }
          try {
            await fetchLinks(props.noteId);
          } catch {
            // Link fetch errors are non-critical
          }
        }
      }
    );

    onMounted(() => {
      if (props.noteId) {
        fetchLinks(props.noteId);
      }
    });

    async function handleInvite() {
      const identifier = inviteInput.value.trim();
      if (!identifier || inviting.value) return;
      inviting.value = true;
      try {
        await sharing.invite(props.noteId, identifier, inviteRole.value);
        inviteInput.value = '';
      } catch {
        // error is set in composable
      } finally {
        inviting.value = false;
      }
    }

    async function handleRemove(userId) {
      try {
        await sharing.remove(props.noteId, userId);
      } catch {
        // error is set in composable
      }
    }

    return {
      sharing,
      INVITE_ROLE_OPTIONS,
      LINK_ROLE_OPTIONS,
      EXPIRY_OPTIONS,
      inviteInput,
      inviteRole,
      inviting,
      inviteLinks,
      linkLoading,
      linkError,
      linkRole,
      linkExpiry,
      copyState,
      copiedToken,
      createLink,
      copyLink,
      handleRevokeLink,
      getInviteUrl,
      formatDate,
      handleInvite,
      handleRemove,
    };
  },
};
</script>
