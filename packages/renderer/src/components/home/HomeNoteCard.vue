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
      <!-- Show different content for locked and unlocked notes -->
      {{
        note.isLocked
          ? 'Note is locked'
          : truncateText(note.content, 160) || translations.card.content
      }}
    </router-link>
    <button
      v-if="note.isLocked"
      class="hover:text-gray-600 dark:text-white h-full mr-2 transition"
      @click="unlockCard(note.id)"
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
        v-tooltip.group="translations.card.lock"
        class="hover:text-gray-900 mr-2 dark:hover:text-white transition invisible group-hover:visible"
        @click="unlockNote(note.id)"
      >
        <v-remixicon name="riLockUnlockLine" />
      </button>
      <button
        v-tooltip.group="translations.card.delete"
        class="hover:text-red-500 dark:hover:text-red-400 transition invisible group-hover:visible"
        @click="$emit('delete', note.id)"
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
import { useGroupTooltip } from '@/composable/groupTooltip';
import { onMounted, shallowReactive, ref } from 'vue';
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
defineEmits(['update', 'delete', 'update:label']);

const isLocked = ref(false);
const dialog = useDialog();
const userPassword = ref('');
const noteStore = useNoteStore();

useGroupTooltip();

async function lockNote(note) {
  const sharedKey = localStorage.getItem('sharedKey');
  const lockedNotes = JSON.parse(localStorage.getItem('lockedNotes')) || {};

  if (!sharedKey) {
    dialog.prompt({
      title: translations.card.setupkey,
      okText: translations.card.setkey,
      cancelText: translations.card.Cancel,
      placeholder: translations.card.NewKey,
      onConfirm: async (newKey) => {
        if (newKey) {
          const encoder = new TextEncoder();
          const sharedKeyBuffer = encoder.encode(newKey);

          crypto.subtle.digest('SHA-256', sharedKeyBuffer).then((hash) => {
            const hashArray = Array.from(new Uint8Array(hash));
            const hashHex = hashArray
              .map((byte) => byte.toString(16).padStart(2, '0'))
              .join('');

            localStorage.setItem('sharedKey', hashHex);
            noteStore.lockNote(note);
            isLocked.value = true;
            lockedNotes[note] = true; // Lock the note using its ID
            localStorage.setItem('lockedNotes', JSON.stringify(lockedNotes));
            console.log(`Note (ID: ${note}) is locked`);
          });
        } else {
          alert(translations.card.keyfail);
        }
      },
    });
  } else {
    noteStore.lockNote(note);
    isLocked.value = true;
    lockedNotes[note] = true; // Lock the note using its ID
    localStorage.setItem('lockedNotes', JSON.stringify(lockedNotes));
    console.log(`Note (ID: ${note}) is locked`);
  }
}

async function unlockCard(note) {
  const sharedKey = localStorage.getItem('sharedKey');
  const lockedNotes = JSON.parse(localStorage.getItem('lockedNotes')) || {};

  if (!sharedKey) {
    alert(translations.card.nokey);
  } else {
    dialog.prompt({
      title: translations.card.enterpasswd,
      okText: translations.card.Unlock,
      cancelText: translations.card.Cancel,
      placeholder: translations.card.Password,
      onConfirm: async (enteredPassword) => {
        const encoder = new TextEncoder();
        const enteredPasswordBuffer = encoder.encode(enteredPassword);

        crypto.subtle.digest('SHA-256', enteredPasswordBuffer).then((hash) => {
          const hashArray = Array.from(new Uint8Array(hash));
          const hashHex = hashArray
            .map((byte) => byte.toString(16).padStart(2, '0'))
            .join('');

          if (hashHex === sharedKey) {
            console.log(translations.card.Passwordcorrect);
            // Note unlocked
            isLocked.value = false;
            userPassword.value = '';
            noteStore.unlockNote(note);
            lockedNotes[note] = false; // Unlock the note using its ID
          } else {
            console.log(translations.card.Passwordcorrect);
            alert(translations.card.wrongpasswd);
          }
        });
      },
    });
  }
}

async function unlockNote(note) {
  const sharedKey = localStorage.getItem('sharedKey');
  const lockedNotes = JSON.parse(localStorage.getItem('lockedNotes')) || {};

  if (!sharedKey) {
    alert(translations.card.nokey);
  } else {
    dialog.prompt({
      title: translations.card.enterpasswd,
      okText: translations.card.Unlock,
      cancelText: translations.card.Cancel,
      placeholder: translations.card.Password,
      onConfirm: async (enteredPassword) => {
        const encoder = new TextEncoder();
        const enteredPasswordBuffer = encoder.encode(enteredPassword);

        crypto.subtle.digest('SHA-256', enteredPasswordBuffer).then((hash) => {
          const hashArray = Array.from(new Uint8Array(hash));
          const hashHex = hashArray
            .map((byte) => byte.toString(16).padStart(2, '0'))
            .join('');

          if (hashHex === sharedKey) {
            console.log(translations.card.Passwordcorrect);
            // Note unlocked
            isLocked.value = false;
            userPassword.value = '';
            noteStore.unlockNote(note);
            lockedNotes[note] = false; // Unlock the note using its ID
            localStorage.setItem('lockedNotes', JSON.stringify(lockedNotes));
            // Optionally, you can emit an event to notify the parent component
          } else {
            console.log(translations.card.Passwordcorrect);
            alert(translations.card.wrongpasswd);
          }
        });
      },
    });
  }
}

function checkLockedNotes() {
  const lockedNotes = JSON.parse(localStorage.getItem('lockedNotes')) || {};

  // Iterate through the keys in the local storage
  for (const noteId in lockedNotes) {
    if (noteId === 'undefined') {
      // Skip the 'undefined' key
      continue;
    }

    const isLocked = lockedNotes[noteId];
    if (isLocked) {
      noteStore.lockNote(noteId);
    }
  }
}

// Call the function to check and output locked notes
checkLockedNotes();

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
    keyfail: 'card.keyfail',
    nokey: 'card.nokey',
    enteredPassword: 'card.enteredPassword',
    Password: 'card.Password',
    wrongpasswd: 'card.wrongpasswd',
    Passwordcorrect: 'card.passwordcorrect',
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
