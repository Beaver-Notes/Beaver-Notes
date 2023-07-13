<template>
  <div
    class="
      fixed
      bottom-0
      pl-20
      bg-white
      dark:bg-gray-800
      flex
      items-center
      left-0
      w-full
      py-2
      pr-8
      z-30
    "
  >
    <ui-button
      v-tooltip="'Use regex (Alt+R)'"
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
      v-tooltip="'Clear'"
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
      placeholder="Search..."
      class="flex-1 mr-2 editor-search"
      @keyup.enter="search"
    />
    <ui-input
      v-model="state.replaceWith"
      placeholder="Replace..."
      class="flex-1 mr-4"
      @keyup.enter="search"
    />
    <ui-button class="mr-2" @click="search"> Find </ui-button>
    <ui-button
      v-tooltip="'Alt+Enter'"
      :disabled="!state.replaceWith"
      class="mr-2"
      @click="replaceText"
    >
      Replace
    </ui-button>
    <ui-button
      v-tooltip="'Ctrl+Alt+Enter'"
      :disabled="!state.replaceWith"
      @click="replaceAllText"
    >
      Replace all
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
    onUnmounted(() => {
      props.editor.commands.clearSearch();
      Mousetrap.unbind(Object.keys(shortcuts));
    });

    return {
      state,
      search,
      replaceText,
      replaceAllText,
    };
  },
};
</script>
