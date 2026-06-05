import { computed } from 'vue';
import { exportHTML } from '@/utils/share/HTML';
import { exportMD } from '@/utils/share/MD';
import { exportBEA } from '@/utils/share/BEA';

const highlighterColors = [
  'bg-[#DC8D42]/30 dark:bg-[#DC8D42]/40',
  'bg-[#E3B324]/30 dark:bg-[#E3B324]/40',
  'bg-[#4CAF50]/30 dark:bg-[#4CAF50]/40',
  'bg-[#3A8EE6]/30 dark:bg-[#3A8EE6]/40',
  'bg-[#9B5EE6]/30 dark:bg-[#9B5EE6]/40',
  'bg-[#E67EA4]/30 dark:bg-[#E67EA4]/40',
  'bg-[#E75C5C]/30 dark:bg-[#E75C5C]/40',
];

const textColors = [
  '#DC8D42',
  '#E3B324',
  '#4CAF50',
  '#3A8EE6',
  '#9B5EE6',
  '#E67EA4',
  '#E75C5C',
];

export function useNoteMenuActions({
  editor,
  noteId,
  noteTitle,
  translations,
}) {
  const isTableActive = computed(
    () => editor.isActive('tableCell') || editor.isActive('tableHeader')
  );

  const fmtMap = computed(() => ({
    bold: {
      title: translations.value.menu.bold,
      icon: 'riBold',
      state: 'bold',
      run: () => editor.chain().focus().toggleBold().run(),
    },
    italic: {
      title: translations.value.menu.italic,
      icon: 'riItalic',
      state: 'italic',
      run: () => editor.chain().focus().toggleItalic().run(),
    },
    underline: {
      title: translations.value.menu.underline,
      icon: 'riUnderline',
      state: 'underline',
      run: () => editor.chain().focus().toggleUnderline().run(),
    },
    strikethrough: {
      title: translations.value.menu.strikethrough,
      icon: 'riStrikethrough',
      state: 'strike',
      run: () => editor.chain().focus().toggleStrike().run(),
    },
    inlineCode: {
      title: translations.value.menu.inlineCode,
      icon: 'riCodeLine',
      state: 'code',
      run: () => editor.chain().focus().toggleCode().run(),
    },
  }));

  const lists = computed(() => [
    {
      name: 'ol',
      title: translations.value.menu.orderedList,
      icon: 'riListOrdered',
      state: 'orderedList',
      run: () => editor.chain().focus().toggleOrderedList().run(),
    },
    {
      name: 'ul',
      title: translations.value.menu.bulletList,
      icon: 'riListUnordered',
      state: 'bulletList',
      run: () => editor.chain().focus().toggleBulletList().run(),
    },
    {
      name: 'cl',
      title: translations.value.menu.checkList,
      icon: 'riListCheck2',
      state: 'taskList',
      run: () => editor.chain().focus().toggleTaskList().run(),
    },
  ]);

  const drawActions = computed(() => [
    {
      name: 'block',
      title:
        translations.value.menu.insertDrawingBlock || 'Insert drawing block',
      description:
        translations.value.menu.insertDrawingBlockDescription ||
        'Create a standalone sketch area inside the note.',
      icon: 'riBrushLine',
      isActive: false,
      handler: () => editor.chain().focus().insertPaper().run(),
    },
  ]);

  const shareActions = computed(() => [
    {
      name: 'bea',
      title: 'BEA',
      icon: 'riFileTextFill',
      handler: () => exportBEA(noteId, noteTitle, editor),
    },
    {
      name: 'html',
      title: 'HTML',
      icon: 'riPagesLine',
      handler: () => exportHTML(noteId, noteTitle, editor),
    },
    {
      name: 'markdown',
      title: 'Markdown',
      icon: 'riMarkdownLine',
      handler: () => exportMD(noteId, noteTitle, editor),
    },
  ]);

  const currentTextColor = computed(() =>
    editor.isActive('textStyle')
      ? editor.getAttributes('textStyle')?.color || null
      : null
  );

  function setHighlightColor(color) {
    editor.isActive('highlight', { color })
      ? editor.commands.unsetHighlight()
      : editor.commands.setHighlight({ color });
  }

  function setTextColor(color) {
    editor.isActive('textStyle', { color })
      ? editor
          .chain()
          .focus()
          .updateAttributes('textStyle', { color: null })
          .run()
      : editor.commands.setColor(color);
  }

  return {
    currentTextColor,
    drawActions,
    fmtMap,
    highlighterColors,
    isTableActive,
    lists,
    setHighlightColor,
    setTextColor,
    shareActions,
    textColors,
  };
}
