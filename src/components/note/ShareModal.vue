<template>
  <ui-modal
    :model-value="modelValue"
    content-class="max-w-md"
    @close="$emit('update:modelValue', false)"
  >
    <template #header>
      <h3 class="text-lg font-semibold">
        Share note
      </h3>
    </template>

    <template #actions>
      <ui-button variant="primary" class="w-full mobile:!min-h-[48px] mobile:!h-auto mobile:!py-3" @click="$emit('update:modelValue', false)">
        Done
      </ui-button>
    </template>

    <div class="space-y-5">
      <section v-if="isAuthenticated" class="space-y-3">
        <h3 class="text-sm font-semibold text-neutral-600 dark:text-neutral-300">
          {{ translations.share?.collaborate || 'Collaborate' }}
        </h3>

        <div class="flex flex-col gap-2 sm:flex-row">
          <ui-input
            v-model="inviteInput"
            class="flex-1"
            type="text"
            placeholder="email"
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
            :title="!isEmailVerified ? verifyTooltip : undefined"
            @click="handleInvite"
          >
            <v-remixicon name="riUserAddLine" class="mr-1" size="16" />
            Invite
          </ui-button>
        </div>

        <p v-if="sharing.error.value" role="alert" class="text-sm text-red-500">
          {{ sharing.error.value }}
        </p>

        <p
          v-if="inviteMessage"
          role="status"
          class="text-sm text-amber-600 dark:text-amber-400"
        >
          {{ inviteMessage }}
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
                :name="displayName(collab)"
                :size="32"
              />
              <div class="min-w-0 flex-1">
                <p class="truncate text-sm font-medium text-neutral-900 dark:text-neutral-100">
                  {{ displayName(collab) }}
                </p>
                <p class="text-xs text-neutral-500 dark:text-neutral-400">
                  {{ roleLabel(collab.role, translations) }}
                </p>
              </div>
              <button
                class="shrink-0 p-1.5 text-neutral-400 transition-colors hover:text-red-500 dark:hover:text-red-400"
                title="Remove collaborator"
                @click="handleRemove(collab)"
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
          {{ translations.share?.noCollaborators || 'No collaborators yet. Invite someone to start collaborating.' }}
        </p>

        <div v-if="joinRequests.length" class="space-y-2">
          <p class="text-sm font-medium text-neutral-700 dark:text-neutral-300">
            {{ translations.share?.pendingRequests || 'Pending requests' }}
          </p>
          <ui-list class="space-y-1">
            <ui-list-item
              v-for="req in joinRequests"
              :key="req.id"
              class="gap-2"
            >
              <ui-user-avatar :name="req.username || req.accountId" :size="32" />
              <div class="min-w-0 flex-1">
                <p class="truncate text-sm font-medium text-neutral-900 dark:text-neutral-100">
                  {{ req.username || req.accountId }}
                </p>
                <p class="text-xs font-medium text-amber-600 dark:text-amber-400">
                  {{ translations.share?.pending || 'Pending' }} · {{ roleLabel(req.role, translations) }}
                </p>
              </div>
              <button
                class="shrink-0 rounded-lg px-2 py-1 text-xs font-medium text-emerald-600 transition-colors hover:bg-emerald-50 dark:text-emerald-400 dark:hover:bg-emerald-900/20"
                title="Approve"
                @click="handleApproveRequest(req)"
              >
                {{ translations.share?.approve || 'Approve' }}
              </button>
              <button
                class="shrink-0 rounded-lg px-2 py-1 text-xs font-medium text-red-500 transition-colors hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-900/20"
                title="Deny"
                @click="handleDenyRequest(req)"
              >
                {{ translations.share?.deny || 'Deny' }}
              </button>
            </ui-list-item>
          </ui-list>
        </div>

        <div class="flex gap-2">
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
          :title="!isEmailVerified ? verifyTooltip : undefined"
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
              <p class="text-xs text-neutral-500 dark:text-neutral-400">
                {{ roleLabel(link.role, translations) }} ·
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
            <button
              class="shrink-0 p-1.5 text-neutral-400 transition-colors hover:text-red-500 dark:hover:text-red-400"
              title="Revoke link"
              @click="handleRevokeLink(link)"
            >
              <v-remixicon name="riDeleteBinLine" size="16" />
            </button>
          </ui-list-item>
        </ui-list>
      </section>

      <section v-if="isMobile && shareActions.length" class="space-y-3">
        <h3 class="text-sm font-semibold text-neutral-600 dark:text-neutral-300">
          Export
        </h3>
        <div class="grid grid-cols-3 gap-2 overflow-y-auto no-scrollbar max-h-[50vh]">
          <button
            v-for="s in shareActions"
            :key="s.name"
            class="flex flex-col items-center justify-center gap-2 p-3 rounded-xl border bg-white dark:bg-neutral-900 hover:bg-neutral-50 dark:hover:bg-neutral-700 active:bg-neutral-100 dark:active:bg-neutral-600 transition-colors"
            @click="$emit('update:modelValue', false); s.handler();"
          >
            <div class="flex items-center justify-center w-12 h-12">
              <v-remixicon
                :name="s.icon"
                class="text-2xl text-neutral-700 dark:text-neutral-300"
              />
            </div>
            <span class="text-xs leading-tight text-center text-neutral-600 dark:text-neutral-400 truncate w-full">
              {{ s.title }}
            </span>
          </button>
        </div>
      </section>
    </div>
  </ui-modal>
</template>

<script>
import { ref, computed, watch, onMounted } from 'vue';
import { useNoteSharing } from '@/composable/useNoteSharing';
import { useClipboard } from '@/composable/clipboard';
import { useAccountStore } from '@/store/account';
import { useWorkspaceStore } from '@/store/workspace';
import { useTranslations } from '@/composable/useTranslations';
import { useDialog } from '@/lib/dialog';
import { backend } from '@/lib/tauri-bridge';
import { displayName } from '@/utils/displayName';
import { roleLabel } from '@/utils/roleLabel';

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
    shareActions: { type: Array, default: () => [] },
  },
  emits: ['update:modelValue'],
  setup(props) {
    const sharing = useNoteSharing();
    const accountStore = useAccountStore();
    const workspaceStore = useWorkspaceStore();
    const { translations } = useTranslations();
    const dialog = useDialog();
    const isAuthenticated = computed(() => accountStore.isAuthenticated);
    const isMobile = backend.isMobileRuntime();
    const inviteInput = ref('');
    const inviteRole = ref('editor');
    const inviting = ref(false);
    const inviteMessage = ref('');
    const {
      inviteLinks,
      linkLoading,
      fetchLinks,
      generateLink,
      revokeLink,
      joinRequests,
      fetchJoinRequests,
      approveJoinRequest,
      denyJoinRequest,
    } = sharing;
    const linkRole = ref('editor');
    const linkExpiry = ref('never');
    const linkError = ref('');
    const { copyState, copyToClipboard } = useClipboard();
    const copiedToken = ref('');
    const isEmailVerified = computed(() => {
      const v = accountStore.profile?.emailVerified;
      return v === true || v === null || v === undefined;
    });
    const verifyTooltip = 'Please verify your email to invite collaborators.';

    function getInviteUrl(token) {
      return `beaver-notes://join/${token}`;
    }

    function tpl(raw, params) {
      return Object.entries(params).reduce(
        (s, [k, v]) => s.replace(`{${k}}`, String(v)),
        raw,
      );
    }

    async function createLink() {
      linkLoading.value = true;
      linkError.value = '';
      try {
        await generateLink(props.noteId, {
          role: linkRole.value,
          expiresIn: linkExpiry.value === 'never' ? null : parseInt(linkExpiry.value, 10),
          workspaceId: workspaceStore.activeId,
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

    function handleRevokeLink(link) {
      const share = translations.value?.share;
      dialog.confirm({
        title: tpl(share?.revokeLinkTitle || 'Revoke invite link {url}?', {
          url: getInviteUrl(link.token),
        }),
        body:
          share?.revokeLinkBody ||
          'Anyone who already has this link will no longer be able to join this note.',
        icon: 'riDeleteBinLine',
        okText: translations.value?.dialog?.confirm || 'Revoke',
        cancelText: translations.value?.dialog?.cancel || 'Cancel',
        okVariant: 'danger',
        onConfirm: async () => {
          linkError.value = '';
          try {
            await revokeLink(props.noteId, link.id);
          } catch (err) {
            linkError.value = err?.message || 'Failed to revoke invite link';
            console.error('[ShareModal] revokeLink failed:', err);
          }
        },
      });
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
          try {
            await fetchJoinRequests(props.noteId);
          } catch {
            // Join-request fetch errors are non-critical
          }
        }
      }
    );

    onMounted(() => {
      if (props.noteId) {
        fetchLinks(props.noteId);
        fetchJoinRequests(props.noteId);
      }
    });

    async function handleApproveRequest(req) {
      try {
        await approveJoinRequest(req.id);
      } catch {
        // error is set in composable
      }
    }

    async function handleDenyRequest(req) {
      try {
        await denyJoinRequest(req.id);
      } catch {
        // error is set in composable
      }
    }

    async function handleInvite() {
      const identifier = inviteInput.value.trim();
      if (!identifier || inviting.value) return;
      inviting.value = true;
      inviteMessage.value = '';
      try {
        const result = await sharing.invite(
          props.noteId,
          identifier,
          inviteRole.value,
          { workspaceId: workspaceStore.activeId },
        );
        inviteInput.value = '';
        if (result?.alreadyInvited) {
          inviteMessage.value =
            translations.value?.share?.alreadyCollaborator ||
            'Already a collaborator';
        }
      } catch {
        // error is set in composable
      } finally {
        inviting.value = false;
      }
    }

    function handleRemove(collab) {
      const name = displayName(collab);
      const share = translations.value?.share;
      dialog.confirm({
        title: tpl(share?.removeCollaboratorTitle || 'Remove {name}?', { name }),
        body: tpl(
          share?.removeCollaboratorBody ||
            '{name} loses access to future changes to this note. The note key is rotated so they cannot read anything new.',
          { name },
        ),
        icon: 'riUserUnfollowLine',
        okText: translations.value?.dialog?.confirm || 'Remove',
        cancelText: translations.value?.dialog?.cancel || 'Cancel',
        okVariant: 'danger',
        onConfirm: async () => {
          try {
            await sharing.remove(props.noteId, collab.userId);
          } catch {
            // error is set in composable
          }
        },
      });
    }

    return {
      sharing,
      translations,
      isAuthenticated,
      isMobile,
      INVITE_ROLE_OPTIONS,
      LINK_ROLE_OPTIONS,
      EXPIRY_OPTIONS,
      inviteInput,
      inviteRole,
      inviting,
      inviteMessage,
      roleLabel,
      inviteLinks,
      linkLoading,
      linkError,
      linkRole,
      linkExpiry,
      joinRequests,
      handleApproveRequest,
      handleDenyRequest,
      copyState,
      copiedToken,
      isEmailVerified,
      verifyTooltip,
      createLink,
      copyLink,
      handleRevokeLink,
      getInviteUrl,
      formatDate,
      handleInvite,
      handleRemove,
      displayName,
    };
  },
};
</script>
