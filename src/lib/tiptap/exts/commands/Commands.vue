<!-- eslint-disable vue/multi-word-component-names -->
<template>
  <div
    class="bg-white dark:bg-neutral-900 rounded-xl shadow-xl border p-1.5 max-w-[18rem] min-w-[8rem]"
  >
    <ui-list class="overflow-y-auto no-scrollbar max-h-80">
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
            class="flex items-center justify-center rounded-lg border flex-shrink-0 bg-white dark:bg-neutral-900 p-1.5"
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
import { saveFile } from '@/utils/assets/storage.js';
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
      if (!props.editor || props.editor.isDestroyed) return;
      props.command({
        editor: props.editor,
        range: props.range,
        props: {
          action: (chain) => item.action(chain),
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
              action: (chain) => chain.setFileEmbed(relativePath, fileName),
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
                action: (chain) => chain.setVideo(relativePath),
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
                action: (chain) => chain.setAudio(relativePath),
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
        action: (chain) => chain.setParagraph(),
      },
      ...Array.from({ length: 6 }, (_, i) => ({
        icon: `riH${i + 1}`,
        name: `heading ${i + 1}`,
        description: headingDescriptions[i],
        action: (chain) => chain.toggleHeading({ level: i + 1 }),
      })),
      {
        icon: 'riDoubleQuotesR',
        name: 'blockQuote',
        description: 'blockQuoteDescription',
        action: (chain) => chain.toggleBlockquote(),
      },
      {
        icon: 'riCodeBoxLine',
        name: 'codeBlock',
        description: 'codeBlockDescription',
        action: (chain) => chain.toggleCodeBlock(),
      },
      {
        icon: 'riTableLine',
        name: 'table',
        description: 'tableDescription',
        action: (chain) =>
          chain.insertTable({ rows: 3, cols: 3, withHeaderRow: true }),
      },
      {
        icon: 'riListOrdered',
        name: 'orderedList',
        description: 'orderedListDescription',
        action: (chain) => chain.toggleOrderedList(),
      },
      {
        icon: 'riListUnordered',
        name: 'bulletList',
        description: 'bulletListDescription',
        action: (chain) => chain.toggleBulletList(),
      },
      {
        icon: 'riListCheck2',
        name: 'checkList',
        description: 'checkListDescription',
        action: (chain) => chain.toggleTaskList(),
      },
      {
        icon: 'riCalculatorLine',
        name: 'mathBlock',
        description: 'mathBlockDescription',
        action: (chain) =>
          chain.insertMathBlock({
            content: '',
            macros: '{\\f: "#1f(#2)"}',
          }),
      },
      {
        icon: 'riSingleQuotesR',
        name: 'blackCallout',
        description: 'blackCalloutDescription',
        className: 'dark:text-neutral-400',
        action: (chain) => chain.setBlackCallout(),
      },
      {
        icon: 'riSingleQuotesR',
        name: 'blueCallout',
        description: 'blueCalloutDescription',
        className: 'text-blue-500 dark:text-blue-500',
        action: (chain) => chain.setBlueCallout(),
      },
      {
        icon: 'riSingleQuotesR',
        name: 'greenCallout',
        description: 'greenCalloutDescription',
        className: 'text-green-600 dark:text-green-600',
        action: (chain) => chain.setGreenCallout(),
      },
      {
        icon: 'riSingleQuotesR',
        name: 'purpleCallout',
        description: 'purpleCalloutDescription',
        className: 'text-purple-500 dark:text-purple-500',
        action: (chain) => chain.setPurpleCallout(),
      },
      {
        icon: 'riSingleQuotesR',
        name: 'redCallout',
        description: 'redCalloutDescription',
        className: 'text-red-500 dark:text-red-500',
        action: (chain) => chain.setRedCallout(),
      },
      {
        icon: 'riSingleQuotesR',
        name: 'yellowCallout',
        description: 'yellowCalloutDescription',
        className: 'text-yellow-500 dark:text-yellow-500',
        action: (chain) => chain.setYellowCallout(),
      },
      {
        icon: 'riPieChart2Line',
        name: 'mermaid',
        description: 'mermaidDescription',
        action: (chain) => chain.setMermaidDiagram(),
      },
      {
        icon: 'riBrush3Fill',
        name: 'drawing',
        description: 'drawingDescription',
        action: (chain) => chain.insertPaper(),
      },
      {
        icon: 'riImageLine',
        name: 'image',
        description: 'imageDescription',
        action: (chain) => {
          editorImage.select(true);
          return chain;
        },
      },
      {
        icon: 'riFile2Line',
        name: 'file',
        description: 'fileDescription',
        action: (chain) => {
          handleFileSelect();
          return chain;
        },
      },
      {
        icon: 'riMovieLine',
        name: 'video',
        description: 'videoDescription',
        action: (chain) => {
          handleVideoSelect();
          return chain;
        },
      },
      {
        icon: 'riMicLine',
        name: 'audio',
        description: 'audioDescription',
        action: (chain) => {
          handleAudioSelect();
          return chain;
        },
      },
      {
        icon: 'riCalendarLine',
        name: 'todayDate',
        description: 'todayDateDescription',
        action: (chain) => {
          const customFormat = getSettingSync('todayDateFormat');
          return chain.insertContent(dayjs().format(customFormat));
        },
      },
      {
        icon: 'riTimerLine',
        name: 'currentTime',
        description: 'currentTimeDescription',
        action: (chain) => {
          const customFormat = getSettingSync('timeFormat');
          return chain.insertContent(dayjs().format(customFormat));
        },
      },
      {
        icon: 'riLayoutColumnLine',
        name: 'columns',
        description: 'columnsDescription',
        action: (chain) => chain.insertMultiColumn(2),
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
