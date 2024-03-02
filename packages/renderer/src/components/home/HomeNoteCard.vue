<template>
  <ui-card
    class="hover:ring-2 ring-amber-300 group note-card transition flex flex-col"
    padding="p-5"
  >
    <!-- Display title and labels -->
    <div>
      <div class="font-semibold text-lg block line-clamp leading-tight">
        {{ note.title }}
      </div>
      <div
        v-if="note.labels.length !== 0"
        class="text-primary dark:text-amber-400 mt-2 mb-1 line-clamp w-full"
      >
        <span
          v-for="label in note.labels"
          :key="label"
          :to="`/?label=${label}`"
          class="inline-block mr-2 hover:underline cursor-pointer"
          @click="$emit('update:label', label)"
        >
          #{{ label }}
        </span>
      </div>
    </div>
    <!-- Display note content based on the note's lock status -->
    <router-link
      v-if="!note.isLocked"
      :to="`/note/${note.id}`"
      class="text-gray-600 block dark:text-gray-100 flex-1 overflow-none"
      style="min-height: 64px"
    >
      {{
        note.isLocked
          ? translations.card.unlocktoedit
          : truncateText(note.content, 160) || translations.card.content
      }}
    </router-link>
    <button
      v-if="note.isLocked"
      class="hover:text-gray-600 dark:text-white h-full mr-2 transition"
      @click="unlockNote(note.id)"
    >
      <v-remixicon
        class="w-24 h-auto text-gray-600 dark:text-white"
        name="riLockLine"
      />
      <div
        class="text-xs text-gray-500 dark:text-gray-400 invisible group-hover:visible dark:text-white"
      >
        {{ translations.card.unlocktoedit || '-' }}
      </div>
    </button>
    <div class="flex z-10 items-center mt-4 text-gray-600 dark:text-gray-200">
      <button
        v-if="!note.isArchived"
        v-tooltip.group="
          note.isBookmarked
            ? translations.card.removebookmark
            : translations.card.bookmark
        "
        class="hover:text-gray-900 mr-2 dark:hover:text-white transition"
        @click="$emit('update', { isBookmarked: !note.isBookmarked })"
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
        class="hover:text-gray-900 mr-2 dark:hover:text-white transition invisible group-hover:visible"
        @click="$emit('update', { isArchived: !note.isArchived })"
      >
        <v-remixicon
          :name="note.isArchived ? 'riInboxUnarchiveLine' : 'riArchiveLine'"
        />
      </button>
      <button
        v-if="!note.isLocked"
        v-tooltip.group="translations.card.lock"
        class="hover:text-gray-900 mr-2 dark:hover:text-white transition invisible group-hover:visible"
        @click="lockNote(note.id)"
      >
        <v-remixicon name="riLockLine" />
      </button>
      <button
        v-if="note.isLocked"
        v-tooltip.group="translations.card.unlock"
        class="hover:text-gray-900 mr-2 dark:hover:text-white transition invisible group-hover:visible"
        @click="unlockNote(note.id)"
      >
        <v-remixicon name="riLockUnlockLine" />
      </button>
      <button
        v-tooltip.group="translations.card.delete"
        class="hover:text-red-500 dark:hover:text-red-400 transition invisible group-hover:visible"
        @click="deleteNote(note.id)"
      >
        <v-remixicon name="riDeleteBin6Line" />
      </button>
      <div class="flex-grow"></div>
      <p class="text-overflow">
        {{
          note.isLocked
            ? translations.card.islocked
            : formatDate(note.createdAt)
        }}
      </p>
    </div>
  </ui-card>
</template>
<script setup>
/* eslint-disable no-undef */
import dayjs from '@/lib/dayjs';
import '../../assets/css/passwd.css';
import { useNoteStore } from '@/store/note';
import { truncateText } from '@/utils/helper';
import { usePasswordStore } from '@/store/passwd';
import { useGroupTooltip } from '@/composable/groupTooltip';
import { onMounted, shallowReactive } from 'vue';
import { useDialog } from '@/composable/dialog';
import 'dayjs/locale/it';
import 'dayjs/locale/de';
import 'dayjs/locale/zh';
import 'dayjs/locale/nl';

defineProps({
  note: {
    type: Object,
    default: () => ({}),
  },
});
defineEmits(['update', 'update:label']);

const dialog = useDialog();

useGroupTooltip();

async function lockNote(note) {
  const passwordStore = usePasswordStore(); // Get the password store instance
  const noteStore = useNoteStore(); // Get the note store instance

  try {
    const hassharedKey = await passwordStore.retrieve(); // Retrieve the global password

    if (!hassharedKey) {
      // If there's no global password set, prompt the user to set it
      dialog.prompt({
        title: translations.card.enterpasswd,
        okText: translations.card.setkey,
        body: translations.settings.warning,
        cancelText: translations.card.Cancel,
        placeholder: translations.card.Password,
        onConfirm: async (newKey) => {
          if (newKey) {
            try {
              // Set the global password
              await passwordStore.setsharedKey(newKey);
              // Lock the note using the global password
              await noteStore.lockNote(note, newKey);
              console.log(`Note (ID: ${note}) is locked`);
            } catch (error) {
              console.error('Error setting up key:', error);
              alert(translations.card.keyfail);
            }
          } else {
            alert(translations.card.keyfail);
          }
        },
      });
    } else {
      // If the global password is set, prompt the user to enter it to lock the note
      dialog.prompt({
        title: translations.card.enterpasswd,
        okText: translations.card.lock,
        cancelText: translations.card.Cancel,
        placeholder: translations.card.Password,
        onConfirm: async (enteredPassword) => {
          // Validate the entered password against the stored global password
          const isValidPassword = await passwordStore.isValidPassword(
            enteredPassword
          );
          if (isValidPassword) {
            // If the entered password matches the stored one, lock the note
            await noteStore.lockNote(note, enteredPassword);
            console.log(`Note (ID: ${note}) is locked`);
          } else {
            // If the entered password does not match, show an error message
            alert(translations.card.wrongpasswd);
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
    title: translations.card.enterpasswd,
    okText: translations.card.unlock,
    cancelText: translations.card.Cancel,
    placeholder: translations.card.Password,
    onConfirm: async (enteredPassword) => {
      try {
        // Validate the entered password against the global password
        const isValidPassword = await passwordStore.isValidPassword(
          enteredPassword
        );
        if (isValidPassword) {
          console.log(translations.card.Passwordcorrect);
          // Note unlocked using the global password
          await noteStore.unlockNote(note, enteredPassword);
          console.log(`Note (ID: ${note}) is unlocked`);
        } else {
          alert(translations.card.wrongpasswd);
        }
      } catch (error) {
        console.error('Error unlocking note:', error);
        alert(translations.card.wrongpasswd);
      }
    },
  });
}

async function deleteNote(note) {
  const noteStore = useNoteStore();

  dialog.confirm({
    title: translations.card.confirmPrompt,
    okText: translations.card.confirm,
    cancelText: translations.card.Cancel,
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

const translations = shallowReactive({
  card: {
    unarchive: 'card.unarchive',
    archive: 'card.archive',
    removebookmark: 'card.removebookmark',
    bookmark: 'card.bookmark',
    delete: 'card.delete',
    content: 'card.content',
    lock: 'card.lock',
    unlock: 'card.unlock',
    islocked: 'card.islocked',
    unlocktoedit: 'card.unlocktoedit',
    setupkey: 'card.setupkey',
    setkey: 'card.setkey',
    Cancel: 'card.Cancel',
    NewKey: 'card.NewKey',
    nokey: 'card.nokey',
    enteredPassword: 'card.enteredPassword',
    Password: 'card.Password',
    wrongpasswd: 'card.wrongpasswd',
    Passwordcorrect: 'card.passwordcorrect',
    warning: 'card.warning',
    keyfail: 'card.keyfail',
  },
});

onMounted(async () => {
  const loadedTranslations = await loadTranslations();
  if (loadedTranslations) {
    Object.assign(translations, loadedTranslations);
  }
});

const loadTranslations = async () => {
  const selectedLanguage = localStorage.getItem('selectedLanguage') || 'en';
  try {
    const translationModule = await import(
      `../../pages/settings/locales/${selectedLanguage}.json`
    );
    return translationModule.default;
  } catch (error) {
    console.error('Error loading translations:', error);
    return null;
  }
};
</script>
<style>
.note-card.active-note .group-hover\:visible {
  visibility: visible;
}
</style>
