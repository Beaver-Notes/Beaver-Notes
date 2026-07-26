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
      <div v-if="sharing.noteShared" class="p-3 rounded-lg bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400 text-sm">
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
    </div>
  </ui-modal>
</template>

<script>
import { ref, watch } from 'vue';
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

    watch(
      () => props.modelValue,
      async (open) => {
        if (open && props.noteId) {
          await sharing.fetchCollaborators(props.noteId);
        }
      }
    );

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
      await sharing.remove(props.noteId, userId);
    }

    return {
      sharing,
      inviteInput,
      inviteRole,
      inviting,
      handleInvite,
      handleRemove,
      getAvatarColor,
      getInitials,
    };
  },
};
</script>
