<template>
  <div
    class="pl-16 fixed inset-x-0 z-40 transition-all duration-300 ease-out mx-2 bottom-4"
  >
    <div
      class="relative bg-white dark:bg-neutral-800 border rounded-xl shadow-lg overflow-hidden w-full sm:w-fit sm:mx-auto"
    >
      <div className="flex items-center p-2 space-x-2">
        <!-- Regex Toggle Button -->
        <ui-button
          v-tooltip="translations.search.useRegex"
          icon
          @click="toggleRegex"
        >
          <v-remixicon
            name="mdiRegex"
            :class="{ 'text-primary': state.useRegex }"
          />
        </ui-button>

        <!-- Search Term Input -->
        <div class="relative flex-1">
          <ui-input
            v-model="state.query"
            autofocus
            prepend-icon="riSearchLine"
            :placeholder="translations.search.searchPlaceholder"
            class="w-full editor-search"
            @keyup="startSearch"
          />
          <div
            class="absolute right-2 rtl:left-2 top-1/2 transform -translate-y-1/2 text-sm opacity-40 font-medium"
          >
            {{ props.editor?.storage?.searchAndReplace?.resultIndex + 1 || 0 }}
            /
            {{ props.editor?.storage?.searchAndReplace?.results?.length || 0 }}
          </div>
        </div>

        <!-- Replace Term Input -->
        <ui-input
          v-model="state.replaceWith"
          :placeholder="translations.search.replacePlaceholder"
          class="flex-1"
          @keyup="startSearch"
        />

        <!-- Clear Search Button -->
        <ui-button
          v-tooltip="translations.search.clear"
          icon
          @click="clearSearch"
        >
          <v-remixicon name="riDeleteBackLine" />
        </ui-button>

        <!-- Replace Button -->
        <ui-button
          v-tooltip="'Alt+Enter'"
          :disabled="!state.replaceWith"
          @click="replaceText"
        >
          {{ translations.search.replace || 'Replace' }}
        </ui-button>

        <!-- Replace All Button -->
        <ui-button
          v-tooltip="'Ctrl+Alt+Enter'"
          :disabled="!state.replaceWith"
          @click="replaceAllText"
        >
          {{ translations.search.replaceAll || 'Replace All' }}
        </ui-button>

        <!-- Case Sensitivity Toggle -->
        <ui-button
          :class="{ 'text-primary': state.caseSensitive }"
          @click="toggleCaseSensitive"
        >
          <v-remixicon name="riFontSize" />
        </ui-button>

        <!-- Find Previous Button -->
        <ui-button :disabled="!state.query" @click="findPreviousResult">
          <v-remixicon
            name="riArrowUpLine"
            class="dark:text-neutral-200 text-neutral-600 cursor-pointer"
          />
        </ui-button>

        <!-- Find Next Button -->
        <ui-button :disabled="!state.query" @click="findNextResult">
          <v-remixicon
            name="riArrowDownLine"
            class="dark:text-neutral-200 text-neutral-600 cursor-pointer"
          />
        </ui-button>
      </div>
    </div>
  </div>
</template>

<script>
import { shallowReactive, onMounted, onUnmounted, ref } from 'vue';
import { useTranslation } from '@/composable/translations';
import Mousetrap from '@/lib/mousetrap';

export default {
  props: {
    context: {
      type: String,
      default: 'note',
    },
    editor: {
      type: Object,
      default: null,
    },
  },
  setup(props) {
    const state = shallowReactive({
      query: '',
      replaceWith: '',
      useRegex: false,
      caseSensitive: false,
    });

    function toggleRegex() {
      if (!props.editor) return;
      state.useRegex = !state.useRegex;
      props.editor.commands.setSearchTerm(state.query);
      props.editor.commands.setCaseSensitive(state.caseSensitive);
    }

    function clearSearch() {
      if (!props.editor) return;
      state.query = '';
      state.replaceWith = '';
      props.editor.commands.setSearchTerm('');
      props.editor.commands.setReplaceTerm('');
      props.editor.commands.resetIndex();
    }

    function startSearch() {
      if (!props.editor) return;
      props.editor.commands.setSearchTerm(state.query);
      props.editor.commands.setReplaceTerm(state.replaceWith);
      props.editor.commands.setCaseSensitive(state.caseSensitive);
      goToSelection();
    }

    function findNextResult() {
      if (!props.editor) return;
      props.editor.commands.nextSearchResult();
      goToSelection();
    }

    function findPreviousResult() {
      if (!props.editor) return;
      props.editor.commands.previousSearchResult();
      goToSelection();
    }

    function goToSelection() {
      if (!props.editor) return;
      const { results, resultIndex } =
        props.editor.storage?.searchAndReplace || {};
      const position = results?.[resultIndex];

      if (!position) return;

      props.editor.commands.setTextSelection(position);

      const { node } = props.editor.view.domAtPos(
        props.editor.state.selection.anchor
      );
      if (node instanceof HTMLElement) {
        node.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }

    function replaceText() {
      if (!props.editor || !state.replaceWith) return;
      props.editor.commands.replace();
    }

    function replaceAllText() {
      if (!props.editor || !state.replaceWith) return;
      props.editor.commands.replaceAll();
    }

    function toggleCaseSensitive() {
      if (!props.editor) return;
      state.caseSensitive = !state.caseSensitive;
      props.editor.commands.setCaseSensitive(state.caseSensitive);
    }

    const shortcuts = {
      'alt+r': toggleRegex,
      'alt+enter': replaceText,
      'mod+alt+enter': replaceAllText,
      enter: findNextResult,
    };

    Mousetrap.bind(Object.keys(shortcuts), (event, combo) => {
      shortcuts[combo]();
    });

    onMounted(() => {
      if (!props.editor) return;
      const { state: editorState } = props.editor;
      const { from, to } = editorState.selection;
      const text = editorState.doc.textBetween(from, to, ' ');

      if (text) state.query = text;
    });

    const translations = ref({
      search: {},
    });

    onMounted(async () => {
      await useTranslation().then((trans) => {
        if (trans) {
          translations.value = trans;
        }
      });
    });

    onUnmounted(() => {
      if (!props.editor) return;
      state.query = '';
      state.replaceWith = '';
      props.editor.commands.setSearchTerm('');
      props.editor.commands.setReplaceTerm('');
      props.editor.commands.resetIndex();
      Mousetrap.unbind(Object.keys(shortcuts));
    });

    return {
      props,
      state,
      translations,
      startSearch,
      replaceText,
      replaceAllText,
      findNextResult,
      findPreviousResult,
      toggleRegex,
      clearSearch,
      toggleCaseSensitive,
    };
  },
};
</script>
