<template>
  <div
    class="text-gray-600 dark:text-gray-300 bg-[#FFFFFF] dark:bg-[#232222] dark:text-gray-50 overflow-x-auto scroll border-b z-20 top-0 w-full left-0 py-1 sticky top-0 no-print"
    :class="{ 'opacity-0 hover:opacity-100 transition': store.inFocusMode }"
  >
    <div class="w-full h-full flex items-center justify-between w-full">
      <!-- <input
        type="number"
        class="
          hoverable
          appearance-none
          h-full
          bg-transparent
          h-8 px-1 rounded-lg
          w-20
          text-center
        "
        value="16"
        min="1"
        title="Font size"
      /> -->
      <button
        v-tooltip.group="translations.menu.paragraph"
        :class="{ 'is-active': editor.isActive('paragraph') }"
        class="transition hoverable h-8 px-1 rounded-lg"
        @click="editor.chain().focus().setParagraph().run()"
      >
        <v-remixicon name="riParagraph" />
      </button>
      <button
        v-for="heading in [1, 2]"
        :key="heading"
        v-tooltip.group="`${translations.menu.heading} ${heading}`"
        :class="{ 'is-active': editor.isActive('heading', { level: heading }) }"
        class="transition hoverable h-8 px-1 rounded-lg"
        @click="editor.chain().focus().toggleHeading({ level: heading }).run()"
      >
        <v-remixicon :name="`riH${heading}`" />
      </button>
      <hr class="border-r mx-2 h-6" />
      <button
        v-for="action in textFormatting"
        :key="action.name"
        v-tooltip.group="action.title"
        :class="{ 'is-active': editor.isActive(action.activeState) }"
        class="transition hoverable h-8 px-1 rounded-lg"
        @click="action.handler"
      >
        <v-remixicon :name="action.icon" />
      </button>
      <hr class="border-r mx-2 h-6" />
      <button
        v-for="action in lists"
        :key="action.name"
        v-tooltip.group="action.title"
        :class="{ 'is-active': editor.isActive(action.activeState) }"
        class="transition hoverable h-8 px-1 rounded-lg"
        @click="action.handler"
      >
        <v-remixicon :name="action.icon" />
      </button>
      <hr class="border-r mx-2 h-6" />
      <ui-popover padding="p-2 flex items-center">
        <template #trigger>
          <button
            v-tooltip.group="translations.menu.image"
            class="transition hoverable h-8 px-1 rounded-lg"
          >
            <v-remixicon name="riImageLine" />
          </button>
        </template>
        <input
          v-model="imgUrl"
          class="bg-transparent mr-2"
          :placeholder="translations.menu.imgurl || '-'"
          @keyup.enter="insertImage"
        />
        <v-remixicon
          name="riFolderOpenLine"
          class="mr-2 cursor-pointer"
          @click="editorImage.select(true)"
        />
        <v-remixicon
          name="riSave3Line"
          class="mr-2 cursor-pointer"
          @click="insertImage"
        />
      </ui-popover>
      <button
        v-tooltip.group="translations.menu.Link"
        :class="{ 'is-active': editor.isActive('link') }"
        class="transition hoverable h-8 px-1 rounded-lg"
        @click="editor.chain().focus().toggleLink({ href: '' }).run()"
      >
        <v-remixicon name="riLink" />
      </button>
      <button
        v-tooltip.group="translations.menu.tableOptions"
        class="hoverable h-8 px-1 rounded-lg"
        @click="openDropdown"
      >
        <v-remixicon name="riTableLine" />
      </button>

      <!-- Dropdown using ui-popover -->
      <ui-popover
        v-model="isDropdownOpen"
        trigger="manual"
        @close="closeDropdown"
      >
        <template #trigger> </template>

        <button
          v-tooltip.group="translations.menu.tableInsert"
          class="transition hoverable h-8 px-1 rounded-lg"
          @click="
            editor
              .chain()
              .focus()
              .insertTable({ rows: 3, cols: 3, withHeaderRow: true })
              .run()
          "
        >
          <v-remixicon name="riTableLine" />
        </button>
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
      </ui-popover>
      <hr class="border-r mx-2 h-6" />
      <button
        v-tooltip.group="translations.menu.Print"
        class="transition hoverable h-8 px-1 rounded-lg"
        @click="printContent"
      >
        <v-remixicon name="riPrinterLine" />
      </button>
      <hr class="border-r mx-2 h-6" />
      <button
        v-if="showAdavancedSettings"
        v-tooltip.group="translations.menu.delete"
        class="hoverable h-8 px-1 rounded-lg h-full"
        @click="deleteNode"
      >
        <v-remixicon name="riDeleteBin6Line" />
      </button>

      <button
        v-tooltip.group="translations.menu.Focusmode"
        :class="{ 'is-active': store.inFocusMode }"
        class="hoverable h-8 px-1 rounded-lg h-full"
        @click="toggleFocusMode"
      >
        <v-remixicon name="riFocus3Line" />
      </button>
      <button
        v-tooltip.group="translations.menu.headingsTree"
        :class="{ 'is-active': tree }"
        class="hoverable h-8 px-1 rounded-lg h-full"
        @click="showHeadingsTree = !showHeadingsTree"
      >
        <v-remixicon name="riSearchLine" />
      </button>
      <ui-popover
        v-slot="{ isShow }"
        v-model="showHeadingsTree"
        trigger="manual"
        @show="getHeadingsTree"
        @close="editor.commands.focus()"
      >
        <note-menu-headings-tree
          v-if="isShow"
          :editor="editor"
          :headings="headingsTree"
          @close="
            showHeadingsTree = false;
            editor.commands.focus();
          "
        />
      </ui-popover>
    </div>
  </div>
</template>

<script>
import {
  shallowRef,
  onUnmounted,
  onMounted,
  computed,
  shallowReactive,
} from 'vue';
import { useGroupTooltip } from '@/composable/groupTooltip';
import { useStore } from '@/store';
import { useEditorImage } from '@/composable/editorImage';
import Mousetrap from '@/lib/mousetrap';
import NoteMenuHeadingsTree from './NoteMenuHeadingsTree.vue';
import { useNoteStore } from '../../store/note';
import { useRouter } from 'vue-router';
import { useDialog } from '@/composable/dialog';

export default {
  components: { NoteMenuHeadingsTree },
  props: {
    editor: {
      type: Object,
      default: () => ({}),
    },
    tree: {
      type: Boolean,
      default: false,
    },
    id: {
      type: String,
      default: '',
    },
  },
  emits: ['update:tree'],
  setup(props) {
    const headings = [
      { name: 'Paragraphs', id: 'paragraph' },
      { name: 'Header 1', id: 1 },
      { name: 'Header 2', id: 2 },
      { name: 'Header 3', id: 3 },
      { name: 'Header 4', id: 4 },
      { name: 'Header 5', id: 5 },
      { name: 'Header 6', id: 6 },
    ];

    const lists = computed(() => {
      return [
        {
          name: 'ordered-list',
          title: translations.menu.orderedlist,
          icon: 'riListOrdered',
          activeState: 'orderedList',
          handler: () => props.editor.chain().focus().toggleOrderedList().run(),
        },
        {
          name: 'bullet-list',
          title: translations.menu.bulletlist,
          icon: 'riListUnordered',
          activeState: 'bulletList',
          handler: () => props.editor.chain().focus().toggleBulletList().run(),
        },
        {
          name: 'check-list',
          title: translations.menu.checklist,
          icon: 'riListCheck2',
          activeState: 'taskList',
          handler: () => props.editor.chain().focus().toggleTaskList().run(),
        },
        {
          name: 'blockquote',
          title: translations.menu.blockquote,
          icon: 'riDoubleQuotesR',
          activeState: 'blockquote',
          handler: () => props.editor.chain().focus().toggleBlockquote().run(),
        },
        {
          name: 'code-block',
          title: translations.menu.codeblock,
          icon: 'riCodeBoxLine',
          activeState: 'codeBlock',
          handler: () => props.editor.chain().focus().toggleCodeBlock().run(),
        },
      ];
    });
    const textFormatting = computed(() => {
      return [
        {
          name: 'bold',
          title: translations.menu.bold,
          icon: 'riBold',
          activeState: 'bold',
          handler: () => props.editor.chain().focus().toggleBold().run(),
        },
        {
          name: 'italic',
          title: translations.menu.italic,
          icon: 'riItalic',
          activeState: 'italic',
          handler: () => props.editor.chain().focus().toggleItalic().run(),
        },
        {
          name: 'underline',
          title: translations.menu.underline,
          icon: 'riUnderline',
          activeState: 'underline',
          handler: () => props.editor.chain().focus().toggleUnderline().run(),
        },
        {
          name: 'strikethrough',
          title: translations.menu.strikethrough,
          icon: 'riStrikethrough',
          activeState: 'strike',
          handler: () => props.editor.chain().focus().toggleStrike().run(),
        },
        {
          name: 'inline-code',
          title: translations.menu.inlinecode,
          icon: 'riCodeLine',
          activeState: 'code',
          handler: () => props.editor.chain().focus().toggleCode().run(),
        },
        {
          name: 'highlight',
          title: translations.menu.highlight,
          icon: 'riMarkPenLine',
          activeState: 'highlight',
          handler: () => props.editor.chain().focus().toggleHighlight().run(),
        },
      ];
    });

    const store = useStore();
    const noteStore = useNoteStore();
    const router = useRouter();
    const editorImage = useEditorImage(props.editor);
    const dialog = useDialog();

    useGroupTooltip();

    const imgUrl = shallowRef('');
    const headingsTree = shallowRef([]);
    const showHeadingsTree = shallowRef(false);

    function insertImage() {
      editorImage.set(imgUrl.value);
      imgUrl.value = '';
      props.editor.commands.focus();
    }
    function getHeadingsTree() {
      const editorEl = props.editor.options.element;
      const headingEls = editorEl.querySelectorAll('h1, h2, h3, h4');
      const headingsArr = Array.from(headingEls).map((heading) => ({
        el: heading,
        tag: heading.tagName,
        top: heading.offsetTop,
        text: heading.innerText.slice(0, 120),
      }));

      headingsTree.value = headingsArr;
    }
    function toggleFocusMode() {
      store.inFocusMode = !store.inFocusMode;

      if (store.inFocusMode) {
        document.documentElement.requestFullscreen();
        props.editor.commands.focus();
      } else {
        document.exitFullscreen();
      }
    }

    function deleteNode() {
      dialog.confirm({
        title: translations.card.confirmPrompt,
        okText: translations.card.confirm,
        cancelText: translations.card.Cancel,
        onConfirm: async () => {
          await noteStore.delete(props.id);
          router.push('/');
        },
      });
    }

    const shortcuts = {
      'mod+alt+h': () => (showHeadingsTree.value = !showHeadingsTree.value),
      'mod+shift+d': deleteNode,
      'mod+shift+f': toggleFocusMode,
      'mod+p': printContent,
    };
    Mousetrap.bind(Object.keys(shortcuts), (event, combo) => {
      shortcuts[combo]();
    });

    onUnmounted(() => {
      Mousetrap.unbind(Object.keys(shortcuts));
    });

    function printContent() {
      window.print();
    }

    const translations = shallowReactive({
      menu: {
        paragraph: 'menu.paragraph',
        heading: 'menu.heading',
        image: 'menu.image',
        imgurl: 'menu.imgurl',
        Link: 'menu.Link',
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

    const showAdavancedSettings = computed(() => {
      return localStorage.getItem('advanced-settings') === 'true';
    });

    return {
      store,
      lists,
      imgUrl,
      translations,
      headings,
      insertImage,
      editorImage,
      headingsTree,
      textFormatting,
      getHeadingsTree,
      toggleFocusMode,
      deleteNode,
      showAdavancedSettings,
      showHeadingsTree,
      printContent,
    };
  },
  data() {
    return {
      isDropdownOpen: false,
    };
  },
  methods: {
    openDropdown() {
      // Open the dropdown
      this.isDropdownOpen = true;
    },
    closeDropdown() {
      // Close the dropdown
      this.isDropdownOpen = false;
    },
    handleButtonClick(option) {
      // Handle the click event for each button
      console.log(`Button clicked: ${option}`);
      // You can add custom logic based on the button clicked

      // Close the dropdown after handling the click
      this.isDropdownOpen = false;
    },
  },
};
</script>

<style scoped>
@media print {
  .no-print {
    visibility: hidden;
  }
}

button {
  @apply hover:text-gray-800 dark:hover:text-white;
}

button.is-active {
  @apply text-primary dark:text-secondary hover:text-primary dark:hover:text-secondary;
}

input[type='number'] {
  &::-webkit-outer-spin-button,
  &::-webkit-inner-spin-button {
    opacity: 1;
  }
}
</style>
