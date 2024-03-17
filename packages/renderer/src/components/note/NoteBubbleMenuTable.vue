<template>
  <bubble-menu
    v-if="menuOpen && !isTyping"
    v-bind="{ editor, shouldShow: () => true }"
    class="bg-white dark:bg-gray-800 p-1.5 rounded-lg max-w-xs border shadow-xl"
  >
    <button
      v-tooltip.group="translations.menu.addRowAbove"
      class="transition hoverable h-8 px-1 rounded-lg"
      @click="editor.chain().focus().addRowBefore().run()"
    >
      <v-remixicon name="riInsertRowTop" />
    </button>
    <button
      v-tooltip.group="translations.menu.addRowBelow"
      class="transition hoverable h-8 px-1 rounded-lg"
      @click="editor.chain().focus().addRowAfter().run()"
    >
      <v-remixicon name="riInsertRowBottom" />
    </button>
    <button
      v-tooltip.group="translations.menu.deleteRow"
      class="transition hoverable h-8 px-1 rounded-lg"
      @click="editor.chain().focus().deleteRow().run()"
    >
      <v-remixicon name="riDeleteRow" />
    </button>
    <button
      v-tooltip.group="translations.menu.addColumnLeft"
      class="transition hoverable h-8 px-1 rounded-lg"
      @click="editor.chain().focus().addColumnBefore().run()"
    >
      <v-remixicon name="riInsertColumnLeft" />
    </button>
    <button
      v-tooltip.group="translations.menu.addColumnRight"
      class="transition hoverable h-8 px-1 rounded-lg"
      @click="editor.chain().focus().addColumnAfter().run()"
    >
      <v-remixicon name="riInsertColumnRight" />
    </button>
    <button
      v-tooltip.group="translations.menu.deleteColumn"
      class="transition hoverable h-8 px-1 rounded-lg"
      @click="editor.chain().focus().deleteColumn().run()"
    >
      <v-remixicon name="riDeleteColumn" />
    </button>
    <button
      v-tooltip.group="translations.menu.toggleHeader"
      class="transition hoverable h-8 px-1 rounded-lg"
      @click="editor.chain().focus().toggleHeaderCell().run()"
    >
      <v-remixicon name="riBrush2Fill" />
    </button>
    <button
      v-tooltip.group="translations.menu.deleteTable"
      class="transition hoverable h-8 px-1 rounded-lg"
      @click="editor.chain().focus().deleteTable().run()"
    >
      <v-remixicon name="riDeleteBin6Line" />
    </button>
  </bubble-menu>
</template>

<script>
import { ref, onMounted, watch, shallowReactive } from 'vue';
import { BubbleMenu } from '@tiptap/vue-3';

export default {
  components: { BubbleMenu },
  props: {
    editor: {
      type: Object,
      default: () => ({}),
    },
    isTyping: {
      type: Boolean,
      default: false,
    },
  },
  setup(props) {
    const menuOpen = ref(false);

    watch(
      () => [
        props.editor.isActive('tableCell'),
        props.editor.isActive('tableHeader'),
      ],
      ([isTableCellActive, isTableHeaderActive]) => {
        menuOpen.value = isTableCellActive || isTableHeaderActive;
      }
    );

    // Watch for changes in isTyping prop
    watch(
      () => props.isTyping,
      (newValue) => {
        // If user is typing, close the menu
        if (newValue) {
          menuOpen.value = false;
        }
      }
    );

    const translations = shallowReactive({
      menu: {
        paragraph: 'menu.paragraph',
        heading: 'menu.heading',
        image: 'menu.image',
        imgurl: 'menu.imgurl',
        Link: 'menu.Link',
        File: 'menu.File',
        Print: 'menu.Print',
        Focusmode: 'menu.Focusmode',
        headingsTree: 'menu.headingsTree',
        orderedlist: 'menu.orderedlist',
        bulletlist: 'menu.bulletlist',
        checklist: 'menu.checklist',
        blockquote: 'menu.blockquote',
        codeblock: 'menu.codeblock',
        bold: 'menu.bold',
        italic: 'menu.italic',
        underline: 'menu.underline',
        strikethrough: 'menu.strikethrough',
        inlinecode: 'menu.inlinecode',
        highlight: 'menu.highlight',
        delete: 'menu.delete',
        tableOptions: 'menu.tableOptions',
        tableInsert: 'menu.tableInsert',
        addRowAbove: 'menu.addRowAbove',
        addRowBelow: 'menu.addRowBelow',
        addColumnLeft: 'menu.addColumnLeft',
        addColumnRight: 'menu.addColumnRight',
        deleteRow: 'menu.deleteRow',
        deleteColumn: 'menu.deleteColumn',
        toggleHeader: 'menu.toggleHeader',
        deleteTable: 'menu.deleteTable',
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

    const handleCloseMenu = () => {
      menuOpen.value = false;
    };

    return {
      menuOpen,
      translations,
      handleCloseMenu,
    };
  },
};
</script>

