<template>
  <div
    class="fixed inset-x-0 z-40 flex justify-center px-2 transition-all duration-300 ease-[var(--ease-standard)] bottom-4"
    :style="wrapperStyle"
  >
    <div
      class="relative bg-white dark:bg-neutral-900 border rounded-2xl shadow-lg overflow-hidden w-full sm:w-fit sm:mx-auto"
    >
      <!-- Desktop Layout -->
      <div
        class="flex items-center p-2 space-x-2 max-md:flex-wrap max-md:hidden"
      >
        <ui-button
          v-keep-focus
          v-tooltip="translations.search.useRegex"
          icon
          @click="toggleRegex"
        >
          <v-remixicon
            name="mdiRegex"
            :class="{ 'text-primary': state.useRegex }"
          />
        </ui-button>

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

        <ui-input
          v-model="state.replaceWith"
          :placeholder="translations.search.replacePlaceholder"
          class="flex-1"
          @keyup="startSearch"
        />

        <ui-button
          v-keep-focus
          v-tooltip="translations.search.clear"
          icon
          @click="clearSearch"
        >
          <v-remixicon name="riDeleteBackLine" />
        </ui-button>

        <ui-button
          v-keep-focus
          v-tooltip="translations.searchReplace?.altEnter || 'Alt+Enter'"
          :disabled="!state.replaceWith"
          @click="replaceText"
        >
          {{ translations.search.replace || 'Replace' }}
        </ui-button>

        <ui-button
          v-keep-focus
          v-tooltip="
            translations.searchReplace?.ctrlAltEnter || 'Ctrl+Alt+Enter'
          "
          :disabled="!state.replaceWith"
          @click="replaceAllText"
        >
          {{ translations.search.replaceAll || 'Replace All' }}
        </ui-button>

        <ui-button
          v-keep-focus
          :class="{ 'text-primary': state.caseSensitive }"
          @click="toggleCaseSensitive"
        >
          <v-remixicon name="riFontSize" />
        </ui-button>

        <ui-button
          v-keep-focus
          :disabled="!state.query"
          @click="findPreviousResult"
        >
          <v-remixicon
            name="riArrowUpLine"
            class="dark:text-neutral-200 text-neutral-600"
          />
        </ui-button>

        <ui-button v-keep-focus :disabled="!state.query" @click="findNextResult">
          <v-remixicon
            name="riArrowDownLine"
            class="dark:text-neutral-200 text-neutral-600"
          />
        </ui-button>

        <ui-button v-keep-focus @click="$emit('close')">
          <v-remixicon
            name="riCloseLine"
            class="dark:text-neutral-200 text-neutral-600"
          />
        </ui-button>
      </div>

      <!-- Mobile Layout -->
      <div class="hidden max-md:block">
        <!-- Search Row -->
        <div class="flex items-center p-2 space-x-2">
          <div class="relative flex-1">
            <ui-input
              v-model="state.query"
              ref="mobileSearchInput"
              prepend-icon="riSearchLine"
              :placeholder="translations.search.searchPlaceholder"
              class="w-full editor-search"
              @keyup="startSearch"
            />
            <div
              class="absolute right-2 rtl:left-2 top-1/2 transform -translate-y-1/2 text-sm opacity-40 font-medium"
            >
              {{
                props.editor?.storage?.searchAndReplace?.resultIndex + 1 || 0
              }}
              /
              {{
                props.editor?.storage?.searchAndReplace?.results?.length || 0
              }}
            </div>
          </div>

          <div class="flex items-center space-x-1">
            <ui-button
              v-keep-focus
              :disabled="
                !state.query ||
                (props.editor?.storage?.searchAndReplace?.results?.length ||
                  0) === 0
              "
              icon
              class="p-2"
              @click="findPreviousResult"
            >
              <v-remixicon
                name="riArrowUpLine"
                class="w-4 h-4 text-neutral-600 dark:text-neutral-400"
              />
            </ui-button>

            <ui-button
              v-keep-focus
              :disabled="
                !state.query ||
                (props.editor?.storage?.searchAndReplace?.results?.length ||
                  0) === 0
              "
              icon
              class="p-2"
              @click="findNextResult"
            >
              <v-remixicon
                name="riArrowDownLine"
                class="w-4 h-4 text-neutral-600 dark:text-neutral-400"
              />
            </ui-button>
          </div>

          <ui-button
            v-keep-focus
            icon
            class="p-2"
            @click="state.showReplace = !state.showReplace"
          >
            <v-remixicon
              :name="state.showReplace ? 'riArrowUpSLine' : 'riArrowDownSLine'"
              class="w-4 h-4 text-neutral-600 dark:text-neutral-400"
            />
          </ui-button>

          <ui-button v-keep-focus icon class="p-2" @click="$emit('close')">
            <v-remixicon
              name="riCloseLine"
              class="w-4 h-4 text-neutral-600 dark:text-neutral-400"
            />
          </ui-button>
        </div>

        <!-- Replace Row (Collapsible) -->
        <div
          :class="[
            'transition-[max-height,opacity] duration-200 ease-in-out overflow-hidden',
            state.showReplace ? 'max-h-20 opacity-100' : 'max-h-0 opacity-0',
          ]"
        >
          <div class="border-t border-neutral-200 dark:border-neutral-700 p-2">
            <div class="flex items-center space-x-2">
              <ui-input
                v-model="state.replaceWith"
                :placeholder="translations.search.replacePlaceholder"
                class="flex-1"
                @keyup="startSearch"
              />

              <div class="flex items-center space-x-1">
                <ui-button
                  v-keep-focus
                  :disabled="!state.replaceWith || !state.query"
                  class="px-3 py-2 text-xs"
                  @click="replaceText"
                >
                  {{ translations.search.replace || 'Replace' }}
                </ui-button>

                <ui-button
                  v-keep-focus
                  :disabled="!state.replaceWith || !state.query"
                  class="px-3 py-2 text-xs"
                  @click="replaceAllText"
                >
                  {{ translations.search.replaceAll || 'All' }}
                </ui-button>

                <ui-button
                  v-keep-focus
                  :class="[
                    'p-2 transition-colors',
                    state.caseSensitive
                      ? 'bg-secondary bg-opacity-20 text-primary'
                      : 'text-neutral-600 dark:text-neutral-400',
                  ]"
                  icon
                  @click="toggleCaseSensitive"
                >
                  <v-remixicon name="riFontSize" class="w-4 h-4" />
                </ui-button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script>
import { shallowReactive, onMounted, onUnmounted, ref, nextTick, computed } from 'vue';
import { useTranslations } from '@/composable/useTranslations';
import { useUiState } from '@/composable/useUiState';
import { useSidebar } from '@/composable/useSidebar';
import { backend } from '@/lib/tauri-bridge';
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
  emits: ['close'],
  setup(props) {
    const { translations } = useTranslations();
    const uiState = useUiState();
    const { expanded: sidebarExpanded } = useSidebar();
    const mobileSearchInput = ref(null);

    const wrapperStyle = computed(() => {
      if (backend.isMobileRuntime()) {
        return { bottom: 'var(--app-keyboard-inset-bottom, 1rem)' };
      }
      if (uiState.inReaderMode) return {};
      return { paddingLeft: sidebarExpanded.value ? '16rem' : '4rem' };
    });

    const state = shallowReactive({
      query: '',
      replaceWith: '',
      useRegex: false,
      caseSensitive: false,
      showReplace: false, // Added for mobile toggle
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
        props.editor.state.selection.anchor,
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

    const shortcutKeys = Object.keys(shortcuts);
    Mousetrap.bind(shortcutKeys, (event, combo) => {
      event.preventDefault();
      shortcuts[combo]();
    });

    onMounted(() => {
      if (!props.editor) return;
      const { state: editorState } = props.editor;
      const { from, to } = editorState.selection;
      const text = editorState.doc.textBetween(from, to, ' ');

      if (text) state.query = text;

      nextTick(() => {
        const el =
          mobileSearchInput.value?.$el?.querySelector?.('input') ??
          mobileSearchInput.value?.$el;
        if (el) {
          el.focus({ preventScroll: window.innerWidth < 768 });
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
      Mousetrap.unbind(shortcutKeys);
    });

    return {
      props,
      state,
      translations,
      wrapperStyle,
      mobileSearchInput,
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
