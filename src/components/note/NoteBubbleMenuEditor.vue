<template>
  <div
    v-if="editor"
    class="bg-white dark:bg-neutral-900 border overflow-x-auto z-20 w-fit mx-auto p-1 rounded-xl shadow-md no-print no-scrollbar mobile:hidden"
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
            class="overflow-y-auto no-scrollbar p-1 min-w-[160px]"
            style="max-height: 20rem"
          >
            <ui-list-item
              v-for="item in menuOptions"
              :key="item.label"
              small
              class="flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-neutral-100 dark:hover:bg-neutral-800 text-sm text-neutral-700 dark:text-neutral-300 cursor-pointer"
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

      <ui-popover padding="p-1 flex flex-col">
        <template #trigger>
          <div
            class="flex items-center justify-between w-24 h-8 p-0.5 rounded-lg bg-neutral-50 dark:bg-neutral-800 border overflow-hidden flex-shrink-0"
          >
            <button
              type="button"
              class="w-6 h-6 flex items-center justify-center hover:bg-neutral-200 dark:hover:bg-neutral-700 text-neutral-500 dark:text-neutral-400 focus:outline-none rounded-md transition-colors"
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
              class="w-6 h-6 flex items-center justify-center hover:bg-neutral-200 dark:hover:bg-neutral-700 text-neutral-500 dark:text-neutral-400 focus:outline-none rounded-md transition-colors"
              @click.stop="
                fontSize += 1;
                updateFontSize();
              "
            >
              <v-remixicon name="riAddLine" class="w-3.5 h-3.5" />
            </button>
          </div>
        </template>

        <div
          class="flex flex-col gap-0.5 max-h-44 overflow-y-auto no-scrollbar p-0.5 w-24"
        >
          <button
            class="px-2 py-1.5 rounded-md hover:bg-neutral-100 dark:hover:bg-neutral-800 text-left text-xs font-medium text-neutral-700 dark:text-neutral-300"
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
            class="px-2 py-1 rounded-md hover:bg-neutral-100 dark:hover:bg-neutral-800 text-left text-xs text-neutral-600 dark:text-neutral-400"
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
            class="overflow-y-auto no-scrollbar p-1 min-w-[140px]"
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
              class="flex items-center gap-2 px-2 py-1.5 rounded-md cursor-pointer text-sm"
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

      <button
        v-tooltip.group="translations.menu.link"
        :class="
          editor.isActive('link')
            ? 'bg-neutral-100 text-neutral-900 dark:bg-neutral-800 dark:text-white'
            : 'hover:bg-neutral-100 dark:hover:bg-neutral-800 text-neutral-600 dark:text-neutral-400'
        "
        class="h-8 w-8 rounded-lg transition-colors flex items-center justify-center"
        @click="editor.chain().focus().toggleLink({ href: '' }).run()"
      >
        <v-remixicon name="riLink" class="size-6" />
      </button>

      <ui-popover padding="p-3">
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

          <div class="grid grid-cols-4 gap-1.5 mb-4">
            <button
              class="w-7 h-7 flex items-center justify-center rounded-md border hover:bg-neutral-100 dark:hover:bg-neutral-800 text-neutral-600 dark:text-neutral-400 transition-colors"
              @click="editor.chain().focus().unsetColor().run()"
            >
              <v-remixicon name="riFontColor" class="w-3.5 h-3.5" />
            </button>

            <button
              v-for="c in textColors"
              :key="c"
              class="w-7 h-7 rounded-md border border-neutral-100 dark:border-neutral-800 hover:scale-105 active:scale-95 transition-all flex items-center justify-center"
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

          <div class="grid grid-cols-4 gap-1.5">
            <button
              class="w-7 h-7 rounded-md border flex items-center justify-center hover:bg-neutral-100 dark:hover:bg-neutral-800 text-neutral-500 text-xs font-medium transition-colors"
              @click="editor.commands.unsetHighlight()"
            >
              —
            </button>

            <button
              v-for="c in highlighterColors"
              :key="c"
              :class="[
                'w-7 h-7 rounded-md hover:scale-105 active:scale-95 transition-all shadow-sm border border-black/5',
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
import { computed } from 'vue';
import { useNoteMenu } from '@/composable/useNoteMenu';

export default {
  props: {
    editor: { type: Object, default: null },
    id: { type: String, default: '' },
    note: { type: Object, required: true },
  },
  setup(props) {
    const menu = useNoteMenu(props);
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
    };
  },
};
</script>
