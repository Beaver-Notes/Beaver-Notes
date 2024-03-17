<template>
  <expand-transition>
    <ui-list
      v-if="currentLinkVal.startsWith('@')"
      class="p-2 space-y-1 border-b"
    >
      <ui-list-item
        v-for="(note, index) in notes"
        :key="note.id"
        :active="index === selectedNoteIndex"
        class="cursor-pointer line-clamp leading-tight"
        @click="updateCurrentLink(note.id)"
      >
        <p class="text-overflow w-full">
          {{ note.title || translations.link.untitlednote }}
        </p>
      </ui-list-item>
    </ui-list>
  </expand-transition>
  <div class="p-2">
    <div class="flex items-center space-x-2">
      <input
        id="bubble-input"
        v-model="currentLinkVal"
        type="url"
        :placeholder="translations.link.placeholder"
        class="flex-1 bg-transparent"
        @keydown.enter="handleEnter"
        @keydown.esc="handleEsc"
      />
      <button
        icon
        class="text-gray-600 dark:text-gray-200"
        title="Remove link"
        @click="editor.chain().focus().unsetLink().run()"
      >
        <v-remixicon name="riLinkUnlinkM" />
      </button>
      <button
        icon
        class="text-gray-600 -mr-1 dark:text-gray-200"
        @click="updateCurrentLink"
      >
        <v-remixicon name="riSave3Line" />
      </button>
    </div>
    <span class="text-xs text-gray-600 dark:text-gray-300 leading-none">{{
      translations.link.shortcut || '-'
    }}</span>
  </div>
</template>

<script>
import {
  ref,
  computed,
  watch,
  shallowReactive,
  onMounted,
  onUnmounted,
} from 'vue';
import { useRoute } from 'vue-router';
import { useNoteStore } from '@/store/note';

export default {
  props: {
    editor: {
      type: Object,
      default: () => ({}),
    },
  },
  emits: ['close-menu'],
  setup(props, { emit }) {
    const route = useRoute();
    const noteStore = useNoteStore();
    const isMounted = ref(false); // Track component mount state

    const selectedNoteIndex = ref(0);
    const currentLinkVal = ref('');

    const notes = computed(() => {
      if (!currentLinkVal.value.startsWith('@')) return [];

      const query = currentLinkVal.value.substr(1).toLocaleLowerCase();

      return noteStore.notes
        .filter(
          (note) =>
            note.id !== route.params.id &&
            (note.title.toLocaleLowerCase().includes(query) ||
              note.id.toLocaleLowerCase().includes(query))
        )
        .slice(0, 6);
    });

    const updateCurrentLink = (id) => {
      let value = currentLinkVal.value;

      if (currentLinkVal.value.startsWith('@') || typeof id === 'string') {
        const noteId =
          typeof id === 'string' ? id : notes.value[selectedNoteIndex.value].id;

        value = `note://${noteId}`;
      }

      props.editor
        .chain()
        .focus()
        .extendMarkRange('link')
        .setLink({ href: value })
        .run();
    };

    const handleCloseMenu = () => {
      console.log('Menu closed');
      if (isMounted.value) {
        emit('close-menu'); // Emit the close-menu event if component is mounted
      }
    };

    function handleEnter(event) {
      // Close and save changes on Enter key press
      if (event.key === 'Enter') {
        updateCurrentLink();
        handleCloseMenu();
      }
    }

    function handleEsc(event) {
      // Close and discard changes on Esc key press
      if (event.key === 'Escape') {
        currentLinkVal.value = '';
        handleCloseMenu();
      }
    }

    watch(currentLinkVal, (value) => {
      if (value.startsWith('@')) selectedNoteIndex.value = 0;
    });

    watch(
      () => props.editor.getAttributes('link'),
      (value) => {
        currentLinkVal.value = (value?.href ?? '').replace('note://', '@');
      },
      { immediate: true }
    );

    const translations = shallowReactive({
      link: {
        untitlednote: 'link.untitlednote',
        placeholder: 'link.placeholder',
        shortcut: 'link.shortcut',
      },
    });

    onMounted(async () => {
      isMounted.value = true; // Set component mount state to true
      // Load translations
      const loadedTranslations = await loadTranslations();
      if (loadedTranslations) {
        Object.assign(translations, loadedTranslations);
      }
    });

    onUnmounted(() => {
      isMounted.value = false; // Set component mount state to false when unmounted
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

    return {
      notes,
      translations,
      selectedNoteIndex,
      currentLinkVal,
      handleEnter,
      handleEsc,
      handleCloseMenu,
      updateCurrentLink,
    };
  },
};
</script>
