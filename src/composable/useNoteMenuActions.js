import { computed } from 'vue';
import { exportHTML } from '@/utils/share/HTML';
import { exportMD } from '@/utils/share/MD';
import { exportBEA } from '@/utils/share/BEA';
import { exportPDF } from '@/utils/share/PDF';
import { buildWebExportDocument } from '@/utils/share/exportBulk';
import { tiptapToMarkdown, buildFrontmatter } from '@/utils/markdown';
import { backend, path } from '@/lib/tauri-bridge';
import { getAppDirectory } from '@/lib/native/app';
import { readDir } from '@/lib/native/fs';
import { readExportData } from '@/lib/native/exports';
import { useNoteStore } from '@/store/note';
import { saveDialog } from '@/lib/native/dialog';
import { useStorage } from '@/composable/storage';
import { useDialog } from '@/composable/dialog';
import mime from 'mime';

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

  const isMobile = backend.isMobileRuntime();
  const dialog = useDialog();

  async function handlePdfExport() {
    const noteName = (noteTitle || 'Untitled').replace(/[/\\?%*:|"<>]/g, '-');
    const { canceled, filePath } = await saveDialog({
      defaultPath: `${noteName}.pdf`,
      filters: [{ name: 'PDF', extensions: ['pdf'] }],
    });
    if (canceled || !filePath) return;

    try {
      await exportPDF(noteId, noteTitle, editor, filePath);
    } catch (error) {
      console.error('[PDF export]', error);
      dialog.alert({
        title: 'Error',
        body: error?.message || 'Failed to export PDF. Please try again.',
      });
    }
  }

  async function shareFile(fileName, content, mimeType) {
    const blob = new Blob([content], { type: mimeType });
    const file = new File([blob], fileName, { type: mimeType });
    if (
      typeof navigator !== 'undefined' &&
      navigator.share &&
      navigator.canShare?.({ files: [file] })
    ) {
      await navigator.share({ files: [file] });
      return true;
    }
    return false;
  }

  async function tryShareOrExport(shareFn, exportFn) {
    if (!(await shareFn())) {
      await exportFn();
    }
  }

  async function shareBEA() {
    const storage = useStorage();
    const allNotes = await storage.store();
    const notesArray = Array.isArray(allNotes)
      ? allNotes
      : Object.values(allNotes.notes || {});
    const noteToExport = notesArray.find((n) => n.id === noteId);
    if (!noteToExport) return;

    const appDirectory = await getAppDirectory();
    const encodeAssets = async (sourcePath) => {
      const assets = {};
      try {
        const files = await readDir(sourcePath);
        for (const file of files) {
          const filePath = path.join(sourcePath, file);
          const base64Data = await readExportData(filePath);
          assets[file] = base64Data || '';
        }
      } catch {}
      return assets;
    };

    const assets = {
      notesAssets: await encodeAssets(
        path.join(appDirectory, 'notes-assets', noteId)
      ),
      fileAssets: await encodeAssets(
        path.join(appDirectory, 'file-assets', noteId)
      ),
    };

    const exportedData = {
      data: {
        id: noteId,
        title: noteToExport.title,
        content: noteToExport.content,
        lockedNotes: JSON.parse(localStorage.getItem('lockedNotes')) || {},
        assets,
        labels: noteToExport.labels || [],
      },
    };

    await shareFile(
      `${noteTitle}.bea`,
      JSON.stringify(exportedData, null, 2),
      mime.getType('json') || 'application/json'
    );
  }

  async function shareHTML() {
    const html = await buildWebExportDocument(editor, {
      mode: 'self-contained',
      title: noteTitle,
      noteId,
    });
    await shareFile(
      `${noteTitle}.html`,
      html,
      mime.getType('html') || 'text/html'
    );
  }

  async function shareMD() {
    const noteStore = useNoteStore();
    const note = noteStore.data[noteId];
    const tiptapJson = editor.getJSON();
    const markdownBody = tiptapToMarkdown(tiptapJson, { noteId });
    const frontmatter = note ? buildFrontmatter(note, '') : '';
    const markdown = frontmatter
      ? `${frontmatter}\n${markdownBody}`
      : markdownBody;
    await shareFile(
      `${noteTitle}.md`,
      markdown,
      mime.getType('md') || 'text/markdown'
    );
  }

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
      handler: isMobile
        ? () =>
            tryShareOrExport(shareBEA, () =>
              exportBEA(noteId, noteTitle, editor)
            )
        : () => exportBEA(noteId, noteTitle, editor),
    },
    {
      name: 'html',
      title: 'HTML',
      icon: 'riPagesLine',
      handler: isMobile
        ? () =>
            tryShareOrExport(shareHTML, () =>
              exportHTML(noteId, noteTitle, editor)
            )
        : () => exportHTML(noteId, noteTitle, editor),
    },
    {
      name: 'markdown',
      title: 'Markdown',
      icon: 'riMarkdownLine',
      handler: isMobile
        ? () =>
            tryShareOrExport(shareMD, () => exportMD(noteId, noteTitle, editor))
        : () => exportMD(noteId, noteTitle, editor),
    },
    {
      name: 'pdf',
      title: 'PDF',
      icon: 'riFile2Line',
      handler: () => handlePdfExport(),
    },
  ]);

  const currentTextColor = computed(() =>
    editor.isActive('textStyle')
      ? editor.getAttributes('textStyle')?.color || null
      : null
  );

  const currentHighlightClass = computed(() =>
    editor.isActive('highlight')
      ? editor.getAttributes('highlight')?.color || null
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
    currentHighlightClass,
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
