<template>
  <div
    ref="container"
    class="text-gray-600 dark:text-[color:var(--selected-dark-text)] bg-[#FFFFFF] dark:bg-[#232222] dark:text-gray-50 overflow-x-auto sm:overflow-x-none scroll border-b z-20 top-0 w-full left-0 py-1 sticky top-0 no-print"
    :class="{ 'opacity-0 hover:opacity-100 transition': store.inFocusMode }"
    @wheel="changeWheelDirection"
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
      <ui-popover padding="p-2 flex items-center">
        <template #trigger>
          <button
            v-tooltip.group="translations.menu.video"
            class="transition hoverable h-8 px-1 rounded-lg"
          >
            <v-remixicon name="riMovieLine" />
          </button>
        </template>
        <input
          v-model="vidUrl"
          class="bg-transparent mr-2"
          :placeholder="translations.menu.vidUrl || '-'"
          @keyup.enter="addIframe"
        />
        <v-remixicon
          name="riSave3Line"
          class="mr-2 cursor-pointer"
          @click="addIframe"
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
        v-tooltip.group="translations.menu.File"
        :class="{ 'is-active': editor.isActive('file') }"
        class="transition hoverable h-8 px-1 rounded-lg"
        @click="$refs.fileInput.click()"
      >
        <v-remixicon name="riFile2Line" />
      </button>
      <input
        ref="fileInput"
        type="file"
        class="hidden"
        multiple
        @change="handleFileSelect"
      />
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
  ref,
} from 'vue';
import { useGroupTooltip } from '@/composable/groupTooltip';
import { useStore } from '@/store';
import { saveFile } from '../../utils/copy-doc';
import { useEditorImage } from '@/composable/editorImage';
import Mousetrap from '@/lib/mousetrap';
import NoteMenuHeadingsTree from './NoteMenuHeadingsTree.vue';
import { useNoteStore } from '../../store/note';
import { useRouter } from 'vue-router';
import { useDialog } from '@/composable/dialog';

const state = shallowReactive({
  zoomLevel: (+localStorage.getItem('zoomLevel') || 1).toFixed(1),
});

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
    const vidUrl = shallowRef('');
    const headingsTree = shallowRef([]);
    const showHeadingsTree = shallowRef(false);

    function insertImage() {
      editorImage.set(imgUrl.value);
      imgUrl.value = '';
      props.editor.commands.focus();
    }
    function addIframe() {
      if (vidUrl.value.trim() === '') {
        // Prevent adding iframe if vidUrl is empty or only contains whitespace
        return;
      }

      let videoUrl = vidUrl.value.trim();

      // Check if the URL is a YouTube video URL in the regular format
      if (videoUrl.includes('youtube.com/watch?v=')) {
        let videoId = videoUrl.split('v=')[1];
        const ampersandPosition = videoId.indexOf('&');
        if (ampersandPosition !== -1) {
          videoId = videoId.substring(0, ampersandPosition);
        }
        // Convert to the embed format
        videoUrl = `https://www.youtube.com/embed/${videoId}`;
      }

      // Use the value of vidUrl to set the iframe source
      props.editor
        .chain()
        .focus()
        .setIframe({
          src: videoUrl,
        })
        .run();

      // Clear the input field after setting the iframe source
      vidUrl.value = '';
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
    const setZoom = (newZoomLevel) => {
      // Call IPC renderer to set zoom level
      window.electron.ipcRenderer.callMain('app:set-zoom', newZoomLevel);

      // Update state and localStorage with the new zoom level
      state.zoomLevel = newZoomLevel.toFixed(1);
      localStorage.setItem('zoomLevel', state.zoomLevel);
    };

    // When the button is clicked, retrieve zoom level from local storage and call setZoom with that value
    const handleZoomButtonClick = () => {
      // Retrieve zoom level from localStorage
      const storedZoomLevel = parseFloat(localStorage.getItem('zoomLevel'));

      // Call setZoom with the retrieved zoom level
      setZoom(storedZoomLevel);
    };

    function toggleFocusMode() {
      handleZoomButtonClick();
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
        video: 'menu.video',
        vidUrl: 'menu.vidUrl',
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
      // Add event listeners for drag and drop
      document.addEventListener('drop', handleDrop);
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

    const handleFileSelect = async (event) => {
      const files = event.target.files;
      if (!files.length) return;

      const timestamp = Date.now();
      try {
        for (const file of files) {
          const { fileName, relativePath } = await saveFile(file, timestamp);
          const src = `${relativePath}`; // Construct the complete source path
          props.editor.commands.setFileEmbed(src, fileName);
        }
      } catch (error) {
        console.error(error);
      }
    };

    // Function to handle drop event
    async function handleDrop(event) {
      if (event.altKey || event.getModifierState('Alt') || event.metaKey) {
        // Alt/Opt key is pressed
        event.preventDefault();
        event.stopPropagation();

        // Access dropped files
        const files = event.dataTransfer.files;
        const timestamp = Date.now();

        try {
          for (const file of files) {
            const { fileName, relativePath } = await saveFile(file, timestamp);
            const src = `${relativePath}`; // Construct the complete source path
            props.editor.commands.setFileEmbed(src, fileName);
          }
        } catch (error) {
          console.error('Error saving and embedding files:', error);
        }
      }
    }

    const container = ref();
    function changeWheelDirection(e) {
      e.preventDefault();
      if (container.value) {
        container.value.scrollLeft += e.deltaY + e.deltaX;
      }
    }

    return {
      store,
      lists,
      imgUrl,
      vidUrl,
      handleFileSelect,
      translations,
      headings,
      insertImage,
      addIframe,
      editorImage,
      headingsTree,
      textFormatting,
      getHeadingsTree,
      toggleFocusMode,
      deleteNode,
      showAdavancedSettings,
      showHeadingsTree,
      printContent,
      container,
      changeWheelDirection,
    };
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
  @apply hover:text-gray-800 dark:hover:text-[color:var(--selected-dark-text)];
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
