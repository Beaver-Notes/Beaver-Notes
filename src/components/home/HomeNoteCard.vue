<template>
  <ui-card
    data-testid="note-card"
    class="hover:ring-1 hover:ring-primary/20 hover:shadow-md hover:shadow-neutral-200/60 dark:hover:shadow-neutral-900 group note-card transition-all duration-200 flex flex-col cursor-pointer"
    padding="p-0"
    @click="openNote(note.id)"
  >
    <!-- Conflict banner -->
    <div
      v-if="note.isConflict"
      class="flex items-center gap-2 px-4 py-2 bg-amber-50 dark:bg-amber-900/20 border-b border-amber-200 dark:border-amber-800 text-amber-700 dark:text-amber-400 text-xs"
    >
      <v-remixicon name="riErrorWarningLine" size="14" class="flex-shrink-0" />
      <span class="flex-1">{{
        translations.card.conflictCopy ||
        'Conflict copy — review and delete one version'
      }}</span>
    </div>

    <div class="p-4 flex-1">
      <div>
        <div
          data-testid="note-card-title"
          class="text-md font-semibold text-lg block line-clamp leading-tight"
        >
          {{ note.title || translations.card.untitledNote }}
        </div>
        <div
          v-if="note.labels.length !== 0"
          class="text-primary dark:text-primary mt-2 mb-1 line-clamp w-full space-x-1"
        >
          <span
            v-for="label in note.labels"
            :key="label"
            class="inline-block hover:underline cursor-pointer px-1.5 py-0.5 bg-primary/10 dark:bg-primary/10 rounded-lg text-sm text-primary"
            :style="
              labelColor(label)
                ? {
                    color: labelColor(label),
                    backgroundColor: labelColor(label) + '1a',
                  }
                : {}
            "
            @click.stop="$emit('update:label', label)"
          >
            #{{ label }}
          </span>
        </div>
      </div>
      <div
        v-if="!note.isLocked"
        class="text-sm text-neutral-600 block dark:text-[color:var(--selected-dark-text)] flex-1 overflow-hidden overflow-ellipsis"
        style="min-height: 64px"
      >
        {{
          note.isLocked
            ? translations.card.unlockToEdit
            : truncateText(note.content, 160) || translations.card.content
        }}
      </div>
      <button
        v-if="note.isLocked"
        class="hover:text-neutral-600 dark:text-[color:var(--selected-dark-text)] h-full transition"
        @click.stop="unlockNote(note.id)"
      >
        <v-remixicon
          class="w-24 h-auto text-neutral-600 dark:text-[color:var(--selected-dark-text)]"
          name="riLockLine"
        />
        <div
          class="text-xs text-neutral-500 dark:text-neutral-400 invisible group-hover:visible dark:text-[color:var(--selected-dark-text)]"
        >
          {{ translations.card.unlockToEdit || '-' }}
        </div>
      </button>
    </div>

    <div
      class="bg-neutral-500/5 dark:bg-white/5 flex z-10 items-center text-neutral-600 dark:text-neutral-200 gap-1 p-2 px-4 bottom-0"
    >
      <button
        v-if="!note.isArchived"
        v-tooltip.group="
          note.isBookmarked
            ? translations.card.removeBookmark
            : translations.card.bookmark
        "
        class="size-7 aspect-square flex items-center justify-center rounded-lg hover:bg-black/5 dark:hover:bg-white/10"
        :class="[
          note.isBookmarked
            ? 'text-primary'
            : 'hover:text-neutral-900 transition',
        ]"
        @click.stop="toggleBookmark(note)"
      >
        <v-remixicon
          :name="note.isBookmarked ? 'riBookmarkFill' : 'riBookmarkLine'"
          class="size-5"
        />
      </button>

      <button
        v-tooltip.group="
          note.isArchived
            ? translations.card.unarchive
            : translations.card.archive
        "
        class="size-7 aspect-square flex items-center justify-center rounded-lg hover:bg-black/5 dark:hover:bg-white/10 transition invisible group-hover:visible"
        @click.stop="toggleArchive(note)"
      >
        <v-remixicon
          :name="note.isArchived ? 'riInboxUnarchiveLine' : 'riArchiveLine'"
          class="size-5"
        />
      </button>

      <button
        v-if="!note.isLocked"
        v-tooltip.group="translations.card.lock"
        class="size-7 aspect-square flex items-center justify-center rounded-lg hover:bg-black/5 dark:hover:bg-white/10 transition invisible group-hover:visible"
        @click.stop="lockNote(note.id)"
      >
        <v-remixicon name="riLockLine" class="size-5" />
      </button>

      <button
        v-if="note.isLocked"
        v-tooltip.group="translations.card.unlock"
        class="size-7 aspect-square flex items-center justify-center rounded-lg hover:bg-black/5 dark:hover:bg-white/10 transition invisible group-hover:visible"
        @click.stop="unlockNote(note.id)"
      >
        <v-remixicon
          :name="note.isLocked ? 'riLockUnlockLine' : 'riLockLine'"
          class="size-5"
        />
      </button>

      <button
        v-tooltip.group="translations.card.moveToFolder"
        class="size-7 aspect-square flex items-center justify-center rounded-lg hover:bg-black/5 dark:hover:bg-white/10 transition invisible group-hover:visible"
        @click.stop="showMoveModal = true"
      >
        <v-remixicon name="riFolderTransferLine" class="size-5" />
      </button>

      <button
        v-tooltip.group="translations.card.delete"
        class="size-7 aspect-square flex items-center justify-center rounded-lg hover:bg-red-500/5 hover:text-red-500 transition invisible group-hover:visible"
        @click.stop="deleteNote(note.id)"
      >
        <v-remixicon name="riDeleteBin6Line" class="size-5" />
      </button>

      <div class="flex-grow"></div>

      <p class="text-overflow text-sm opacity-70">
        {{
          note.isLocked
            ? translations.card.isLocked
            : formatDate(note.createdAt)
        }}
      </p>
    </div>

    <folder-tree v-model="showMoveModal" :notes="[note]" mode="note" />
  </ui-card>
</template>

<script setup>
/* eslint-disable no-undef */
import dayjs from '@/lib/dayjs';
import { ref } from 'vue';
import { useNoteStore } from '@/store/note';
import { truncateText } from '@/utils/helper';
import { usePasswordStore } from '@/store/passwd';
import { useGroupTooltip } from '@/composable/groupTooltip';
import { getSettingSync } from '@/composable/settings';
import { useTranslations } from '@/composable/useTranslations';
import { useRouter } from 'vue-router';
import { useDialog } from '@/composable/dialog';
import FolderTree from './FolderTree.vue';
import { useLabelStore } from '@/store/label';

defineProps({
  note: {
    type: Object,
    default: () => ({}),
  },
});
const emit = defineEmits(['update', 'update:label']);

const labelStore = useLabelStore();

/** Return the stored colour for a label name, falling back to the CSS primary var */
function labelColor(name) {
  return labelStore.getColor(name);
}

const router = useRouter();
const dialog = useDialog();
const showMoveModal = ref(false);
const showCardAlert = (message) =>
  dialog.alert({
    title: translations.value.settings?.alertTitle || 'Alert',
    body: message,
    okText: translations.value.dialog?.close || 'Close',
  });

useGroupTooltip();

async function lockNote(note) {
  const passwordStore = usePasswordStore();
  const noteStore = useNoteStore();

  try {
    const hassharedKey = await passwordStore.retrieve();

    if (!hassharedKey) {
      dialog.prompt({
        title: translations.value.card.enterPasswd,
        okText: translations.value.card.setKey,
        body: translations.value.card.warning,
        cancelText: translations.value.card.cancel,
        placeholder: translations.value.card.password,
        onConfirm: async (newKey) => {
          if (newKey) {
            try {
              await passwordStore.setsharedKey(newKey);
              await noteStore.lockNote(note, newKey);
            } catch (error) {
              showCardAlert(translations.value.card.keyFail);
            }
          } else {
            showCardAlert(translations.value.card.keyFail);
          }
        },
      });
    } else {
      dialog.prompt({
        title: translations.value.card.enterPasswd,
        okText: translations.value.card.lock,
        cancelText: translations.value.card.cancel,
        placeholder: translations.value.card.password,
        onConfirm: async (enteredPassword) => {
          const isValidPassword = await passwordStore.isValidPassword(
            enteredPassword
          );
          if (isValidPassword) {
            await noteStore.lockNote(note, enteredPassword);
          } else {
            showCardAlert(translations.value.card.wrongPasswd);
          }
        },
      });
    }
  } catch (error) {
    console.error('Error locking note:', error);
  }
}

async function unlockNote(note) {
  const passwordStore = usePasswordStore();
  const noteStore = useNoteStore();

  dialog.prompt({
    title: translations.value.card.enterPasswd,
    okText: translations.value.card.unlock,
    cancelText: translations.value.card.cancel,
    placeholder: translations.value.card.password,
    onConfirm: async (enteredPassword) => {
      try {
        const hassharedKey = await passwordStore.retrieve();

        if (!hassharedKey) {
          try {
            await noteStore.unlockNote(note, enteredPassword);
            await passwordStore.setsharedKey(enteredPassword);
          } catch (error) {
            showCardAlert(translations.value.card.wrongPasswd);
            return;
          }
        } else {
          const isValidPassword = await passwordStore.isValidPassword(
            enteredPassword
          );
          if (isValidPassword) {
            await noteStore.unlockNote(note, enteredPassword);
          } else {
            showCardAlert(translations.value.card.wrongPasswd);
          }
        }
      } catch (error) {
        console.error('Error unlocking note:', error);
        showCardAlert(translations.value.card.wrongPasswd);
      }
    },
  });
}

async function deleteNote(note) {
  const noteStore = useNoteStore();

  dialog.confirm({
    title: translations.value.card.confirmPrompt,
    okText: translations.value.card.confirm,
    cancelText: translations.value.card.cancel,
    onConfirm: async () => {
      await noteStore.delete(note);
    },
  });
}

const selectedLanguage = getSettingSync('selectedLanguage');

dayjs.locale(selectedLanguage);

function formatDate(date) {
  return dayjs(date).fromNow();
}

const { translations } = useTranslations();

function openNote(noteId) {
  router.push(`/note/${noteId}`);
}

async function emitUpdate(payload) {
  emit('update', payload);
}

async function toggleBookmark(note) {
  emitUpdate({ isBookmarked: !note.isBookmarked });
}

async function toggleArchive(note) {
  emitUpdate({ isArchived: !note.isArchived });
}
</script>

<style>
.note-card.active-note .group-hover\:visible {
  visibility: visible;
}
</style>
