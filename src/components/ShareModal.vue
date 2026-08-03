<template>
  <ui-modal
    :model-value="modelValue"
    content-class="max-w-md"
    @close="$emit('update:modelValue', false)"
  >
    <template #header>
      <div class="flex items-center gap-2">
        <v-remixicon name="riShareLine" size="20" />
        <span class="font-semibold">Share Note</span>
      </div>
    </template>

    <div class="space-y-4">
      <div v-if="sharing.key" class="p-3 rounded-lg bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400 text-sm">
        <v-remixicon name="riCheckLine" size="16" class="inline mr-1" />
        Collaboration enabled for this note
      </div>

      <div>
        <label class="block text-sm font-medium text-neutral-700 dark:text-neutral-300 mb-1">
          Invite by username or email
        </label>
        <div class="flex gap-2">
          <input
            v-model="inviteInput"
            type="text"
            placeholder="username or email"
            class="flex-1 px-3 py-2 rounded-lg border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-800 text-sm text-neutral-900 dark:text-neutral-100 placeholder-neutral-400 dark:placeholder-neutral-500 focus:outline-none focus:ring-2 focus:ring-primary/50"
            @keydown.enter="handleInvite"
          />
          <select
            v-model="inviteRole"
            class="px-2 py-2 rounded-lg border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-800 text-sm text-neutral-900 dark:text-neutral-100 focus:outline-none focus:ring-2 focus:ring-primary/50"
          >
            <option value="editor">Editor</option>
            <option value="viewer">Viewer</option>
          </select>
          <button
            :disabled="!inviteInput.trim() || inviting"
            class="px-4 py-2 rounded-lg bg-primary text-white text-sm font-medium hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            @click="handleInvite"
          >
            {{ inviting ? '...' : 'Invite' }}
          </button>
        </div>
        <p v-if="sharing.error.value" class="mt-1 text-sm text-red-500">
          {{ sharing.error.value }}
        </p>
      </div>

      <div v-if="sharing.collaborators.value.length > 0">
        <h4 class="text-sm font-medium text-neutral-700 dark:text-neutral-300 mb-2">
          Collaborators
        </h4>
        <ul class="space-y-1">
          <li
            v-for="collab in sharing.collaborators.value"
            :key="collab.userId"
            class="flex items-center justify-between p-2 rounded-lg hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors"
          >
            <div class="flex items-center gap-2">
              <div
                class="w-8 h-8 rounded-full flex items-center justify-center text-xs font-medium text-white"
                :style="{ backgroundColor: getAvatarColor(collab.userId) }"
              >
                {{ getInitials(collab.username || collab.email) }}
              </div>
              <div>
                <p class="text-sm font-medium text-neutral-900 dark:text-neutral-100">
                  {{ collab.username || collab.email || 'Unknown' }}
                </p>
                <p class="text-xs text-neutral-500 dark:text-neutral-400">
                  {{ collab.role }}
                </p>
              </div>
            </div>
            <button
              class="text-neutral-400 hover:text-red-500 transition-colors p-1"
              title="Remove collaborator"
              @click="handleRemove(collab.userId)"
            >
              <v-remixicon name="riCloseLine" size="16" />
            </button>
          </li>
        </ul>
      </div>

      <div v-else-if="!sharing.loading.value" class="text-center py-4 text-sm text-neutral-500 dark:text-neutral-400">
        No collaborators yet. Invite someone to start collaborating.
      </div>

      <!-- Invite Link Section -->
      <div class="border-t border-neutral-200 dark:border-neutral-700 pt-4 mt-4">
        <h4 class="text-xs font-semibold text-neutral-500 dark:text-neutral-400 uppercase tracking-wide mb-3">
          Invite Link
        </h4>

        <div class="space-y-3">
          <div class="flex gap-2">
            <select
              v-model="linkRole"
              class="flex-1 text-xs border border-neutral-200 dark:border-neutral-600 rounded-md px-2 py-1.5 bg-white dark:bg-neutral-800"
            >
              <option value="editor">Can edit</option>
              <option value="viewer">Can view</option>
            </select>
            <select
              v-model="linkExpiry"
              class="flex-1 text-xs border border-neutral-200 dark:border-neutral-600 rounded-md px-2 py-1.5 bg-white dark:bg-neutral-800"
            >
              <option value="null">Never expires</option>
              <option value="86400000">24 hours</option>
              <option value="604800000">7 days</option>
              <option value="2592000000">30 days</option>
            </select>
          </div>
          <button
            @click="createLink"
            :disabled="linkLoading"
            class="w-full text-xs font-medium px-3 py-2 rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50 transition-colors"
          >
            {{ linkLoading ? 'Creating...' : 'Create Invite Link' }}
          </button>
        </div>

        <div v-if="inviteLinks.length" class="mt-4 space-y-2">
          <div
            v-for="link in inviteLinks"
            :key="link.id"
            class="flex items-center gap-2 p-2 rounded-lg bg-neutral-50 dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700"
          >
            <div class="flex-1 min-w-0">
              <p class="text-xs font-medium text-neutral-700 dark:text-neutral-300 truncate">
                {{ getInviteUrl(link.token) }}
              </p>
              <p class="text-[10px] text-neutral-400">
                {{ link.role }} · {{ link.expiresAt ? 'Expires ' + formatDate(link.expiresAt) : 'No expiry' }}
              </p>
            </div>
            <button
              @click="copyLink(link.token)"
              class="p-1 text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-300"
              title="Copy link"
            >
              <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3m2 4H10m0 0l3-3m-3 3l3 3" />
              </svg>
            </button>
            <button
              @click="handleRevokeLink(link.id)"
              class="p-1 text-neutral-400 hover:text-red-500"
              title="Revoke link"
            >
              <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              </svg>
            </button>
          </div>
        </div>
      </div>
    </div>
  </ui-modal>
</template>

<script>
import { ref, watch, onMounted } from 'vue';
import { useNoteSharing } from '@/composable/useNoteSharing';

const AVATAR_COLORS = [
  '#3B82F6', '#EF4444', '#10B981', '#F59E0B', '#8B5CF6',
  '#EC4899', '#06B6D4', '#F97316', '#6366F1', '#14B8A6',
];

function getAvatarColor(str) {
  if (!str) return AVATAR_COLORS[0];
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash);
  }
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}

function getInitials(name) {
  if (!name) return '?';
  return name.slice(0, 2).toUpperCase();
}

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
    const linkExpiry = ref('null');

    function getInviteUrl(token) {
      return `${window.location.origin}/join/${token}`;
    }

    async function createLink() {
      await generateLink(props.noteId, {
        role: linkRole.value,
        expiresIn: linkExpiry.value === 'null' ? null : parseInt(linkExpiry.value),
      });
    }

    function copyLink(token) {
      navigator.clipboard.writeText(getInviteUrl(token));
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
          await sharing.fetchCollaborators(props.noteId);
          await fetchLinks(props.noteId);
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
      inviteInput,
      inviteRole,
      inviting,
      inviteLinks,
      linkLoading,
      linkRole,
      linkExpiry,
      createLink,
      copyLink,
      revokeLink: handleRevokeLink,
      getInviteUrl,
      formatDate,
      handleInvite,
      handleRemove,
      getAvatarColor,
      getInitials,
    };
  },
};
</script>
