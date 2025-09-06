<template>
  <ui-card
    class="hover:ring-2 hover:ring-secondary group note-card transition flex flex-col"
    padding="p-5"
  >
    <div>
      <div class="font-semibold text-lg block line-clamp leading-tight">
        {{ note.title || translations.card.untitledNote }}
      </div>
      <div
        v-if="note.labels.length !== 0"
        class="text-primary dark:text-primary mt-2 mb-1 line-clamp w-full space-x-1"
      >
        <span
          v-for="label in note.labels"
          :key="label"
          :to="`/?label=${label}`"
          class="inline-block hover:underline cursor-pointer"
          @click="$emit('update:label', label)"
        >
          #{{ label }}
        </span>
      </div>
    </div>
    <router-link
      v-if="!note.isLocked"
      :to="`/note/${note.id}`"
      class="text-neutral-600 block dark:text-[color:var(--selected-dark-text)] flex-1 overflow-hidden overflow-ellipsis"
      style="min-height: 64px"
    >
      {{
        note.isLocked
          ? translations.card.unlockToEdit
          : truncateText(note.content, 160) || translations.card.content
      }}
    </router-link>
    <button
      v-if="note.isLocked"
      class="hover:text-neutral-600 dark:text-[color:var(--selected-dark-text)] h-full transition"
      @click="unlockNote(note.id)"
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
    <div
      class="flex z-10 items-center mt-4 text-neutral-600 dark:text-neutral-200 gap-2"
    >
      <button
        v-if="!note.isArchived"
        v-tooltip.group="
          note.isBookmarked
            ? translations.card.removeBookmark
            : translations.card.bookmark
        "
        :class="[
          note.isBookmarked
            ? 'text-primary opacity-90 hover:opacity-100'
            : 'hover:text-neutral-900 dark:hover:text-[color:var(--selected-dark-text)] transition',
        ]"
        @click="toggleBookmark(note)"
      >
        <v-remixicon
          :name="note.isBookmarked ? 'riBookmarkFill' : 'riBookmarkLine'"
        />
      </button>
      <button
        v-tooltip.group="
          note.isArchived
            ? translations.card.unarchive
            : translations.card.archive
        "
        class="hover:text-neutral-900 dark:hover:text-[color:var(--selected-dark-text)] transition invisible group-hover:visible"
        @click="toggleArchive(note)"
      >
        <v-remixicon
          :name="note.isArchived ? 'riInboxUnarchiveLine' : 'riArchiveLine'"
        />
      </button>
      <button
        v-if="!note.isLocked"
        v-tooltip.group="translations.card.lock"
        class="hover:text-neutral-900 dark:hover:text-[color:var(--selected-dark-text)] transition invisible group-hover:visible"
        @click="lockNote(note.id)"
      >
        <v-remixicon name="riLockLine" />
      </button>
      <button
        v-if="note.isLocked"
        v-tooltip.group="translations.card.unlock"
        class="hover:text-neutral-900 dark:hover:text-[color:var(--selected-dark-text)] transition invisible group-hover:visible"
        @click="unlockNote(note.id)"
      >
        <v-remixicon
          :name="note.isLocked ? 'riLockUnlockLine' : 'riLockLine'"
        />
      </button>
      <button
        v-tooltip.group="translations.card.moveToFolder"
        class="hover:text-neutral-900 dark:hover:text-[color:var(--selected-dark-text)] transition invisible group-hover:visible"
        @click="showMoveModal = true"
      >
        <v-remixicon name="riFolderTransferLine" />
      </button>
      <button
        v-tooltip.group="translations.card.delete"
        class="hover:text-red-500 rtl: dark:hover:text-red-400 transition invisible group-hover:visible"
        @click="deleteNote(note.id)"
      >
        <v-remixicon name="riDeleteBin6Line" />
      </button>
      <div class="flex-grow"></div>
      <p class="text-overflow">
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
import { useNoteStore } from '@/store/note';
import { truncateText } from '@/utils/helper';
import { usePasswordStore } from '@/store/passwd';
import { useGroupTooltip } from '@/composable/groupTooltip';
import { useTranslation } from '@/composable/translations';
import { onMounted, ref } from 'vue';
import { forceSyncNow } from '@/utils/sync.js';
import { useDialog } from '@/composable/dialog';
import FolderTree from './FolderTree.vue';
import 'dayjs/locale/it';
import 'dayjs/locale/de';
import 'dayjs/locale/zh';
import 'dayjs/locale/nl';
import 'dayjs/locale/es';
import 'dayjs/locale/uk';
import 'dayjs/locale/ru';
import 'dayjs/locale/fr';
import 'dayjs/locale/tr';

defineProps({
  note: {
    type: Object,
    default: () => ({}),
  },
});
const emit = defineEmits(['update', 'update:label']);

const dialog = useDialog();
const showMoveModal = ref(false);

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
              alert(translations.value.card.keyFail);
            }
          } else {
            alert(translations.value.card.keyFail);
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
            alert(translations.value.card.wrongPasswd);
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
            console.log('test');
            await noteStore.unlockNote(note, enteredPassword);
            await passwordStore.setsharedKey(enteredPassword);
          } catch (error) {
            alert(translations.value.card.wrongPasswd);
            return;
          }
        } else {
          const isValidPassword = await passwordStore.isValidPassword(
            enteredPassword
          );
          if (isValidPassword) {
            await noteStore.unlockNote(note, enteredPassword);
          } else {
            alert(translations.value.card.wrongPasswd);
          }
        }
      } catch (error) {
        console.error('Error unlocking note:', error);
        alert(translations.value.card.wrongPasswd);
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

const selectedLanguage = localStorage.getItem('selectedLanguage') || 'en';

dayjs.locale(selectedLanguage);

function formatDate(date) {
  return dayjs(date).fromNow();
}

// Translations
const translations = ref({
  card: {},
});

onMounted(async () => {
  await useTranslation().then((trans) => {
    if (trans) {
      translations.value = trans;
    }
  });
  const autoSync = localStorage.getItem('autoSync');
  if (autoSync === 'true') {
    forceSyncNow();
  }
});

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
