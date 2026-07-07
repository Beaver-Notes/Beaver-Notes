<template>
  <div
    v-if="editor"
    class="bg-white dark:bg-neutral-900 border overflow-x-auto z-20 w-fit mx-auto p-1.5 rounded-xl shadow-md no-print no-scrollbar mobile:hidden"
  >
    <div class="flex items-center justify-start w-max h-full gap-1">
      <ui-popover>
        <template #trigger>
          <button
            v-tooltip.group="'Turn into'"
            class="hover:bg-neutral-100 dark:hover:bg-neutral-800 h-8 px-2 rounded-lg transition-colors flex items-center gap-1.5 text-sm font-medium text-neutral-700 dark:text-neutral-300"
          >
            {{ nodeName }}
            <v-remixicon
              name="riArrowDownSLine"
              class="size-6 text-neutral-400"
            />
          </button>
        </template>

        <div>
          <ui-list
            class="overflow-y-auto no-scrollbar min-w-[160px]"
            style="max-height: 20rem"
          >
            <ui-list-item
              v-for="item in menuOptions"
              :key="item.label"
              small
              class="flex items-center gap-2 hover:bg-neutral-100 dark:hover:bg-neutral-800 text-sm text-neutral-700 dark:text-neutral-300 cursor-pointer"
              @click="item.command"
            >
              <v-remixicon
                :name="item.icon"
                class="size-6 text-neutral-500"
                :class="item.className"
              />
              <span class="w-full text-left">{{ item.label }}</span>
            </ui-list-item>
          </ui-list>
        </div>
      </ui-popover>

      <span class="border-r mx-0.5 h-5" />

      <ui-popover>
        <template #trigger>
          <div
            class="flex items-center justify-between w-24 h-8 p-0.5 rounded-lg bg-neutral-50 dark:bg-neutral-800 overflow-hidden flex-shrink-0"
          >
            <button
              type="button"
              class="w-6 h-6 flex items-center justify-center hover:bg-neutral-200 dark:hover:bg-neutral-700 text-neutral-500 dark:text-neutral-400 focus:outline-none rounded-lg transition-colors"
              @click.stop="
                fontSize = Math.max(1, fontSize - 1);
                updateFontSize();
              "
            >
              <v-remixicon name="riSubtractLine" class="w-3.5 h-3.5" />
            </button>

            <input
              v-model.number="fontSize"
              v-tooltip.group="translations.menu.fontSize"
              type="number"
              min="1"
              class="w-8 bg-transparent text-center text-neutral-800 dark:text-white border-0 focus:outline-none text-xs font-medium [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
              @change="updateFontSize"
            />

            <button
              type="button"
              class="w-6 h-6 flex items-center justify-center hover:bg-neutral-200 dark:hover:bg-neutral-700 text-neutral-500 dark:text-neutral-400 focus:outline-none rounded-lg transition-colors"
              @click.stop="
                fontSize += 1;
                updateFontSize();
              "
            >
              <v-remixicon name="riAddLine" class="w-3.5 h-3.5" />
            </button>
          </div>
        </template>

        <div class="flex flex-col max-h-44 overflow-y-auto no-scrollbar w-24">
          <button
            class="w-full p-1.5 rounded-lg hover:bg-neutral-100 dark:hover:bg-neutral-800 text-left text-xs font-medium text-neutral-700 dark:text-neutral-300 transition-colors cursor-pointer"
            @click="
              editor.chain().focus().unsetFontSize().run();
              fontSize = null;
            "
          >
            Default
          </button>

          <button
            v-for="size in [10, 12, 14, 16, 18, 20, 24, 28, 32, 36]"
            :key="size"
            class="w-full p-1.5 rounded-lg hover:bg-neutral-100 dark:hover:bg-neutral-800 text-left text-xs text-neutral-600 dark:text-neutral-400 transition-colors cursor-pointer"
            @click="
              editor
                .chain()
                .focus()
                .setFontSize(size + 'pt')
                .run();
              fontSize = size;
            "
          >
            {{ size }}
          </button>
        </div>
      </ui-popover>

      <span class="border-r mx-0.5 h-5" />

      <ui-popover>
        <template #trigger>
          <button
            v-tooltip.group="'Align'"
            class="hover:bg-neutral-100 dark:hover:bg-neutral-800 h-8 px-2 rounded-lg transition-colors flex items-center gap-1 text-neutral-600 dark:text-neutral-400"
          >
            <v-remixicon :name="currentAlignmentIcon" class="size-6" />
            <v-remixicon
              name="riArrowDownSLine"
              class="w-3.5 h-3.5 text-neutral-400"
            />
          </button>
        </template>

        <div>
          <ui-list
            class="overflow-y-auto no-scrollbar min-w-[140px]"
            style="max-height: 20rem"
          >
            <ui-list-item
              v-for="item in alignmentOptions"
              :key="item.label"
              small
              :class="
                item.isActive
                  ? 'bg-neutral-100 dark:bg-neutral-800 text-neutral-900 dark:text-white font-medium'
                  : 'hover:bg-neutral-100 dark:hover:bg-neutral-800 text-neutral-700 dark:text-neutral-300'
              "
              class="flex items-center gap-2 cursor-pointer text-sm"
              @click="item.command"
            >
              <v-remixicon :name="item.icon" class="size-6 text-neutral-500" />
              <span class="w-full text-left">{{ item.label }}</span>
            </ui-list-item>
          </ui-list>
        </div>
      </ui-popover>

      <span class="border-r mx-0.5 h-5" />

      <template v-for="item in visibleItems" :key="item.id">
        <button
          v-if="fmtMap[item.id]"
          v-tooltip.group="fmtMap[item.id].title"
          :class="
            editor.isActive(fmtMap[item.id].state)
              ? 'bg-neutral-100 text-neutral-900 dark:bg-neutral-800 dark:text-white'
              : 'hover:bg-neutral-100 dark:hover:bg-neutral-800 text-neutral-600 dark:text-neutral-400'
          "
          class="h-8 w-8 rounded-lg transition-colors flex items-center justify-center"
          @click="fmtMap[item.id].run()"
        >
          <v-remixicon :name="fmtMap[item.id].icon" class="size-6" />
        </button>
      </template>

      <ui-popover
        v-model:model-value="linkPopoverOpen"
        @show="onLinkPopoverShow"
      >
        <template #trigger>
          <button
            v-tooltip.group="translations.menu.link"
            :class="
              editor.isActive('link')
                ? 'bg-neutral-100 text-neutral-900 dark:bg-neutral-800 dark:text-white'
                : 'hover:bg-neutral-100 dark:hover:bg-neutral-800 text-neutral-600 dark:text-neutral-400'
            "
            class="h-8 w-8 rounded-lg transition-colors flex items-center justify-center"
          >
            <v-remixicon name="riLink" class="size-6" />
          </button>
        </template>

        <div class="min-w-[260px]">
          <div class="flex items-center gap-2">
            <input
              ref="linkInputRef"
              v-model="linkInputValue"
              type="text"
              :placeholder="
                translations.editor?.linkPlaceholder || 'Enter URL or @note'
              "
              class="flex-1 min-w-0 px-2 py-1.5 rounded-lg bg-neutral-50 dark:bg-neutral-900 text-neutral-900 dark:text-neutral-100 placeholder-neutral-400 dark:placeholder-neutral-500 text-sm outline-none border border-transparent focus:border-primary transition-colors"
              @keydown="onLinkInputKeydown"
              @keydown.esc="closeLinkInput"
              @keyup.enter="saveLinkInput"
            />
            <button
              class="h-7 w-7 rounded-lg hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors flex items-center justify-center text-neutral-500"
              :title="translations.common?.cancel || 'Cancel'"
              @click="closeLinkInput"
            >
              <v-remixicon name="riCloseLine" class="size-4" />
            </button>
            <button
              class="h-7 w-7 rounded-lg hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors flex items-center justify-center text-primary"
              :title="translations.common?.save || 'Save'"
              :disabled="!linkInputValue.trim()"
              @click="saveLinkInput"
            >
              <v-remixicon name="riCheckLine" class="size-4" />
            </button>
          </div>

          <expand-transition>
            <div
              v-if="
                linkInputValue.startsWith('@') && linkSuggestions.length > 0
              "
              class="overflow-hidden mt-1"
            >
              <ui-list class="space-y-1 max-h-40 overflow-y-auto">
                <ui-list-item
                  v-for="(suggestion, index) in linkSuggestions"
                  :key="suggestion.id"
                  :active="index === selectedLinkIndex"
                  class="label-item w-full truncate text-sm"
                  @click="selectLinkNote(suggestion.id)"
                >
                  {{
                    suggestion.title ||
                    translations.editor?.untitledNote ||
                    'Untitled Note'
                  }}
                </ui-list-item>
              </ui-list>
            </div>
            <div
              v-else-if="
                linkInputValue.startsWith('@') && linkSuggestions.length === 0
              "
              class="mt-1 p-1.5 text-sm text-neutral-500 dark:text-neutral-400 italic"
            >
              {{
                translations.editor?.noMatchingNotes ||
                'No matching notes found'
              }}
            </div>
          </expand-transition>
        </div>
      </ui-popover>

      <ui-popover>
        <template #trigger>
          <button
            v-tooltip.group="translations.menu.highlight"
            class="hover:bg-neutral-100 dark:hover:bg-neutral-800 h-8 w-8 rounded-lg transition-colors flex items-center justify-center"
          >
            <v-remixicon
              name="riFontColor"
              class="size-6"
              :style="{ color: currentTextColor }"
            />
          </button>
        </template>

        <div class="w-40">
          <p
            class="text-[11px] font-semibold text-neutral-400 uppercase tracking-wider mb-2"
          >
            {{ translations.menu.textColor }}
          </p>

          <div class="grid grid-cols-4 gap-1.5 mb-4 justify-items-center">
            <button
              class="w-7 h-7 flex items-center justify-center rounded-lg border hover:bg-neutral-100 dark:hover:bg-neutral-800 text-neutral-600 dark:text-neutral-400 transition-colors"
              @click="editor.chain().focus().unsetColor().run()"
            >
              <v-remixicon name="riFontColor" class="w-3.5 h-3.5" />
            </button>

            <button
              v-for="c in textColors"
              :key="c"
              class="w-7 h-7 rounded-lg border border-neutral-100 dark:border-neutral-800 hover:scale-105 active:scale-95 transition-all flex items-center justify-center"
              :style="{ backgroundColor: c + '22' }"
              @click="setTextColor(c)"
            >
              <v-remixicon
                name="riFontColor"
                class="w-3.5 h-3.5"
                :style="{ color: c }"
              />
            </button>
          </div>

          <p
            class="text-[11px] font-semibold text-neutral-400 uppercase tracking-wider mb-2"
          >
            {{ translations.menu.highlighterColor }}
          </p>

          <div class="grid grid-cols-4 gap-1.5 justify-items-center">
            <button
              class="w-7 h-7 rounded-lg border flex items-center justify-center hover:bg-neutral-100 dark:hover:bg-neutral-800 text-neutral-500 text-xs font-medium transition-colors"
              @click="editor.commands.unsetHighlight()"
            >
              —
            </button>

            <button
              v-for="c in highlighterColors"
              :key="c"
              :class="[
                'w-7 h-7 rounded-lg hover:scale-105 active:scale-95 transition-all shadow-sm border border-black/5',
                c,
              ]"
              @click="setHighlightColor(c)"
            />
          </div>
        </div>
      </ui-popover>
    </div>
  </div>
</template>

<script>
import { ref, computed, watch, nextTick } from 'vue';
import { useNoteMenu } from '@/composable/useNoteMenu';
import { useNoteStore } from '@/store/note';
import { useRoute } from 'vue-router';

export default {
  props: {
    editor: { type: Object, default: null },
    id: { type: String, default: '' },
    note: { type: Object, required: true },
  },
  setup(props) {
    const menu = useNoteMenu(props);
    const route = useRoute();
    const noteStore = useNoteStore();

    // ── Link input state ────────────────────────────────────────────
    const linkInputValue = ref('');
    const linkInputRef = ref(null);
    const selectedLinkIndex = ref(0);
    const linkPopoverOpen = ref(false);

    function onLinkPopoverShow() {
      linkInputValue.value = '';
      selectedLinkIndex.value = 0;
      nextTick(() => linkInputRef.value?.focus());
    }

    const linkSuggestions = computed(() => {
      if (!linkInputValue.value.startsWith('@')) return [];
      const query = linkInputValue.value.substring(1).toLowerCase();
      if (!query) return [];
      return noteStore.notes
        .filter(
          (n) =>
            n.id !== route.params.id &&
            (n.title.toLowerCase().includes(query) ||
              n.id.toLowerCase().includes(query))
        )
        .slice(0, 6);
    });

    function resolveNoteFromQuery(value) {
      const query = value.substring(1).trim();
      if (!query) return null;
      return (
        noteStore.notes.find(
          (n) => n.title.toLowerCase() === query.toLowerCase()
        ) || noteStore.notes.find((n) => n.id === query)
      );
    }

    function saveLinkInput() {
      const value = linkInputValue.value.trim();
      if (!value || !props.editor) return;

      const chain = props.editor.chain().focus();

      if (value.startsWith('@')) {
        const note = resolveNoteFromQuery(value);
        if (note) {
          chain.insertLinkNote(note.id).run();
        }
      } else {
        chain.setLink({ href: value }).run();
      }

      linkInputValue.value = '';
      linkPopoverOpen.value = false;
    }

    function closeLinkInput() {
      linkInputValue.value = '';
      linkPopoverOpen.value = false;
      props.editor?.commands?.focus();
    }

    function selectLinkNote(id) {
      if (!props.editor) return;
      props.editor.chain().focus().insertLinkNote(id).run();
      linkInputValue.value = '';
      linkPopoverOpen.value = false;
    }

    function onLinkInputKeydown(event) {
      if (
        !linkInputValue.value.startsWith('@') ||
        linkSuggestions.value.length === 0
      )
        return;

      const len = linkSuggestions.value.length;

      if (event.key === 'ArrowUp') {
        event.preventDefault();
        selectedLinkIndex.value = (selectedLinkIndex.value + len - 1) % len;
      } else if (event.key === 'ArrowDown') {
        event.preventDefault();
        selectedLinkIndex.value = (selectedLinkIndex.value + 1) % len;
      } else if (event.key === 'Enter') {
        event.preventDefault();
        const note = linkSuggestions.value[selectedLinkIndex.value];
        if (note) selectLinkNote(note.id);
      }
    }

    watch(linkInputValue, (val) => {
      if (val.startsWith('@')) selectedLinkIndex.value = 0;
    });
    const blockTypes = [
      {
        id: 'paragraph',
        icon: 'riParagraph',
        label: 'Text',
        cmd: (e) => e.chain().focus().setParagraph().run(),
      },
      ...[1, 2, 3, 4, 5, 6].map((level) => ({
        id: 'heading',
        level,
        icon: `riH${level}`,
        label: `Heading ${level}`,
        cmd: (e) => e.chain().focus().toggleHeading({ level }).run(),
      })),
      {
        id: 'bulletList',
        icon: 'riListUnordered',
        label: 'Bullet List',
        cmd: (e) => e.chain().focus().toggleBulletList().run(),
      },
      {
        id: 'orderedList',
        label: 'Numbered List',
        icon: 'riListOrdered',
        cmd: (e) => e.chain().focus().toggleOrderedList().run(),
      },
      {
        id: 'taskList',
        label: 'Task List',
        icon: 'riListCheck2',
        cmd: (e) => e.chain().focus().toggleTaskList().run(),
      },
      {
        id: 'blockquote',
        label: 'Quote',
        icon: 'riDoubleQuotesR',
        cmd: (e) => e.chain().focus().toggleBlockquote().run(),
      },
      {
        id: 'codeBlock',
        label: 'Code Block',
        icon: 'riCodeBoxLine',
        cmd: (e) => e.chain().focus().toggleCodeBlock().run(),
      },
    ];

    const alignmentTypes = [
      {
        id: 'left',
        icon: 'riAlignLeft',
        label: 'Left',
        cmd: (e) => e.chain().focus().setTextAlign('left').run(),
      },
      {
        id: 'center',
        icon: 'riAlignCenter',
        label: 'Center',
        cmd: (e) => e.chain().focus().setTextAlign('center').run(),
      },
      {
        id: 'right',
        icon: 'riAlignRight',
        label: 'Right',
        cmd: (e) => e.chain().focus().setTextAlign('right').run(),
      },
      {
        id: 'justify',
        icon: 'riAlignJustify',
        label: 'Justify',
        cmd: (e) => e.chain().focus().setTextAlign('justify').run(),
      },
    ];

    const nodeName = computed(() => {
      const { editor } = props;
      if (!editor) return 'Text';

      const active = blockTypes.find((type) =>
        type.level
          ? editor.isActive(type.id, { level: type.level })
          : editor.isActive(type.id)
      );

      return active ? active.label : 'Text';
    });

    const menuOptions = computed(() => {
      return blockTypes.map((type) => ({
        label: type.label,
        command: () => type.cmd(props.editor),
        icon: type.icon,
        className: type.className || '',
      }));
    });

    const currentAlignment = computed(() => {
      const { editor } = props;
      if (!editor) return 'Left';

      const active = alignmentTypes.find((type) =>
        editor.isActive({ textAlign: type.id })
      );

      return active ? active.label : 'Left';
    });

    const currentAlignmentIcon = computed(() => {
      const { editor } = props;
      if (!editor) return 'riAlignLeft';

      const active = alignmentTypes.find((type) =>
        editor.isActive({ textAlign: type.id })
      );

      return active ? active.icon : 'riAlignLeft';
    });

    const alignmentOptions = computed(() => {
      return alignmentTypes.map((type) => ({
        label: type.label,
        command: () => type.cmd(props.editor),
        icon: type.icon,
        isActive: props.editor?.isActive({ textAlign: type.id }) || false,
      }));
    });

    return {
      ...menu,
      nodeName,
      menuOptions,
      currentAlignment,
      currentAlignmentIcon,
      alignmentOptions,
      // Link input
      linkInputValue,
      linkInputRef,
      selectedLinkIndex,
      linkPopoverOpen,
      linkSuggestions,
      onLinkPopoverShow,
      onLinkInputKeydown,
      closeLinkInput,
      saveLinkInput,
      selectLinkNote,
    };
  },
};
</script>
