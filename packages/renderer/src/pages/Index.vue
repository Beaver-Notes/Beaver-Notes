<!-- eslint-disable vue/multi-word-component-names -->
<template>
  <div class="container py-5">
    <h1 class="text-3xl mb-8 font-bold">
      {{ translations.sidebar.Notes || '-' }}
    </h1>
    <home-note-filter
      v-model:query="state.query"
      v-model:label="state.activeLabel"
      v-model:sortBy="state.sortBy"
      v-model:sortOrder="state.sortOrder"
      v-bind="{
        labels: labelStore.data,
      }"
      @delete:label="deleteLabel"
    />
    <div
      v-if="noteStore.notes.length !== 0"
      class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4"
    >
      <template
        v-for="name in $route.query.archived
          ? ['archived']
          : ['bookmarked', 'all']"
        :key="name"
      >
        <p
          v-if="notes[name].length !== 0"
          class="col-span-full text-gray-600 dark:text-[color:var(--selected-dark-text)] capitalize"
          :class="{ 'mt-2': name === 'all' }"
        >
          {{ translations.index[name] }}
        </p>
        <home-note-card
          v-for="note in notes[name]"
          :key="note.id"
          :note-id="note.id"
          :is-locked="note.isLocked"
          v-bind="{ note }"
          @update:label="state.activeLabel = $event"
          @update="noteStore.update(note.id, $event)"
        />
        <div
          v-if="showDialog"
          class="bg-black p-5 overflow-y-auto bg-opacity-20 modal-ui__content-container z-50 flex justify-center items-end md:items-center"
        >
          <div
            class="modal-ui__content shadow-lg w-full max-w-sm bg-[#F8F8F7] dark:bg-[#353333] transform rounded-lg transition-transform ui-card overflow-hidden p-4 modal-ui__content shadow-lg w-full max-w-sm"
          >
            <h3 class="font-semibold text-lg">
              {{ translations.index.syncreminder || '-' }}
            </h3>
            <p class="mb-4">
              {{ translations.index.syncmessage || '-' }}
            </p>
            <label class="flex items-center space-x-2">
              <input
                v-model="disableDialog"
                type="checkbox"
                class="form-checkbox rtl:ml-2"
              />
              <span class="inline-block align-middle">
                {{ translations.index.hide || '-' }}</span
              >
            </label>
            <button
              class="mt-4 ui-button h-10 relative transition focus:ring-2 ring-amber-300 bg-primary text-white dark:bg-secondary dark:hover:bg-primary hover:bg-secondary py-2 px-4 w-full rounded-lg"
              @click="closeDialog"
            >
              {{ translations.index.close || '-' }}
            </button>
          </div>
        </div>
      </template>
    </div>
    <div v-else class="text-center">
      <img
        :src="theme.currentTheme.value === 'dark' ? BeaverDark : Beaver"
        class="mx-auto w-2/4"
      />

      <p
        class="max-w-md mx-auto dark:text-[color:var(--selected-dark-text)] text-gray-600 mt-2"
      >
        {{ translations.index.newnote || '-' }}
      </p>
    </div>
  </div>
</template>
<script>
import {
  computed,
  reactive,
  watch,
  ref,
  shallowRef,
  onMounted,
  onUnmounted,
  shallowReactive,
} from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useTheme } from '@/composable/theme';
import { useNoteStore } from '@/store/note';
import { useLabelStore } from '@/store/label';
import { useDialog } from '@/composable/dialog';
import { sortArray, extractNoteText } from '@/utils/helper';
import HomeNoteCard from '@/components/home/HomeNoteCard.vue';
import HomeNoteFilter from '@/components/home/HomeNoteFilter.vue';
import KeyboardNavigation from '@/utils/keyboard-navigation';
import Beaver from '@/assets/images/Beaver.png';
import BeaverDark from '@/assets/images/Beaver-dark.png';

let hasReminded = true;

export default {
  components: { HomeNoteCard, HomeNoteFilter },
  setup() {
    const showDialog = ref(checkAppReminder());
    const disableDialog = ref(false);
    const theme = useTheme();

    function checkAppReminder() {
      const disableReminder = localStorage.getItem('disableAppReminder');
      return !(disableReminder === 'true') && hasReminded;
    }

    const showAppReminderDialog = () => {
      if (!disableDialog.value) {
        showDialog.value = true;
      }
    };

    const closeDialog = () => {
      showDialog.value = false;
      hasReminded = false;
      if (disableDialog.value) {
        localStorage.setItem('disableAppReminder', 'true');
      }
    };
    const route = useRoute();
    const router = useRouter();
    const noteStore = useNoteStore();
    const labelStore = useLabelStore();
    const dialog = useDialog();

    const keyboardNavigation = shallowRef(null);
    const state = reactive({
      notes: [],
      query: '',
      activeLabel: '',
      sortBy: 'createdAt',
      sortOrder: 'asc',
    });

    const sortedNotes = computed(() =>
      sortArray({
        data: state.notes,
        order: state.sortOrder,
        key: state.sortBy,
      })
    );
    const notes = computed(() => filterNotes(sortedNotes.value));

    function filterNotes(notes) {
      const filteredNotes = {
        all: [],
        archived: [],
        bookmarked: [],
      };

      notes.forEach((note) => {
        const { title, content, isArchived, isBookmarked, labels } = note;
        const labelFilter = state.activeLabel
          ? labels.includes(state.activeLabel)
          : true;

        const isMatch = state.query.startsWith('#')
          ? labels.some((label) =>
              label.toLocaleLowerCase().includes(state.query.substr(1))
            )
          : title.toLocaleLowerCase().includes(state.query) ||
            content.includes(state.query);

        if (isMatch && labelFilter) {
          if (isArchived) return filteredNotes.archived.push(note);

          isBookmarked
            ? filteredNotes.bookmarked.push(note)
            : filteredNotes.all.push(note);
        }
      });

      return filteredNotes;
    }

    function extractNoteContent(note) {
      const text = extractNoteText(note.content.content).toLocaleLowerCase();

      return { ...note, content: text };
    }
    function deleteLabel(id) {
      labelStore.delete(id).then(() => {
        state.activeLabel = '';
      });
    }

    watch(
      () => noteStore.data,
      () => {
        state.notes = noteStore.notes.map(extractNoteContent);
      },
      { immediate: true, deep: true }
    );
    watch(
      () => route.query.label,
      (label) => {
        if (label) {
          state.activeLabel = decodeURIComponent(label);
        }
      },
      { immediate: true }
    );
    watch(
      () => [state.sortBy, state.sortOrder],
      ([sortBy, sortOrder]) => {
        localStorage.setItem(
          'sort-notes',
          JSON.stringify({ sortBy, sortOrder })
        );
      }
    );
    watch(notes, () => {
      setTimeout(() => {
        keyboardNavigation.value.refresh();
      }, 250);
    });

    onMounted(() => {
      const sortState = JSON.parse(localStorage.getItem('sort-notes'));

      if (sortState) {
        Object.assign(state, sortState);
      }

      keyboardNavigation.value = new KeyboardNavigation({
        itemSelector: '.note-card',
        activeClass: 'ring-2 active-note',
        breakpoints: {
          default: 1,
          '(min-width: 768px)': 2,
          '(min-width: 1024px)': 3,
          '(min-width: 1280px)': 4,
        },
      });

      keyboardNavigation.value.on(
        'keydown',
        ({ event: { key }, activeItem }) => {
          const noteId = activeItem?.getAttribute('note-id');

          if (!activeItem || !noteId) return;

          if (key === 'Enter') {
            router.push(`/note/${noteId}`);
          } else if (key === 'Backspace' || key === 'Delete') {
            dialog.confirm({
              title: translations.card.confirmPrompt,
              okText: translations.card.confirm,
              cancelText: translations.card.Cancel,
              onConfirm: async () => {
                await noteStore.delete(noteId);
              },
            });
          }
        }
      );
    });
    onUnmounted(() => {
      keyboardNavigation.value.destroy();
    });

    //Translations

    const translations = shallowReactive({
      sidebar: {
        Notes: 'sidebar.Notes',
      },
      index: {
        newnote: 'index.newnote',
        all: 'index.all',
        syncreminder: 'index.syncreminder',
        syncmessage: 'index.syncmessage',
        hide: 'index.hide',
        close: 'index.close',
      },
    });

    onMounted(async () => {
      // Load translations
      const loadedTranslations = await loadTranslations();
      if (loadedTranslations) {
        Object.assign(translations, loadedTranslations);
      }
    });

    const loadTranslations = async () => {
      const selectedLanguage = localStorage.getItem('selectedLanguage') || 'en';
      try {
        const translationModule = await import(
          `../pages/settings/locales/${selectedLanguage}.json`
        );
        return translationModule.default;
      } catch (error) {
        console.error('Error loading translations:', error);
        return null;
      }
    };

    return {
      notes,
      state,
      noteStore,
      labelStore,
      translations,
      deleteLabel,
      showDialog,
      disableDialog,
      showAppReminderDialog,
      closeDialog,
      Beaver,
      BeaverDark,
      theme,
    };
  },
};
</script>
<style>
input[type='checkbox'] {
  appearance: none;
  -webkit-appearance: none;
  width: 20px;
  height: 20px;
  border-radius: 50%;
  border: 2px solid #ccc;
  outline: none;
  cursor: pointer;
  transition: border-color 0.3s;
  vertical-align: middle;
}

input[type='checkbox']:checked {
  border-color: #fbbf24;
}

/* Optional: You can add a custom background or other styles for the checked state */
input[type='checkbox']:checked::before {
  content: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' width='16' height='16'%3E%3Cpath d='M10.0007 15.1709L19.1931 5.97852L20.6073 7.39273L10.0007 17.9993L3.63672 11.6354L5.05093 10.2212L10.0007 15.1709Z' fill='rgba(251,191,36,1)'%3E%3C/path%3E%3C/svg%3E");
  display: block;
  width: 100%;
  height: 100%;
  font-size: 16px;
  line-height: 20px;
  text-align: center;
  color: #fbbf24;
}
</style>
<style lang="scss">
@use 'sass:math';
.tiptap {
  > * + * {
    margin-top: 0.75em;
  }
}

.iframe-wrapper {
  position: relative;
  padding-bottom: math.div(100, 16) * 9%;
  height: 0;
  overflow: hidden;
  width: 100%;
  height: auto;

  &.ProseMirror-selectednode {
    outline: 3px solid #fbbf24;
  }

  iframe {
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
  }
}
</style>
