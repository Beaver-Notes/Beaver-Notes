<template>
  <ui-modal
    data-testid="share-modal"
    :model-value="modelValue"
    content-class="max-w-md"
    @close="$emit('update:modelValue', false)"
  >
    <template #header>
      <h3 class="text-lg font-semibold">
        {{ shareTitle }}
      </h3>
    </template>

    <template #actions>
      <ui-button variant="primary" class="w-full mobile:!min-h-[48px] mobile:!h-auto mobile:!py-3" @click="$emit('update:modelValue', false)">
        Done
      </ui-button>
    </template>

    <div class="space-y-5">
      <div
        v-if="isMobile"
        data-testid="share-mobile-tabs"
        class="flex gap-1 rounded-xl bg-neutral-100 p-1 dark:bg-neutral-800"
        role="tablist"
      >
        <button
          v-for="tab in mobileTabs"
          :key="tab.id"
          :data-testid="`share-tab-${tab.id}`"
          role="tab"
          :aria-selected="mobileTab === tab.id"
          class="flex-1 rounded-lg px-2 py-2 text-sm font-medium transition-colors focus-visible:ring-2 focus-visible:ring-secondary focus-visible:outline-none"
          :class="mobileTab === tab.id
            ? 'bg-white text-neutral-900 shadow-sm dark:bg-neutral-900 dark:text-neutral-100'
            : 'text-neutral-500 dark:text-neutral-400'"
          @click="mobileTab = tab.id"
        >
          {{ tab.label }}
        </button>
      </div>

      <!-- People with access: a single card, rows on hairline dividers, join requests on top. -->
      <section
        v-if="isAuthenticated && (!isMobile || mobileTab === 'people')"
        class="space-y-3"
      >
        <h3 class="text-sm font-semibold text-neutral-600 dark:text-neutral-300">
          {{ translations.share?.peopleWithAccess || 'People with access' }}
        </h3>

        <div class="flex flex-col gap-2 sm:flex-row">
          <ui-input
            v-model="inviteInput"
            data-testid="share-invite-email"
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
            data-testid="share-invite-submit"
            variant="primary"
            class="motion-press"
            :disabled="!inviteInput.trim() || inviting"
            :loading="inviting"
            :title="!isEmailVerified ? verifyTooltip : undefined"
            @click="handleInvite"
          >
            <v-remixicon name="riUserAddLine" class="ltr:mr-1 rtl:ml-1" size="16" />
            Invite
          </ui-button>
        </div>

        <p v-if="sharing.error.value" data-testid="share-error" role="alert" class="text-sm text-red-500">
          {{ sharing.error.value }}
        </p>

        <p
          v-if="inviteMessage"
          role="status"
          class="text-sm text-amber-600 dark:text-amber-400"
        >
          {{ inviteMessage }}
        </p>

        <ui-list class="divide-y divide-neutral-200 overflow-hidden rounded-xl border border-neutral-200 bg-white dark:divide-neutral-800 dark:border-neutral-800 dark:bg-neutral-950">
          <ui-list-item
            v-for="req in joinRequests"
            :key="req.id"
            data-testid="share-pending-row"
            class="motion-spring-enter flex flex-wrap gap-2"
          >
            <ui-user-avatar :name="req.username || req.accountId" :size="32" />
            <div class="min-w-0 flex-1">
              <p class="truncate text-sm font-medium text-neutral-900 dark:text-neutral-100">
                {{ req.username || req.accountId }}
              </p>
              <p class="text-xs text-neutral-500 dark:text-neutral-400">
                {{ translations.share?.pending || 'Pending' }} · {{ roleLabel(req.role, translations) }}
              </p>
            </div>
            <ui-button
              variant="primary"
              class="motion-press !h-9 !px-3"
              @click="handleApproveRequest(req)"
            >
              {{ translations.share?.approve || 'Approve' }}
            </ui-button>
            <ui-button
              variant="secondary"
              class="motion-press !h-9 !px-3"
              @click="handleDenyRequest(req)"
            >
              {{ translations.share?.deny || 'Deny' }}
            </ui-button>
          </ui-list-item>

          <ui-list-item data-testid="share-self-row" class="motion-spring-enter flex justify-between gap-2">
            <div class="flex min-w-0 flex-1 gap-2">
              <ui-user-avatar :name="selfName" :size="32" />
              <p class="min-w-0 truncate text-sm font-medium text-neutral-900 dark:text-neutral-100">
                {{ selfName }}
                <span class="text-xs font-medium text-amber-600 dark:text-amber-400">(you)</span>
              </p>
            </div>
            <span
              v-if="selfRoleLabel"
              class="shrink-0 rounded-full bg-neutral-100 px-2.5 py-1 text-xs font-medium text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300"
            >
              {{ selfRoleLabel }}
            </span>
          </ui-list-item>

          <ui-list-item
            v-for="collab in otherCollaborators"
            :key="collab.userId"
            data-testid="share-collaborator-row"
            class="motion-spring-enter flex gap-2"
          >
            <ui-user-avatar
              :name="displayName(collab)"
              :size="32"
            />
            <div class="min-w-0 flex-1">
              <p class="truncate text-sm font-medium text-neutral-900 dark:text-neutral-100">
                {{ displayName(collab) }}
              </p>
              <p v-if="collab.viaWorkspace" class="text-xs text-neutral-500 dark:text-neutral-400">
                {{ translations.share?.viaWorkspace || 'via workspace' }}
              </p>
            </div>
            <!-- Static role pill: ui-select stays the role affordance only in the add-member row. -->
            <span class="shrink-0 rounded-full bg-neutral-100 px-2.5 py-1 text-xs font-medium text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300">
              {{ roleLabel(collab.role, translations) }}
            </span>
            <button
              v-if="!collab.viaWorkspace"
              data-testid="share-collaborator-remove"
              class="motion-press shrink-0 rounded-lg p-1.5 text-neutral-400 transition-colors hover:text-red-500 focus-visible:ring-2 focus-visible:ring-secondary focus-visible:outline-none dark:hover:text-red-400"
              title="Remove collaborator"
              @click="handleRemove(collab)"
            >
              <v-remixicon name="riCloseLine" size="16" />
            </button>
          </ui-list-item>

          <div v-if="!otherCollaborators.length && sharing.loading.value" class="flex justify-center py-4">
            <ui-spinner size="20" />
          </div>

          <p
            v-else-if="!otherCollaborators.length"
            data-testid="share-empty"
            class="py-3 text-center text-sm text-neutral-500 dark:text-neutral-400"
          >
            {{ translations.share?.noCollaborators || 'No collaborators yet. Invite someone to start collaborating.' }}
          </p>
        </ui-list>
      </section>

      <!-- Anyone with the link: icon header, link row, then access/expiry/reset in one row. -->
      <section
        v-if="isAuthenticated && (!isMobile || mobileTab === 'people')"
        data-testid="share-links-section"
        class="space-y-2"
      >
        <h3 class="text-sm font-semibold text-neutral-600 dark:text-neutral-300">
          {{ translations.share?.anyoneWithLink || 'Anyone with the link' }}
        </h3>

        <div class="divide-y divide-neutral-200 overflow-hidden rounded-xl border border-neutral-200 bg-white dark:divide-neutral-800 dark:border-neutral-800 dark:bg-neutral-950">
          <div class="flex items-start gap-3 p-3">
            <div class="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <v-remixicon name="riLink" size="18" />
            </div>
            <p class="min-w-0 flex-1 text-xs text-neutral-500 dark:text-neutral-400">
              {{ translations.share?.linkJoinsDirectly || 'Joins this note directly' }}
            </p>
          </div>

          <div v-if="activeLink" class="flex flex-wrap items-center gap-2 p-3">
            <div class="min-w-0 flex-1 rounded-lg bg-neutral-100 px-2.5 py-1.5 dark:bg-neutral-900">
              <!-- the server stores only the token hash, so the url only exists for links created in this session -->
              <p v-if="activeLink.token" data-testid="share-link-url" class="truncate text-xs font-medium text-neutral-700 dark:text-neutral-300">
                {{ getInviteUrl(activeLink.token) }}
              </p>
              <p v-else class="text-xs text-neutral-500 dark:text-neutral-400">
                {{ translations.share?.linkUrlUnavailable || 'Link available in this session only' }}
              </p>
            </div>
            <ui-button
              data-testid="share-link-copy"
              variant="secondary"
              class="motion-press min-w-[7rem] shrink-0"
              :class="copyState === 1 ? 'motion-copy-sweep' : ''"
              :disabled="!activeLink.token"
              @click="copyLink(activeLink.token)"
            >
              {{ copyState === 1 ? (translations.share?.copied || 'Copied') : (translations.share?.copyLink || 'Copy link') }}
            </ui-button>
          </div>

          <div class="flex flex-wrap items-center gap-2 p-3">
            <ui-select
              v-model="linkAccess"
              :options="LINK_ACCESS_OPTIONS"
              class="w-28 shrink-0"
            />
            <ui-select
              v-model="linkExpiry"
              :options="EXPIRY_OPTIONS"
              class="min-w-[9rem] flex-1"
            />
            <ui-button
              data-testid="share-link-reset"
              variant="secondary"
              class="motion-press"
              :disabled="!activeLink"
              @click="handleResetLink"
            >
              {{ translations.share?.resetLink || 'Reset link' }}
            </ui-button>
          </div>

          <p class="px-3 py-2 text-xs text-neutral-500 dark:text-neutral-400">
            {{ translations.share?.linkResetHint || 'Created automatically. Resetting replaces it, and the old link stops working.' }}
          </p>
        </div>

        <p v-if="linkError" role="alert" class="text-xs text-red-500">
          {{ linkError }}
        </p>
      </section>

      <section
        v-if="isMobile && shareActions.length && mobileTab === 'export'"
        data-testid="share-export-section"
        class="space-y-3"
      >
        <h3 class="text-sm font-semibold text-neutral-600 dark:text-neutral-300">
          Export
        </h3>
        <div class="grid grid-cols-3 gap-2 overflow-y-auto no-scrollbar max-h-[50vh]">
          <button
            v-for="s in shareActions"
            :key="s.name"
            class="flex flex-col items-center justify-center gap-2 p-3 rounded-xl border bg-white dark:bg-neutral-900 hover:bg-neutral-50 dark:hover:bg-neutral-700 active:bg-neutral-100 dark:active:bg-neutral-600 transition-colors focus-visible:ring-2 focus-visible:ring-secondary focus-visible:outline-none"
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
import { useNoteStore } from '@/store/note';
import { useWorkspaceStore } from '@/store/workspace';
import { useTranslations } from '@/composable/useTranslations';
import { useDialog } from '@/lib/dialog';
import { triggerInteractionHaptic } from '@/lib/native/haptics';
import { backend } from '@/lib/tauri-bridge';
import { displayName } from '@/utils/displayName';
import { roleLabel } from '@/utils/roleLabel';

const INVITE_ROLE_OPTIONS = [
  { value: 'editor', text: 'Editor' },
  { value: 'viewer', text: 'Viewer' },
];

const LINK_ACCESS_OPTIONS = [
  { value: 'viewer', text: 'Can view' },
  { value: 'editor', text: 'Can edit' },
  { value: 'off', text: 'Off' },
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
    const collaborators = computed(() => sharing.collaborators.value);
    const accountStore = useAccountStore();
    const noteStore = useNoteStore();
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
      inviteLinks: realInviteLinks,
      linkLoading,
      fetchLinks,
      generateLink,
      revokeLink,
      joinRequests: realJoinRequests,
      fetchJoinRequests,
      approveJoinRequest,
      denyJoinRequest,
    } = sharing;
    const inviteLinks = computed(() => realInviteLinks.value);
    const joinRequests = computed(() => realJoinRequests.value);
    const linkExpiry = ref('never');
    const linkError = ref('');
    const { copyState, copyToClipboard } = useClipboard();
    const isEmailVerified = computed(() => {
      const v = accountStore.profile?.emailVerified;
      return v === true || v === null || v === undefined;
    });
    // Blueprint title style: the note's own name in quotes when it exists.
    const shareTitle = computed(() => {
      const title = noteStore.data[props.noteId]?.title;
      return title ? `Share “${title}”` : 'Share note';
    });
    const verifyTooltip = 'Please verify your email to invite collaborators.';
    // Mobile tab split: People is the default; Export only when the runtime provides actions.
    const mobileTab = ref('people');
    const mobileTabs = computed(() => {
      const share = translations.value?.share;
      const tabs = [{ id: 'people', label: share?.peopleTab || 'People' }];
      if (props.shareActions.length) {
        tabs.push({ id: 'export', label: share?.exportTab || 'Export' });
      }
      return tabs;
    });
    const selfName = computed(() => displayName(accountStore.profile));
    const selfRoleLabel = computed(() => {
      const selfId = accountStore.profile?.id;
      if (!selfId) return '';
      const self = collaborators.value.find((c) => c.userId === selfId);
      return self?.role ? roleLabel(self.role, translations.value) : '';
    });
    // The owner holds a self-invitation row, so the list already contains you:
    // drop it there and show it once, pinned at the top with (you).
    // Workspace members merged in by useNoteSharing carry `viaWorkspace`.
    const otherCollaborators = computed(() => {
      const selfId = accountStore.profile?.id;
      return selfId
        ? collaborators.value.filter((c) => c.userId !== selfId)
        : collaborators.value;
    });

    // Prefer the session-known link (raw token), else any live server link.
    const activeLink = computed(() => {
      const links = inviteLinks.value;
      return links.find((l) => l.token) || links[0] || null;
    });

    function getInviteUrl(token) {
      return `beaver-notes://join/${token}`;
    }

    function tpl(raw, params) {
      return Object.entries(params).reduce(
        (s, [k, v]) => s.replace(`{${k}}`, String(v)),
        raw,
      );
    }

    async function createLink(roleOverride) {
      const role =
        roleOverride || (linkAccess.value !== 'off' ? linkAccess.value : 'editor');
      linkLoading.value = true;
      linkError.value = '';
      try {
        await generateLink(props.noteId, {
          role,
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

    // TODO: Option B provisional one-link rule. The server keeps only a token
    // hash, so a previous session's link is unrecoverable. Auto-create only
    // when the server has none; never silently revoke existing links on open.
    async function ensureInviteLink() {
      if (!isAuthenticated.value) return;
      try {
        await fetchLinks(props.noteId);
      } catch {
        // Link fetch errors are non-critical
      }
      const links = inviteLinks.value;
      if (links.some((l) => l.token)) return;
      if (!links.length) await createLink();
    }

    async function revokeAllLinks() {
      const ids = inviteLinks.value.map((l) => l.id);
      await Promise.all(ids.map((id) => revokeLink(props.noteId, id)));
    }

    async function copyLink(token) {
      if (!token) return;
      await copyToClipboard(getInviteUrl(token));
    }

    function linkDialogOptions(title, body, icon) {
      return {
        title,
        body,
        icon,
        okText: translations.value?.dialog?.confirm || 'Confirm',
        cancelText: translations.value?.dialog?.cancel || 'Cancel',
      };
    }

    function handleResetLink() {
      const share = translations.value?.share;
      dialog.confirm({
        ...linkDialogOptions(
          share?.resetLinkTitle || 'Reset invite link?',
          share?.resetLinkBody || 'The current link stops working. A new one replaces it.',
          'riRestartLine',
        ),
        onConfirm: async () => {
          linkError.value = '';
          const role = activeLink.value?.role;
          try {
            await revokeAllLinks();
            await createLink(role);
          } catch (err) {
            linkError.value = err?.message || 'Failed to reset invite link';
            console.error('[ShareModal] resetLink failed:', err);
          }
        },
      });
    }

    function onAccessChange(value) {
      const current = activeLink.value?.role || 'off';
      if (value === current) return;
      const share = translations.value?.share;
      if (value === 'off') {
        dialog.confirm({
          ...linkDialogOptions(
            share?.linkOffTitle || 'Turn off link access?',
            share?.linkOffBody ||
              'Anyone with the link will no longer be able to join. People you invited stay.',
            'riLink',
          ),
          okVariant: 'danger',
          onConfirm: async () => {
            linkError.value = '';
            try {
              await revokeAllLinks();
            } catch (err) {
              linkError.value = err?.message || 'Failed to turn off link access';
            }
          },
        });
        return;
      }
      if (!activeLink.value) {
        createLink(value);
        return;
      }
      dialog.confirm({
        ...linkDialogOptions(
          share?.resetLinkTitle || 'Reset invite link?',
          share?.resetLinkBody ||
            'The current link stops working. A new one replaces it with the new access.',
          'riRestartLine',
        ),
        onConfirm: async () => {
          linkError.value = '';
          try {
            await revokeAllLinks();
            await createLink(value);
          } catch (err) {
            linkError.value = err?.message || 'Failed to reset invite link';
          }
        },
      });
    }

    // Derived from the live link, so cancelling a confirm snaps the select back.
    const linkAccess = computed({
      get: () => activeLink.value?.role || 'off',
      set: (value) => onAccessChange(value),
    });

    // Kept for the spec contract: per-link confirm + revoke.
    function handleRevokeLink(link) {
      const share = translations.value?.share;
      dialog.confirm({
        title: link.token
          ? tpl(share?.revokeLinkTitle || 'Revoke invite link {url}?', {
              url: getInviteUrl(link.token),
            })
          : share?.revokeLinkTitleNoUrl || 'Revoke invite link?',
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

    async function refresh() {
      if (!props.noteId) return;
      try {
        await sharing.fetchCollaborators(props.noteId);
      } catch {
        // Errors handled internally by useNoteSharing
      }
      try {
        await fetchJoinRequests(props.noteId);
      } catch {
        // Join-request fetch errors are non-critical
      }
      await ensureInviteLink();
    }

    watch(
      () => props.modelValue,
      async (open) => {
        if (open && props.noteId) {
          mobileTab.value = 'people';
          linkError.value = '';
          await refresh();
        }
      }
    );

    onMounted(() => {
      if (!props.noteId) return;
      if (props.modelValue) {
        refresh();
      } else {
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
        if (!result?.alreadyInvited) {
          triggerInteractionHaptic('noteCreate');
        }
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
            triggerInteractionHaptic('delete');
          } catch {
            // error is set in composable
          }
        },
      });
    }

    return {
      sharing,
      collaborators,
      translations,
      isAuthenticated,
      isMobile,
      INVITE_ROLE_OPTIONS,
      LINK_ACCESS_OPTIONS,
      EXPIRY_OPTIONS,
      inviteInput,
      inviteRole,
      inviting,
      inviteMessage,
      roleLabel,
      selfName,
      selfRoleLabel,
      otherCollaborators,
      inviteLinks,
      activeLink,
      linkAccess,
      linkLoading,
      linkError,
      linkExpiry,
      joinRequests,
      handleApproveRequest,
      handleDenyRequest,
      copyState,
      isEmailVerified,
      shareTitle,
      verifyTooltip,
      mobileTab,
      mobileTabs,
      createLink,
      copyLink,
      handleRevokeLink,
      handleResetLink,
      getInviteUrl,
      handleInvite,
      handleRemove,
      displayName,
    };
  },
};
</script>
