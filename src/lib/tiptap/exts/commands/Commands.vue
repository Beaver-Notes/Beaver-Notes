<!-- eslint-disable vue/multi-word-component-names -->
<template>
  <div
    class="bg-white dark:bg-neutral-800 rounded-xl shadow-xl border p-2"
    style="max-width: 18rem; min-width: 8rem"
  >
    <ui-list class="overflow-y-auto no-scrollbar" style="max-height: 20rem">
      <ui-list-item
        v-for="(item, index) in filteredItems"
        small
        :key="index"
        :active="index === selectedIndex"
        class="w-full"
        tag="button"
        :disabled="item.disabled"
        @click="handleItemClick(item)"
      >
        <div class="flex items-start w-full">
          <!-- Icon container with border -->
          <div
            class="flex items-center justify-center rounded-md border flex-shrink-0 bg-white dark:bg-neutral-900 p-2"
          >
            <v-remixicon
              :name="item.icon"
              class="text-base size-6"
              :class="item.className"
            />
          </div>
          <!-- Title and description -->
          <div class="flex flex-col min-w-0 flex-1 items-start pl-4">
            <span class="text-sm font-medium truncate leading-tight">
              {{ translations.menu[item.name] || item.name }}
            </span>
            <span
              class="text-xs leading-tight mt-0.5 truncate"
              :class="
                index === selectedIndex
                  ? 'opacity-75'
                  : 'text-neutral-500 dark:text-neutral-400'
              "
            >
              {{ translations.menu[item.description] || '' }}
            </span>
          </div>
        </div>
      </ui-list-item>
    </ui-list>
  </div>
</template>

<script>
import { ref, computed, getCurrentInstance } from 'vue';
import mime from 'mime';
import dayjs from '@/lib/dayjs';
import { getSettingSync } from '@/composable/settings';
import { useTranslations } from '@/composable/useTranslations';
import { useEditorImage } from '@/composable/editorImage';
import { saveFile } from '@/utils/copy-doc';
import { openDialog } from '@/lib/native/dialog';

export default {
  props: {
    editor: {
      type: Object,
      required: true,
    },
    query: {
      type: String,
      default: '',
    },
    range: {
      type: Object,
      required: true,
    },
    id: {
      type: String,
      default: '',
    },
    command: {
      type: Function,
      required: true,
    },
  },
  setup(props) {
    const instance = getCurrentInstance();
    const editorImage = useEditorImage(props.editor);
    const selectedIndex = ref(0);

    const { translations } = useTranslations();

    const filteredItems = computed(() => {
      return items.value.filter((item) =>
        item.name.toLowerCase().includes(props.query.toLowerCase())
      );
    });

    function onKeyDown({ event }) {
      switch (event.key) {
        case 'ArrowUp':
          upHandler();
          return true;
        case 'ArrowDown':
          downHandler();
          return true;
        case 'Enter':
          enterHandler();
          return true;
        default:
          return false;
      }
    }

    const handleItemClick = (item) => {
      props.command({
        editor: props.editor,
        range: props.range,
        props: {
          action: item.action,
        },
      });
    };

    const handleFileSelect = async () => {
      try {
        const { canceled, filePaths = [] } = await openDialog({
          properties: ['openFile', 'multiSelections'],
        });

        if (canceled || filePaths.length === 0) return;

        for (const path of filePaths) {
          const { fileName, relativePath } = await saveFile(path, props.id);

          props.command({
            editor: props.editor,
            range: props.range,
            props: {
              action: () => {
                props.editor.commands.setFileEmbed(relativePath, fileName);
              },
            },
          });
        }
      } catch (error) {
        console.error(error);
      }
    };

    const handleVideoSelect = async () => {
      try {
        const { canceled, filePaths = [] } = await openDialog({
          properties: ['openFile', 'multiSelections'],
        });

        if (canceled || !filePaths.length) return;

        for (const path of filePaths) {
          const { relativePath } = await saveFile(path, props.id);
          const type = mime.getType(path) || '';

          if (type.startsWith('video/')) {
            props.command({
              editor: props.editor,
              range: props.range,
              props: {
                action: () => props.editor.commands.setVideo(relativePath),
              },
            });
          }
        }
      } catch (error) {
        console.error(error);
      }
    };

    // Audio handler
    const handleAudioSelect = async () => {
      try {
        const { canceled, filePaths = [] } = await openDialog({
          properties: ['openFile', 'multiSelections'],
        });

        if (canceled || !filePaths.length) return;

        for (const path of filePaths) {
          const { relativePath } = await saveFile(path, props.id);
          const type = mime.getType(path) || '';

          if (type.startsWith('audio/')) {
            props.command({
              editor: props.editor,
              range: props.range,
              props: {
                action: () => props.editor.commands.setAudio(relativePath),
              },
            });
          }
        }
      } catch (error) {
        console.error(error);
      }
    };

    const headingDescriptions = [
      'heading1Description',
      'heading2Description',
      'heading3Description',
      'heading4Description',
      'heading5Description',
      'heading6Description',
    ];

    const items = ref([
      {
        icon: 'riParagraph',
        name: 'paragraph',
        description: 'paragraphDescription',
        action: () => props.editor.chain().focus().setParagraph().run(),
      },
      ...Array.from({ length: 6 }, (_, i) => ({
        icon: `riH${i + 1}`,
        name: `heading ${i + 1}`,
        description: headingDescriptions[i],
        action: () =>
          props.editor
            .chain()
            .focus()
            .toggleHeading({ level: i + 1 })
            .run(),
      })),
      {
        icon: 'riDoubleQuotesR',
        name: 'blockQuote',
        description: 'blockQuoteDescription',
        action: () => props.editor.chain().focus().toggleBlockquote().run(),
      },
      {
        icon: 'riCodeBoxLine',
        name: 'codeBlock',
        description: 'codeBlockDescription',
        action: () => props.editor.chain().focus().toggleCodeBlock().run(),
      },
      {
        icon: 'riTableLine',
        name: 'table',
        description: 'tableDescription',
        action: () =>
          props.editor
            .chain()
            .focus()
            .insertTable({ rows: 3, cols: 3, withHeaderRow: true })
            .run(),
      },
      {
        icon: 'riListOrdered',
        name: 'orderedList',
        description: 'orderedListDescription',
        action: () => props.editor.chain().focus().toggleOrderedList().run(),
      },
      {
        icon: 'riListUnordered',
        name: 'bulletList',
        description: 'bulletListDescription',
        action: () => props.editor.chain().focus().toggleBulletList().run(),
      },
      {
        icon: 'riListCheck2',
        name: 'checkList',
        description: 'checkListDescription',
        action: () => props.editor.chain().focus().toggleTaskList().run(),
      },
      {
        icon: 'riCalculatorLine',
        name: 'mathBlock',
        description: 'mathBlockDescription',
        action: () => {
          props.editor.commands.insertMathBlock({
            content: '',
            macros: '{\\f: "#1f(#2)"}',
          });
        },
      },
      {
        icon: 'riSingleQuotesR',
        name: 'blackCallout',
        description: 'blackCalloutDescription',
        className: 'dark:text-neutral-400',
        action: () => props.editor.chain().focus().setBlackCallout().run(),
      },
      {
        icon: 'riSingleQuotesR',
        name: 'blueCallout',
        description: 'blueCalloutDescription',
        className: 'text-blue-500 dark:text-blue-500',
        action: () => props.editor.chain().focus().setBlueCallout().run(),
      },
      {
        icon: 'riSingleQuotesR',
        name: 'greenCallout',
        description: 'greenCalloutDescription',
        className: 'text-green-600 dark:text-green-600',
        action: () => props.editor.chain().focus().setGreenCallout().run(),
      },
      {
        icon: 'riSingleQuotesR',
        name: 'purpleCallout',
        description: 'purpleCalloutDescription',
        className: 'text-purple-500 dark:text-purple-500',
        action: () => props.editor.chain().focus().setPurpleCallout().run(),
      },
      {
        icon: 'riSingleQuotesR',
        name: 'redCallout',
        description: 'redCalloutDescription',
        className: 'text-red-500 dark:text-red-500',
        action: () => props.editor.chain().focus().setRedCallout().run(),
      },
      {
        icon: 'riSingleQuotesR',
        name: 'yellowCallout',
        description: 'yellowCalloutDescription',
        className: 'text-yellow-500 dark:text-yellow-500',
        action: () => props.editor.chain().focus().setYellowCallout().run(),
      },
      {
        icon: 'riPieChart2Line',
        name: 'mermaid',
        description: 'mermaidDescription',
        action: () => props.editor.chain().focus().setMermaidDiagram().run(),
      },
      {
        icon: 'riBrush3Fill',
        name: 'drawing',
        description: 'drawingDescription',
        action: () => props.editor.chain().focus().insertPaper().run(),
      },
      {
        icon: 'riImageLine',
        name: 'image',
        description: 'imageDescription',
        action: () => {
          editorImage.select(true);
        },
      },
      {
        icon: 'riFile2Line',
        name: 'file',
        description: 'fileDescription',
        action: () => {
          handleFileSelect();
        },
      },
      {
        icon: 'riMovieLine',
        name: 'video',
        description: 'videoDescription',
        action: () => {
          handleVideoSelect();
        },
      },
      {
        icon: 'riMicLine',
        name: 'audio',
        description: 'audioDescription',
        action: () => {
          handleAudioSelect();
        },
      },
      {
        icon: 'riCalendarLine',
        name: 'todayDate',
        description: 'todayDateDescription',
        action: () => {
          const customFormat = getSettingSync('todayDateFormat');
          props.editor
            .chain()
            .focus()
            .insertContent(dayjs().format(customFormat))
            .run();
        },
      },
      {
        icon: 'riTimerLine',
        name: 'currentTime',
        description: 'currentTimeDescription',
        action: () => {
          const customFormat = getSettingSync('timeFormat');
          props.editor
            .chain()
            .focus()
            .insertContent(dayjs().format(customFormat))
            .run();
        },
      },
      {
        icon: 'riLayoutColumnLine',
        name: 'columns',
        description: 'columnsDescription',
        action: () => props.editor.chain().focus().insertMultiColumn(2).run(),
      },
    ]);

    function scrollToSelected() {
      const container = document.querySelector('.ui-list');
      const selectedEl = container?.children[selectedIndex.value];
      if (selectedEl) {
        selectedEl.scrollIntoView({ block: 'nearest' });
      }
    }

    function upHandler() {
      selectedIndex.value =
        (selectedIndex.value + filteredItems.value.length - 1) %
        filteredItems.value.length;
      scrollToSelected();
    }

    function downHandler() {
      selectedIndex.value =
        (selectedIndex.value + 1) % filteredItems.value.length;
      scrollToSelected();
    }

    function enterHandler() {
      selectItem(selectedIndex.value);
    }

    function selectItem(index) {
      const item = filteredItems.value[index];
      if (item) {
        handleItemClick(item);
      }
    }

    if (instance) {
      instance.exposed = instance.exposed || {};
      instance.exposed.onKeyDown = onKeyDown;
    }

    return {
      translations,
      filteredItems,
      handleItemClick,
      handleFileSelect,
      handleVideoSelect,
      selectedIndex,
      onKeyDown,
    };
  },
};
</script>
