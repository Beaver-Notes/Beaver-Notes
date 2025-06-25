<template>
  <div
    ref="container"
    class="text-neutral-600 dark:text-[color:var(--selected-dark-text)] bg-[#FFFFFF] dark:bg-[#232222] dark:text-neutral-50 overflow-x-auto sm:overflow-x-none scroll border-b z-20 top-0 w-full left-0 py-1 sticky top-0 no-print"
    :class="{ 'opacity-0 hover:opacity-100 transition': store.inReaderMode }"
    @wheel.passive="changeWheelDirection"
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
      <ui-popover padding="p-2 flex items-center">
        <template #trigger>
          <button
            v-tooltip.group="translations.menu.highlight"
            :class="{ 'is-active': editor.isActive('highlight') }"
            class="transition hoverable h-8 px-1 rounded-lg"
          >
            <v-remixicon name="riFontColor" />
          </button>
        </template>
        <div class="px-2">
          <p class="text-sm py-2">{{ translations.menu.textColor }}</p>
          <div class="grid grid-cols-4 gap-2">
            <div
              v-for="color in textColors"
              :key="color"
              :class="['w-8 h-8 cursor-pointer rounded']"
              @click="setTextColor(color)"
            >
              <v-remixicon name="riFontColor" :style="{ color: color }" />
            </div>
          </div>
          <p class="text-sm py-2">{{ translations.menu.highlighterColor }}</p>
          <div class="grid grid-cols-4 gap-2">
            <div
              v-for="color in highlighterColors"
              :key="color"
              :class="['w-8 h-8 cursor-pointer rounded', color]"
              @click="setHighlightColor(color)"
            ></div>
          </div>
        </div>
      </ui-popover>
      <hr class="border-r mx-2 h-6" />
      <div v-if="!isTableActive" class="flex">
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
      </div>
      <div v-else class="flex">
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
          v-tooltip.group="translations.menu.mergeorSplit"
          class="transition hoverable h-8 px-1 rounded-lg"
          @click="editor.chain().focus().mergeOrSplit().run()"
        >
          <v-remixicon name="riSplitCellsHorizontal" />
        </button>
        <button
          v-tooltip.group="translations.menu.toggleHeader"
          class="transition hoverable h-8 px-1 rounded-lg"
          @click="editor.chain().focus().toggleHeaderCell().run()"
        >
          <v-remixicon name="riBrush2Fill" />
        </button>
      </div>
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
      <div
        :class="[
          'flex items-center space-x-2',
          isRecording
            ? 'bg-primary text-[color:var(--selected-dark-text)] rounded-full'
            : '',
        ]"
      >
        <button
          v-tooltip.group="translations.menu.record"
          :class="[
            'transition hoverable h-10 p-2 flex items-center justify-center',
            isRecording
              ? 'rounded-full bg-primary text-[color:var(--selected-dark-text)]'
              : 'rounded-full hover',
          ]"
          @click="toggleRecording"
        >
          <v-remixicon :name="isRecording ? 'riStopCircleLine' : 'riMicLine'" />
        </button>
        <span v-if="isRecording" class="font-secondary font-semibold text-sm">
          {{ formattedTime }}
        </span>
        <button
          v-if="isRecording"
          v-tooltip.group="
            isPaused ? translations.menu.resume : translations.menu.pause
          "
          :class="[
            'transition hoverable h-10 p-2 flex items-center justify-center',
            isPaused
              ? 'rounded-full bg-primary text-[color:var(--selected-dark-text)]'
              : 'rounded-full hover',
          ]"
          @click="pauseResume"
        >
          <v-remixicon :name="isPaused ? 'riPlayFill' : 'riPauseFill'" />
        </button>
      </div>
      <button
        v-tooltip.group="translations.menu.Link"
        :class="{ 'is-active': editor.isActive('link') }"
        class="transition hoverable h-8 px-1 rounded-lg"
        @click="editor.chain().focus().toggleLink({ href: '' }).run()"
      >
        <v-remixicon name="riLink" />
      </button>
      <ui-popover padding="p-2 flex items-center">
        <template #trigger>
          <button
            v-tooltip.group="translations.menu.File"
            class="transition hoverable h-8 px-1 rounded-lg"
          >
            <v-remixicon name="riFile2Line" />
          </button>
        </template>
        <input
          v-model="fileUrl"
          class="bg-transparent mr-2"
          :placeholder="translations.menu.fileUrl || '-'"
          @keyup.enter="insertFile"
        />
        <v-remixicon
          name="riFolderOpenLine"
          class="mr-2 cursor-pointer"
          @click="$refs.fileInput.click()"
        />
        <input
          ref="fileInput"
          type="file"
          class="hidden"
          multiple
          @change="handleFileSelect"
        />
        <v-remixicon
          name="riSave3Line"
          class="mr-2 cursor-pointer"
          @click="insertFile"
        />
      </ui-popover>
      <button
        v-tooltip.group="translations.menu.table"
        class="transition hoverable h-8 px-1 rounded-lg"
        @click="insertTableWithEmptyParagraph"
      >
        <v-remixicon name="riTableLine" />
      </button>
      <ui-popover padding="p-2 flex items-center">
        <ui-popover padding="p-2 flex items-center">
          <template #trigger>
            <button
              v-tooltip.group="translations.menu.Embed"
              class="transition hoverable h-8 px-1 rounded-lg"
            >
              <v-remixicon name="riPagesLine" />
            </button>
          </template>
          <input
            v-model="EmbedUrl"
            class="bg-transparent mr-2"
            :placeholder="translations.menu.EmbedUrl || '-'"
            @keyup.enter="addIframe"
          />
          <v-remixicon
            name="riSave3Line"
            class="mr-2 cursor-pointer"
            @click="addIframe"
          />
        </ui-popover>
        <template #trigger>
          <button class="transition hoverable h-8 px-1 rounded-lg">
            <v-remixicon name="riMoreFill" />
          </button>
        </template>
        <button
          v-tooltip.group="translations.menu.draw"
          class="transition hoverable h-8 px-1 rounded-lg"
          @click="editor.commands.insertPaper"
        >
          <v-remixicon name="riBrushLine" />
        </button>
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
            v-model="VideoUrl"
            class="bg-transparent mr-2"
            :placeholder="translations.menu.videoUrl || '-'"
            @keyup.enter="insertVideo"
          />
          <v-remixicon
            name="riFolderOpenLine"
            class="mr-2 cursor-pointer"
            @click="$refs.videoInput.click()"
          />
          <input
            ref="videoInput"
            type="file"
            class="hidden"
            multiple
            @change="handleVideoSelect"
          />
          <input
            ref="fileInput"
            type="file"
            class="hidden"
            multiple
            @change="handleFileSelect"
          />
          <v-remixicon
            name="riSave3Line"
            class="mr-2 cursor-pointer"
            @click="insertVideo"
          />
        </ui-popover>
      </ui-popover>
      <hr class="border-r mx-2 h-6" />
      <div v-if="!isTableActive" class="flex">
        <ui-popover padding="p-2 flex flex-col print:hidden">
          <template #trigger>
            <button class="transition hoverable h-8 px-1 rounded-lg">
              <v-remixicon name="riShare2Line" />
            </button>
          </template>
          <button
            v-for="action in share"
            :key="action.name"
            class="flex items-center p-2 rounded-lg text-black dark:text-[color:var(--selected-dark-text)] cursor-pointer hover:bg-neutral-100 dark:hover:bg-[#353333] transition duration-200"
            @click="action.handler"
          >
            <v-remixicon :name="action.icon" />
            <div
              class="text-left overflow-hidden text-ellipsis whitespace-nowrap"
            >
              <p
                class="font-medium text-neutral-800 dark:text-[color:var(--selected-dark-text)] pl-2"
              >
                {{ action.title }}
              </p>
            </div>
          </button>
        </ui-popover>
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
          v-tooltip.group="translations.menu.readerMode"
          :class="{ 'is-active': store.inReaderMode }"
          class="hoverable h-8 px-1 rounded-lg h-full"
          @click="toggleReaderMode"
        >
          <v-remixicon name="riArticleLine" />
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
        >
          <note-menu-headings-tree
            v-if="isShow"
            :editor="editor"
            :headings="headingsTree"
            @close="showHeadingsTree = false"
          />
        </ui-popover>
      </div>
      <div v-else>
        <button
          v-tooltip.group="translations.menu.deleteTable"
          class="transition hoverable h-8 px-1 rounded-lg"
          @click="editor.chain().focus().deleteTable().run()"
        >
          <v-remixicon name="riDeleteBin6Line" />
        </button>
      </div>
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
import useAudioRecorder from '@/utils/record';
import { useGroupTooltip } from '@/composable/groupTooltip';
import { useStore } from '@/store';
import { saveFile } from '../../utils/copy-doc';
import { useEditorImage } from '@/composable/editorImage';
import Mousetrap from '@/lib/mousetrap';
import NoteMenuHeadingsTree from './NoteMenuHeadingsTree.vue';
import { useNoteStore } from '../../store/note';
import { useRouter } from 'vue-router';
import { useDialog } from '@/composable/dialog';
import { useStorage } from '@/composable/storage';
import { exportBEA } from '../../utils/share/BEA';
import { exportHTML } from '../../utils/share/HTML';
import { exportMD } from '../../utils/share/MD';
import { useTranslation } from '@/composable/translations';

const { path, ipcRenderer } = window.electron;
const filePath = '';
const storage = useStorage('settings');
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
    note: {
      type: Object,
      required: true,
    },
  },
  emits: ['update:tree'],
  setup(props) {
    const {
      isRecording,
      formattedTime,
      toggleRecording,
      isPaused,
      pauseResume,
    } = useAudioRecorder(props, ipcRenderer, storage, path);
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
          title: translations.value.menu.orderedlist,
          icon: 'riListOrdered',
          activeState: 'orderedList',
          handler: () => props.editor.chain().focus().toggleOrderedList().run(),
        },
        {
          name: 'bullet-list',
          title: translations.value.menu.bulletlist,
          icon: 'riListUnordered',
          activeState: 'bulletList',
          handler: () => props.editor.chain().focus().toggleBulletList().run(),
        },
        {
          name: 'check-list',
          title: translations.value.menu.checklist,
          icon: 'riListCheck2',
          activeState: 'taskList',
          handler: () => props.editor.chain().focus().toggleTaskList().run(),
        },
        {
          name: 'blockquote',
          title: translations.value.menu.blockquote,
          icon: 'riDoubleQuotesR',
          activeState: 'blockquote',
          handler: () => props.editor.chain().focus().toggleBlockquote().run(),
        },
        {
          name: 'code-block',
          title: translations.value.menu.codeblock,
          icon: 'riCodeBoxLine',
          activeState: 'codeBlock',
          handler: () => props.editor.chain().focus().toggleCodeBlock().run(),
        },
      ];
    });

    const share = computed(() => {
      return [
        {
          name: 'Bea',
          title: 'BEA',
          icon: 'riFileTextFill',
          handler: () => shareNote(),
        },
        {
          name: 'html',
          title: 'HTML',
          icon: 'riPagesLine',
          handler: () => shareHTML(),
        },
        {
          name: 'pdf',
          title: 'PDF',
          icon: 'riArticleLine',
          handler: () => printContent(),
        },
        {
          name: 'markdown',
          title: 'MD',
          icon: 'riMarkdownLine',
          handler: () => shareMarkdown(),
        },
      ];
    });

    const isTableActive = computed(() => {
      return (
        props.editor.isActive('tableCell') ||
        props.editor.isActive('tableHeader')
      );
    });

    const textFormatting = computed(() => {
      return [
        {
          name: 'bold',
          title: translations.value.menu.bold,
          icon: 'riBold',
          activeState: 'bold',
          handler: () => props.editor.chain().focus().toggleBold().run(),
        },
        {
          name: 'italic',
          title: translations.value.menu.italic,
          icon: 'riItalic',
          activeState: 'italic',
          handler: () => props.editor.chain().focus().toggleItalic().run(),
        },
        {
          name: 'underline',
          title: translations.value.menu.underline,
          icon: 'riUnderline',
          activeState: 'underline',
          handler: () => props.editor.chain().focus().toggleUnderline().run(),
        },
        {
          name: 'strikethrough',
          title: translations.value.menu.strikethrough,
          icon: 'riStrikethrough',
          activeState: 'strike',
          handler: () => props.editor.chain().focus().toggleStrike().run(),
        },
        {
          name: 'inline-code',
          title: translations.value.menu.inlinecode,
          icon: 'riCodeLine',
          activeState: 'code',
          handler: () => props.editor.chain().focus().toggleCode().run(),
        },
      ];
    });

    const store = useStore();
    const noteStore = useNoteStore();
    const router = useRouter();
    const editorImage = useEditorImage(props.editor);
    const dialog = useDialog();
    const translations = ref({ menu: {} });

    useGroupTooltip();

    const imgUrl = shallowRef('');
    const fileUrl = shallowRef('');
    const VideoUrl = shallowRef('');
    const EmbedUrl = shallowRef('');
    const headingsTree = shallowRef([]);
    const showHeadingsTree = shallowRef(false);
    function normalizePath(path) {
      return path.replace(/\\/g, '');
    }

    function shareNote() {
      exportBEA(props.id, props.note.title);
    }

    function shareMarkdown() {
      exportMD(props.id, props.note.title, props.editor);
    }

    function shareHTML() {
      exportHTML(props.id, props.note.title, props.editor);
    }

    function insertImage() {
      let imgUrlValue = normalizePath(imgUrl.value);
      editorImage.set(imgUrlValue);
      imgUrl.value = '';
      props.editor.commands.focus();
    }

    function insertFile() {
      let fileUrlValue = normalizePath(fileUrl.value);
      const url = fileUrlValue;
      const filename = url.substring(url.lastIndexOf('/') + 1);
      props.editor.commands.setFileEmbed(url, filename);
      fileUrl.value = '';
    }

    function insertVideo() {
      let videoUrlValue = normalizePath(VideoUrl.value);
      const url = videoUrlValue;
      props.editor.commands.setVideo(url);
      VideoUrl.value = '';
    }

    function addIframe() {
      if (EmbedUrl.value.trim() === '') {
        return;
      }

      let trimmedEmbedUrl = EmbedUrl.value.trim();

      if (trimmedEmbedUrl.includes('youtube.com/watch?v=')) {
        let EmbedId = trimmedEmbedUrl.split('v=')[1];
        const ampersandPosition = EmbedId.indexOf('&');
        if (ampersandPosition !== -1) {
          EmbedId = EmbedId.substring(0, ampersandPosition);
        }
        trimmedEmbedUrl = `https://www.youtube.com/embed/${EmbedId}`;
      }

      props.editor
        .chain()
        .focus()
        .setIframe({
          src: trimmedEmbedUrl,
        })
        .run();

      EmbedUrl.value = '';
    }

    function getHeadingsTree() {
      const editorEl = props.editor.options.element;
      const headingEls = editorEl.querySelectorAll('h1, h2, h3, h4');
      const headingsArr = Array.from(headingEls).map((heading) => {
        let pos = null;
        try {
          pos = props.editor.view.posAtDOM(heading, 0);
        } catch (err) {
          console.warn('Could not resolve position for heading:', heading, err);
        }

        return {
          el: heading,
          tag: heading.tagName,
          top: heading.offsetTop,
          text: heading.innerText.slice(0, 120),
          pos,
        };
      });

      headingsTree.value = headingsArr;
    }

    const setZoom = (newZoomLevel) => {
      window.electron.ipcRenderer.callMain('app:set-zoom', newZoomLevel);

      state.zoomLevel = newZoomLevel.toFixed(1);
      localStorage.setItem('zoomLevel', state.zoomLevel);
    };

    const handleZoomButtonClick = () => {
      const storedZoomLevel = parseFloat(localStorage.getItem('zoomLevel'));

      if (!isNaN(storedZoomLevel)) {
        setZoom(storedZoomLevel);
      } else {
        console.warn(
          'No valid zoom level found in localStorage. Setting default zoom level.'
        );
        const defaultZoomLevel = 1.0;
        setZoom(defaultZoomLevel);
      }
    };

    function toggleReaderMode() {
      handleZoomButtonClick();
      store.inReaderMode = !store.inReaderMode;

      if (store.inReaderMode) {
        document.documentElement.requestFullscreen();
        props.editor.commands.focus();
        props.editor.setOptions({ editable: false });
      } else {
        document.exitFullscreen();
        props.editor.setOptions({ editable: true });
      }
    }

    function deleteNode() {
      dialog.confirm({
        title: translations.value.card.confirmPrompt,
        okText: translations.value.card.confirm,
        cancelText: translations.value.card.Cancel,
        onConfirm: async () => {
          await noteStore.delete(props.id);
          router.push('/');
        },
      });
    }

    const shortcuts = {
      'mod+alt+h': () => (showHeadingsTree.value = !showHeadingsTree.value),
      'mod+shift+d': deleteNode,
      'mod+shift+f': toggleReaderMode,
      'mod+p': printContent,
    };
    Mousetrap.bind(Object.keys(shortcuts), (event, combo) => {
      shortcuts[combo]();
    });

    onUnmounted(() => {
      Mousetrap.unbind(Object.keys(shortcuts));
    });

    function printContent() {
      ipcRenderer.callMain('print-pdf', {
        pdfName: `${props.note.title}.pdf`,
      });
    }

    onMounted(async () => {
      await useTranslation().then((trans) => {
        if (trans) {
          translations.value = trans;
        }
      });
    });

    const showAdavancedSettings = computed(() => {
      return localStorage.getItem('advanced-settings') === 'true';
    });

    const handleFileSelect = async (event) => {
      const files = event.target.files;
      if (!files.length) return;

      try {
        for (const file of files) {
          const { fileName, relativePath } = await saveFile(file, props.id);
          const src = `${relativePath}`;
          props.editor.commands.setFileEmbed(src, fileName);
        }
      } catch (error) {
        console.error(error);
      }
    };

    const handleVideoSelect = async (event) => {
      const files = event.target.files;
      if (!files.length) return;

      try {
        for (const file of files) {
          const { relativePath } = await saveFile(file, props.id);
          const src = `${relativePath}`;
          props.editor.commands.setVideo(src);
        }
      } catch (error) {
        console.error(error);
      }
    };

    const container = ref();
    function changeWheelDirection(e) {
      if (container.value) {
        container.value.scrollLeft += e.deltaY + e.deltaX;
      }
    }

    const highlighterColors = [
      'bg-[#DC8D42]/30 dark:bg-[#DC8D42]/40 dark:text-[color:var(--selected-dark-text)]', // Matches text #DC8D42 (orange)
      'bg-[#E3B324]/30 dark:bg-[#E3B324]/40 dark:text-[color:var(--selected-dark-text)]', // Matches text #E3B324 (yellow)
      'bg-[#4CAF50]/30 dark:bg-[#4CAF50]/40 dark:text-[color:var(--selected-dark-text)]', // Matches text #4CAF50 (green)
      'bg-[#3A8EE6]/30 dark:bg-[#3A8EE6]/40 dark:text-[color:var(--selected-dark-text)]', // Matches text #3A8EE6 (blue)
      'bg-[#9B5EE6]/30 dark:bg-[#9B5EE6]/40 dark:text-[color:var(--selected-dark-text)]', // Matches text #9B5EE6 (purple)
      'bg-[#E67EA4]/30 dark:bg-[#E67EA4]/40 dark:text-[color:var(--selected-dark-text)]', // Matches text #E67EA4 (pink)
      'bg-[#E75C5C]/30 dark:bg-[#E75C5C]/40 dark:text-[color:var(--selected-dark-text)]', // Matches text #E75C5C (red)
      'bg-[#A3A3A3]/30 dark:bg-[#A3A3A3]/40 dark:text-[color:var(--selected-dark-text)]', // Matches text #A3A3A3 (gray)
    ];

    const textColors = [
      '#DC8D42',
      '#E3B324',
      '#4CAF50',
      '#3A8EE6',
      '#9B5EE6',
      '#E67EA4',
      '#E75C5C',
      '#A3A3A3',
    ];

    function setHighlightColor(color) {
      if (props.editor.isActive('highlight', { color })) {
        props.editor.commands.unsetHighlight();
      } else {
        props.editor.commands.setHighlight({ color });
      }
    }

    function setTextColor(color) {
      if (props.editor.isActive('textStyle', { color })) {
        props.editor
          .chain()
          .focus()
          .updateAttributes('textStyle', { color: null }) // selectively unset
          .run();
      } else {
        props.editor.commands.setColor(color);
      }
    }

    return {
      store,
      highlighterColors,
      textColors,
      setHighlightColor,
      lists,
      isTableActive,
      imgUrl,
      EmbedUrl,
      handleFileSelect,
      translations,
      headings,
      insertImage,
      filePath,
      addIframe,
      editorImage,
      headingsTree,
      setTextColor,
      textFormatting,
      getHeadingsTree,
      toggleReaderMode,
      toggleRecording,
      handleVideoSelect,
      isRecording,
      isPaused,
      pauseResume,
      formattedTime,
      insertFile,
      fileUrl,
      insertVideo,
      VideoUrl,
      deleteNode,
      showAdavancedSettings,
      showHeadingsTree,
      printContent,
      container,
      changeWheelDirection,
      shareNote,
      shareHTML,
      shareMarkdown,
      share,
    };
  },
  methods: {
    insertTableWithEmptyParagraph() {
      // Insert the table first
      const transaction = this.editor
        .chain()
        .focus()
        .insertTable({ rows: 3, cols: 3, withHeaderRow: true })
        .run();

      if (transaction) {
        const pos = this.editor.state.doc.content.size;
        this.editor
          .chain()
          .focus()
          .insertContentAt(pos, {
            type: 'paragraph',
            content: [],
          })
          .run();
      } else {
        console.error('Failed to insert table.');
      }
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
  @apply hover:text-neutral-800 dark:hover:text-[color:var(--selected-dark-text)];
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
