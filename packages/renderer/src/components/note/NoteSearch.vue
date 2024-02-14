<template>
  <div
    class="fixed bottom-0 pl-20 bg-white dark:bg-gray-800 flex items-center left-0 w-full py-2 pr-8 z-30"
  >
    <ui-button
      v-tooltip="translations.search.useRegex"
      class="mr-2"
      icon
      @click="state.useRegex = !state.useRegex"
    >
      <v-remixicon
        name="mdiRegex"
        :class="{ 'text-primary': state.useRegex }"
      />
    </ui-button>
    <ui-button
      v-tooltip="translations.search.clear"
      class="mr-2"
      icon
      @click="editor.commands.clearSearch()"
    >
      <v-remixicon name="riDeleteBackLine" />
    </ui-button>
    <ui-input
      v-model="state.query"
      autofocus
      prepend-icon="riSearchLine"
      :placeholder="translations.search.searchplaceholder"
      class="flex-1 mr-2 editor-search"
      @keyup.enter="search"
    />
    <ui-input
      v-model="state.replaceWith"
      :placeholder="translations.search.replaceplaceholder"
      class="flex-1 mr-4"
      @keyup.enter="search"
    />
    <ui-button class="mr-2" @click="search">
      {{ translations.search.find || '-' }}
    </ui-button>
    <ui-button
      v-tooltip="'Alt+Enter'"
      :disabled="!state.replaceWith"
      class="mr-2"
      @click="replaceText"
    >
      {{ translations.search.replace || '-' }}
    </ui-button>
    <ui-button
      v-tooltip="'Ctrl+Alt+Enter'"
      :disabled="!state.replaceWith"
      @click="replaceAllText"
    >
      {{ translations.search.replaceall || '-' }}
    </ui-button>
  </div>
</template>
<script>
import { shallowReactive, onMounted, onUnmounted } from 'vue';
import Mousetrap from '@/lib/mousetrap';

export default {
  props: {
    editor: {
      type: Object,
      default: () => ({}),
    },
  },
  setup(props) {
    const state = shallowReactive({
      query: '',
      useRegex: false,
      replaceWith: '',
    });

    function search() {
      props.editor.commands.find(state.query, state.useRegex);

      setTimeout(() => {
        props.editor.commands.scrollIntoView();
      }, 200);
    }
    function replaceText() {
      if (state.replaceWith === '') return;

      props.editor.commands.replace(state.replaceWith);
    }
    function replaceAllText() {
      if (state.replaceWith === '') return;

      props.editor.commands.replaceAll(state.replaceWith);
    }

    const shortcuts = {
      'alt+r': () => (state.useRegex = !state.useRegex),
      'alt+enter': replaceText,
      'mod+alt+enter': replaceAllText,
    };
    Mousetrap.bind(Object.keys(shortcuts), (event, combo) => {
      shortcuts[combo]();
    });

    onMounted(() => {
      const { state: editorState } = props.editor;
      const { from, to } = editorState.selection;
      const text = editorState.doc.textBetween(from, to, ' ');

      if (text) state.query = text;
    });

    const translations = shallowReactive({
      search: {
        find: 'search.find',
        replace: 'search.replace',
        replaceall: 'search.replaceall',
        searchplaceholder: 'search.searchplaceholder',
        replaceplaceholder: 'search.replaceplaceholder',
        useRegex: 'search.useRegex',
        clear: 'search.clear',
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
          `../../pages/settings/locales/${selectedLanguage}.json`
        );
        return translationModule.default;
      } catch (error) {
        console.error('Error loading translations:', error);
        return null;
      }
    };

    onUnmounted(() => {
      props.editor.commands.clearSearch();
      Mousetrap.unbind(Object.keys(shortcuts));
    });

    return {
      state,
      search,
      replaceText,
      translations,
      replaceAllText,
    };
  },
};
</script>
