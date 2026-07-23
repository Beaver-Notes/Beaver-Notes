import { computed, reactive, ref, shallowRef, onMounted, onUnmounted } from 'vue';
import { useRouter } from 'vue-router';
import useAudioRecorder from '@/utils/assets/record.js';
import { useGroupTooltip } from '@/composable/groupTooltip';
import { useUiState } from '@/composable/useUiState';
import { useNoteStore } from '@/store/note';
import { useEditorImage } from '@/composable/editorImage';
import { useDialog } from '@/composable/dialog';
import { useStorage } from '@/composable/storage';
import { useTranslations } from '@/composable/useTranslations';
import { useToolbarConfig } from '@/composable/useToolbarConfig';
import { backend, path } from '@/lib/tauri-bridge';
import { exportHTML } from '@/utils/share/HTML';
import { exportMD } from '@/utils/share/MD';
import { exportBEA } from '@/utils/share/BEA';
import { exportPDF } from '@/utils/share/PDF';
import { buildWebExportDocument } from '@/utils/share/exportBulk';
import { tiptapToMarkdown, buildFrontmatter } from '@/utils/markdown';
import { getAppDirectory } from '@/lib/native/app';
import {
  ensureDir,
  readDir,
  readData,
  writeFile,
  removePath,
} from '@/lib/native/fs';
import { readExportData } from '@/lib/native/exports';
import { saveDialog } from '@/lib/native/dialog';
import { shareFileViaNative } from '@/lib/native/share';
import mime from 'mime';
import { saveFile } from '@/utils/assets/storage.js';
import { getStoredZoomLevel, setStoredZoomLevel } from '@/composable/zoom';
import { bindGlobalShortcuts } from '@/utils/ui/globalShortcuts.js';

const storage = useStorage('settings');

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

function normalizePath(value) {
  return value.replace(/\\/g, '');
}

const inlineFormatItems = [
  { id: 'bold', fmt: 'bold' },
  { id: 'italic', fmt: 'italic' },
  { id: 'underline', fmt: 'underline' },
  { id: 'strikethrough', fmt: 'strikethrough' },
  { id: 'inlineCode', fmt: 'inlineCode' },
];

export function useNoteMenu(props) {
  const { translations } = useTranslations();
  const toolbar = useToolbarConfig();
  const visibleItems = toolbar.visibleItems;
  const showCustomizer = ref(false);

  const { isRecording, formattedTime, toggleRecording, isPaused, pauseResume } =
    useAudioRecorder(props, backend, storage, path);

  const uiState = useUiState();
  const noteStore = useNoteStore();
  const router = useRouter();
  const dialog = useDialog();
  const editorImage = useEditorImage(props.editor);
  useGroupTooltip();

  // --- useNoteMenuActions inlined ---
  const isTableActive = computed(
    () => props.editor.isActive('tableCell') || props.editor.isActive('tableHeader')
  );

  const isMobile = backend.isMobileRuntime();
  const actionsDialog = useDialog();

  async function handlePdfExport() {
    if (isMobile) {
      const noteName = (props.note?.title || 'Untitled').replace(/[/\\?%*:|"<>]/g, '-');
      const tempPath = await getTempSharePath(`${noteName}.pdf`);
      try {
        await exportPDF(props.id, props.note?.title || '', props.editor, tempPath);
        await shareFileViaNative(tempPath, 'application/pdf');
        try {
          await removePath(tempPath);
        } catch {}
      } catch (error) {
        console.error('[PDF export]', error);
        actionsDialog.alert({
          title: translations.value.settings?.alertTitle || 'Error',
          body: error?.message || translations.value.menu?.exportError || 'Failed to export PDF. Please try again.',
        });
        try {
          await removePath(tempPath);
        } catch {}
      }
      return;
    }

    const noteName = (props.note?.title || 'Untitled').replace(/[/\\?%*:|"<>]/g, '-');
    const { canceled, filePath } = await saveDialog({
      defaultPath: `${noteName}.pdf`,
      filters: [{ name: 'PDF', extensions: ['pdf'] }],
    });
    if (canceled || !filePath) return;

    try {
      await exportPDF(props.id, props.note?.title || '', props.editor, filePath);
    } catch (error) {
      console.error('[PDF export]', error);
      actionsDialog.alert({
        title: translations.value.settings?.alertTitle || 'Error',
        body: error?.message || translations.value.menu?.exportError || 'Failed to export PDF. Please try again.',
      });
    }
  }

  async function shareFile(fileName, content, mimeType) {
    if (isMobile) {
      const tempPath = await getTempSharePath(fileName);
      try {
        const data =
          typeof content === 'string'
            ? new TextEncoder().encode(content)
            : content;
        await writeFile(tempPath, Array.from(data));
        const shared = await shareFileViaNative(tempPath, mimeType);
        try {
          await removePath(tempPath);
        } catch {}
        return shared;
      } catch {
        try {
          await removePath(tempPath);
        } catch {}
        return false;
      }
    }

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

  async function getTempSharePath(fileName) {
    const tempDir = await backend.invoke('helper:get-path', 'temp');
    const shareDir = path.join(tempDir, 'beaver-notes-share');
    await ensureDir(shareDir);
    return path.join(shareDir, fileName);
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
    const noteToExport = notesArray.find((n) => n.id === props.id);
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
        path.join(appDirectory, 'notes-assets', props.id)
      ),
      fileAssets: await encodeAssets(
        path.join(appDirectory, 'file-assets', props.id)
      ),
    };

    const exportedData = {
      data: {
        id: props.id,
        title: noteToExport.title,
        content: noteToExport.content,
        lockedNotes: JSON.parse(localStorage.getItem('lockedNotes')) || {},
        assets,
        labels: noteToExport.labels || [],
      },
    };

    await shareFile(
      `${props.note?.title || 'Untitled'}.bea`,
      JSON.stringify(exportedData, null, 2),
      mime.getType('json') || 'application/json'
    );
  }

  async function shareHTML() {
    if (isMobile) {
      const html = await buildWebExportDocument(props.editor, {
        mode: 'folder',
        title: props.note?.title || '',
        noteId: props.id,
      });
      return await shareAsZip(html, 'html', props.id);
    }
    const html = await buildWebExportDocument(props.editor, {
      mode: 'self-contained',
      title: props.note?.title || '',
      noteId: props.id,
    });
    return await shareFile(
      `${props.note?.title || 'Untitled'}.html`,
      html,
      mime.getType('html') || 'text/html'
    );
  }

  async function shareMD() {
    const note = noteStore.data[props.id];
    const tiptapJson = props.editor.getJSON();
    const markdownBody = tiptapToMarkdown(tiptapJson, { noteId: props.id });
    const frontmatter = note ? buildFrontmatter(note, '') : '';
    const markdown = frontmatter
      ? `${frontmatter}\n${markdownBody}`
      : markdownBody;
    if (isMobile) {
      return await shareAsZip(markdown, 'md', props.id);
    }
    return await shareFile(
      `${props.note?.title || 'Untitled'}.md`,
      markdown,
      mime.getType('md') || 'text/markdown'
    );
  }

  async function shareAsZip(content, ext, _sourceNoteId) {
    const JSZip = (await import('jszip')).default;
    const zip = new JSZip();
    const safeName = props.note?.title || 'Untitled';
    zip.file(`${safeName}.${ext}`, content);

    const appDir = await getAppDirectory();
    const assetRegex =
      /(assets\/([^/]+)\/([^)]+)|file-assets\/([^/]+)\/([^)]+))/g;
    let match;
    const seen = new Set();
    while ((match = assetRegex.exec(content)) !== null) {
      const [full, , assetNoteId, assetFile, fileAssetNoteId, fileAssetFile] =
        match;
      const zipPath = full;
      if (seen.has(zipPath)) continue;
      seen.add(zipPath);
      const nid = assetNoteId || fileAssetNoteId;
      const fname = assetFile || fileAssetFile;
      const assetType = assetFile ? 'notes-assets' : 'file-assets';
      const srcPath = path.join(appDir, assetType, nid, fname);
      try {
        const base64 = await readData(srcPath);
        if (base64) zip.file(zipPath, base64, { base64: true });
      } catch {}
    }

    const zipBlob = await zip.generateAsync({ type: 'blob' });
    const zipBuffer = await zipBlob.arrayBuffer();
    const zipName = `${safeName}.zip`;
    return await shareFile(
      zipName,
      new Uint8Array(zipBuffer),
      'application/zip'
    );
  }

  const fmtMap = computed(() => ({
    bold: {
      title: translations.value.menu.bold,
      icon: 'riBold',
      state: 'bold',
      run: () => props.editor.chain().focus().toggleBold().run(),
    },
    italic: {
      title: translations.value.menu.italic,
      icon: 'riItalic',
      state: 'italic',
      run: () => props.editor.chain().focus().toggleItalic().run(),
    },
    underline: {
      title: translations.value.menu.underline,
      icon: 'riUnderline',
      state: 'underline',
      run: () => props.editor.chain().focus().toggleUnderline().run(),
    },
    strikethrough: {
      title: translations.value.menu.strikethrough,
      icon: 'riStrikethrough',
      state: 'strike',
      run: () => props.editor.chain().focus().toggleStrike().run(),
    },
    inlineCode: {
      title: translations.value.menu.inlineCode,
      icon: 'riCodeLine',
      state: 'code',
      run: () => props.editor.chain().focus().toggleCode().run(),
    },
  }));

  const lists = computed(() => [
    {
      name: 'ol',
      title: translations.value.menu.orderedList,
      icon: 'riListOrdered',
      state: 'orderedList',
      run: () => props.editor.chain().focus().toggleOrderedList().run(),
    },
    {
      name: 'ul',
      title: translations.value.menu.bulletList,
      icon: 'riListUnordered',
      state: 'bulletList',
      run: () => props.editor.chain().focus().toggleBulletList().run(),
    },
    {
      name: 'cl',
      title: translations.value.menu.checkList,
      icon: 'riListCheck2',
      state: 'taskList',
      run: () => props.editor.chain().focus().toggleTaskList().run(),
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
      handler: () => props.editor.chain().focus().insertPaper().run(),
    },
  ]);

  const tableActions = computed(() => [
    {
      name: 'addRowAbove',
      label: translations.value.menu.addRowAbove || 'Add row above',
      icon: 'riInsertRowTop',
      run: () => props.editor.chain().focus().addRowBefore().run(),
    },
    {
      name: 'addRowBelow',
      label: translations.value.menu.addRowBelow || 'Add row below',
      icon: 'riInsertRowBottom',
      run: () => props.editor.chain().focus().addRowAfter().run(),
    },
    {
      name: 'deleteRow',
      label: translations.value.menu.deleteRow || 'Delete row',
      icon: 'riDeleteRow',
      run: () => props.editor.chain().focus().deleteRow().run(),
    },
    {
      name: 'addColumnLeft',
      label: translations.value.menu.addColumnLeft || 'Add column left',
      icon: 'riInsertColumnLeft',
      run: () => props.editor.chain().focus().addColumnBefore().run(),
    },
    {
      name: 'addColumnRight',
      label: translations.value.menu.addColumnRight || 'Add column right',
      icon: 'riInsertColumnRight',
      run: () => props.editor.chain().focus().addColumnAfter().run(),
    },
    {
      name: 'deleteColumn',
      label: translations.value.menu.deleteColumn || 'Delete column',
      icon: 'riDeleteColumn',
      run: () => props.editor.chain().focus().deleteColumn().run(),
    },
    {
      name: 'mergeOrSplit',
      label: translations.value.menu.mergeOrSplit || 'Merge / Split cells',
      icon: 'riSplitCellsHorizontal',
      run: () => props.editor.chain().focus().mergeOrSplit().run(),
    },
    {
      name: 'toggleHeader',
      label: translations.value.menu.toggleHeader || 'Toggle header cell',
      icon: 'riBrush2Fill',
      run: () => props.editor.chain().focus().toggleHeaderCell().run(),
    },
    {
      name: 'deleteTable',
      label: translations.value.menu.deleteTable || 'Delete table',
      icon: 'riDeleteBin6Line',
      run: () => props.editor.chain().focus().deleteTable().run(),
    },
  ]);

  const shareActions = computed(() => [
    {
      name: 'bea',
      title: translations.value.share?.exportNoteDialogTitle || 'BEA',
      icon: 'riFileTextFill',
      handler: isMobile
        ? () =>
            tryShareOrExport(shareBEA, () =>
              exportBEA(props.id, props.note?.title || '', props.editor)
            )
        : () => exportBEA(props.id, props.note?.title || '', props.editor),
    },
    {
      name: 'html',
      title: 'HTML',
      icon: 'riPagesLine',
      handler: isMobile
        ? () =>
            tryShareOrExport(shareHTML, () =>
              exportHTML(props.id, props.note?.title || '', props.editor)
            )
        : () => exportHTML(props.id, props.note?.title || '', props.editor),
    },
    {
      name: 'markdown',
      title: 'Markdown',
      icon: 'riMarkdownLine',
      handler: isMobile
        ? () =>
            tryShareOrExport(shareMD, () => exportMD(props.id, props.note?.title || '', props.editor))
        : () => exportMD(props.id, props.note?.title || '', props.editor),
    },
    {
      name: 'pdf',
      title: 'PDF',
      icon: 'riFile2Line',
      handler: () => handlePdfExport(),
    },
  ]);

  const currentTextColor = computed(() =>
    props.editor.isActive('textStyle')
      ? props.editor.getAttributes('textStyle')?.color || null
      : null
  );

  const currentHighlightClass = computed(() =>
    props.editor.isActive('highlight')
      ? props.editor.getAttributes('highlight')?.color || null
      : null
  );

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
        .updateAttributes('textStyle', { color: null })
        .run();
    } else {
      props.editor.commands.setColor(color);
    }
  }

  // --- useNoteMenuState inlined ---
  const fontSize = ref(16);
  const imgUrl = shallowRef('');
  const fileUrl = shallowRef('');
  const videoUrl = shallowRef('');
  const headingsTree = shallowRef([]);
  const showHeadingsTree = shallowRef(false);
  const container = ref();
  const store = reactive(uiState);

  function updateFontSize() {
    if (props.editor) {
      props.editor.chain().focus().setFontSize(`${fontSize.value}pt`).run();
    }
  }

  function getCurrentFontSize() {
    if (!props.editor) return null;
    const attrs = props.editor.getAttributes('textStyle');
    if (attrs.fontSize) return parseInt(attrs.fontSize, 10);
    const node = window.getSelection()?.anchorNode;
    if (!node) return null;
    const el = node.nodeType === 3 ? node.parentElement : node;
    const px = parseFloat(window.getComputedStyle(el).fontSize);
    return Math.round(px * (72 / 96));
  }

  function insertImage() {
    editorImage.set(normalizePath(imgUrl.value));
    imgUrl.value = '';
    props.editor.commands.focus();
  }

  function insertFile() {
    const url = normalizePath(fileUrl.value);
    props.editor.commands.setFileEmbed(url, url.substring(url.lastIndexOf('/') + 1));
    fileUrl.value = '';
  }

  function insertVideo() {
    props.editor.commands.setVideo(normalizePath(videoUrl.value));
    videoUrl.value = '';
  }

  async function handleFileSelect(event) {
    for (const file of event.target.files) {
      const { fileName, relativePath } = await saveFile(file, props.id);
      props.editor.commands.setFileEmbed(`${relativePath}`, fileName);
    }
  }

  async function handleAudioSelect(event) {
    for (const file of event.target.files) {
      const { fileName, relativePath } = await saveFile(file, props.id);
      props.editor.commands.setAudio(`${relativePath}`, fileName);
    }
  }

  async function handleVideoSelect(event) {
    for (const file of event.target.files) {
      const { relativePath } = await saveFile(file, props.id);
      props.editor.commands.setVideo(`${relativePath}`);
    }
  }

  function getHeadingsTree() {
    const el = props.editor.options.element;
    headingsTree.value = Array.from(el.querySelectorAll('h1,h2,h3,h4')).map(
      (heading) => {
        let pos = null;
        try {
          pos = props.editor.view.posAtDOM(heading, 0);
        } catch {
          pos = null;
        }
        return {
          el: heading,
          tag: heading.tagName,
          top: heading.offsetTop,
          text: heading.innerText.slice(0, 120),
          pos,
        };
      }
    );
  }

  function setZoom(level) {
    setStoredZoomLevel(level);
  }

  function toggleReaderMode() {
    setZoom(getStoredZoomLevel());
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
      cancelText: translations.value.dialog.cancel,
      onConfirm: async () => {
        await noteStore.delete(props.id);
        router.push('/');
      },
    });
  }

  function changeWheelDirection(event) {
    if (container.value) {
      container.value.scrollLeft += event.deltaY + event.deltaX;
    }
  }

  const handleSelectionUpdate = () => {
    const size = getCurrentFontSize();
    if (size) {
      fontSize.value = parseInt(size, 10);
    }
  };

  let _unregShortcuts;
  onMounted(() => {
    _unregShortcuts = bindGlobalShortcuts({
      'mod+alt+h': () => (showHeadingsTree.value = !showHeadingsTree.value),
      'mod+shift+d': deleteNode,
      'mod+shift+f': toggleReaderMode,
    });
  });
  onUnmounted(() => _unregShortcuts?.());

  function onKeydown(e) {
    if (e.key === 'Escape' && store.inReaderMode) {
      toggleReaderMode();
    }
  }

  onMounted(() => {
    if (props.editor) {
      props.editor.on('selectionUpdate', handleSelectionUpdate);
    }
    document.addEventListener('keydown', onKeydown);
  });

  onUnmounted(() => {
    props.editor?.off?.('selectionUpdate', handleSelectionUpdate);
    document.removeEventListener('keydown', onKeydown);
  });

  // --- Original computed properties ---
  const visibleItemIds = computed(
    () => new Set(visibleItems.value.map((item) => item.id))
  );
  const isItemVisible = (id) => visibleItemIds.value.has(id);
  const visibleInlineFormatItems = computed(() =>
    inlineFormatItems.filter((item) => isItemVisible(item.id))
  );
  const hasTextControls = computed(
    () =>
      isItemVisible('paragraph') ||
      isItemVisible('headings') ||
      isItemVisible('fontSize')
  );
  const hasFormattingControls = computed(
    () => visibleInlineFormatItems.value.length > 0 || isItemVisible('color')
  );
  const hasBlockControls = computed(
    () =>
      isItemVisible('lists') ||
      isItemVisible('blockquote') ||
      isItemVisible('codeBlock')
  );
  const hasMediaControls = computed(
    () =>
      isItemVisible('link') ||
      isItemVisible('image') ||
      isItemVisible('file') ||
      isItemVisible('video') ||
      isItemVisible('table') ||
      isItemVisible('draw')
  );
  const hasActionControls = computed(
    () =>
      isItemVisible('share') ||
      isItemVisible('readerMode') ||
      isItemVisible('delete')
  );

  return {
    store,
    translations,
    editorImage,
    visibleItems,
    showCustomizer,
    isRecording,
    formattedTime,
    toggleRecording,
    isPaused,
    pauseResume,
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
    tableActions,
    textColors,
    isItemVisible,
    visibleInlineFormatItems,
    hasTextControls,
    hasFormattingControls,
    hasBlockControls,
    hasMediaControls,
    hasActionControls,
    changeWheelDirection,
    container,
    deleteNode,
    fileUrl,
    fontSize,
    getHeadingsTree,
    handleAudioSelect,
    handleFileSelect,
    handleVideoSelect,
    headingsTree,
    imgUrl,
    insertFile,
    insertImage,
    insertVideo,
    showHeadingsTree,
    toggleReaderMode,
    updateFontSize,
    videoUrl,
  };
}
