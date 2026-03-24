import { computed, ref, shallowReactive } from 'vue';
import { exportAllMarkdown, exportAllHTML } from '@/utils/share/ExportBulk';
import {
  importObsidian,
  importNotion,
  importBear,
  importSimplenote,
  importGenericMarkdown,
  importWordDocuments,
} from '@/utils/import/importers';
import { startRustImport } from '@/utils/import/importRustBridge';
import { openDialog } from '@/lib/native/dialog';
import { importAppleNotes, importEvernote } from '@/lib/native/imports';

function createProgressState(extra = {}) {
  return shallowReactive({
    running: false,
    done: 0,
    total: 0,
    result: null,
    ...extra,
  });
}

export function useImportExport({
  storage,
  noteStore,
  folderStore,
  clipboard,
  isMacOS,
}) {
  const exportMdState = createProgressState();
  const exportHtmlState = createProgressState();
  const importState = shallowReactive({
    obsidian: createProgressState(),
    notion: createProgressState(),
    bear: createProgressState(),
    evernote: createProgressState({ notebookName: '' }),
    appleNotes: createProgressState(),
    simplenote: createProgressState(),
    word: createProgressState(),
    genericMd: createProgressState(),
  });
  const showImportModal = ref(false);
  const selectedImportSource = ref('obsidian');

  async function runBulkExport(exportState, exporter) {
    if (exportState.running) return;

    const previousState = {
      done: exportState.done,
      total: exportState.total,
      result: exportState.result,
    };

    exportState.running = true;
    exportState.result = null;
    exportState.done = 0;
    exportState.total = 0;

    try {
      const result = await exporter(({ done, total }) => {
        exportState.done = done;
        exportState.total = total;
      });

      if (result === null) {
        exportState.done = previousState.done;
        exportState.total = previousState.total;
        exportState.result = previousState.result;
        return;
      }

      exportState.result = result;
    } finally {
      exportState.running = false;
    }
  }

  async function exportAllMarkdownHandler() {
    await runBulkExport(exportMdState, exportAllMarkdown);
  }

  async function exportAllHTMLHandler() {
    await runBulkExport(exportHtmlState, exportAllHTML);
  }

  async function runImport(key, fn, options = {}) {
    if (importState[key].running) return;

    const state = importState[key];
    const { onProgress } = options;
    state.running = true;
    state.result = null;
    state.done = 0;
    state.total = 0;

    try {
      const result = await fn(({ done = 0, total = 0, current = '' }) => {
        state.done = done;
        state.total = total;
        onProgress?.({ done, total, current });
      });
      state.result = result;
      return result;
    } finally {
      state.running = false;
    }
  }

  async function pickDialogPaths(props) {
    const { canceled, filePaths = [] } = await openDialog(props);
    if (canceled || !filePaths.length) return null;
    return filePaths;
  }

  function getImportIssuesText(key) {
    const issues = importState[key]?.result?.errors || [];
    return issues
      .map(
        (issue) =>
          `${issue.title || 'Untitled'}: ${issue.reason || 'Unknown error'}`
      )
      .join('\n');
  }

  async function copyImportIssues(key) {
    const text = getImportIssuesText(key);
    if (!text) return;
    await clipboard.writeText(text);
  }

  async function importObsidianHandler(options = {}) {
    const filePaths = await pickDialogPaths({
      title: 'Select Obsidian Vault',
      properties: ['openDirectory'],
      useScopedStorage: true,
    });
    if (!filePaths) return;
    const dataDir = await storage.get('dataDir', '');
    return runImport(
      'obsidian',
      (onProgress) =>
        importObsidian(
          filePaths[0],
          noteStore,
          folderStore,
          dataDir,
          onProgress
        ),
      options
    );
  }

  async function importNotionHandler(options = {}) {
    const filePaths = await pickDialogPaths({
      title: 'Select Notion Export',
      properties: ['openDirectory'],
      useScopedStorage: true,
    });
    if (!filePaths) return;
    const dataDir = await storage.get('dataDir', '');
    return runImport(
      'notion',
      (onProgress) =>
        importNotion(filePaths[0], noteStore, folderStore, dataDir, onProgress),
      options
    );
  }

  async function importBearHandler(options = {}) {
    const filePaths = await pickDialogPaths({
      title: 'Select Bear Export',
      properties: ['openDirectory'],
      useScopedStorage: true,
    });
    if (!filePaths) return;
    const dataDir = await storage.get('dataDir', '');
    return runImport(
      'bear',
      (onProgress) =>
        importBear(filePaths[0], noteStore, folderStore, dataDir, onProgress),
      options
    );
  }

  async function importEvernoteHandler(options = {}) {
    const { notebookName } = options;
    const filePaths = await pickDialogPaths({
      title: 'Select ENEX File',
      properties: ['openFile'],
      filters: [{ name: 'Evernote ENEX', extensions: ['enex'] }],
    });
    if (!filePaths) return;

    return runImport(
      'evernote',
      async (onProgress) => {
        const pending = startRustImport('evernote', onProgress);
        const resolvedNotebookName =
          notebookName ?? (importState.evernote.notebookName?.trim() || null);
        await importEvernote({
          enexPath: filePaths[0],
          enex_path: filePaths[0],
          notebookName: resolvedNotebookName,
          notebook_name: resolvedNotebookName,
        });
        return pending;
      },
      options
    );
  }

  async function importAppleNotesHandler(options = {}) {
    return runImport(
      'appleNotes',
      async (onProgress) => {
        const pending = startRustImport('apple-notes', onProgress);
        await importAppleNotes();
        return pending;
      },
      options
    );
  }

  async function importSimplenoteHandler(options = {}) {
    const filePaths = await pickDialogPaths({
      title: 'Select notes.json',
      properties: ['openFile'],
      filters: [{ name: 'Simplenote JSON', extensions: ['json'] }],
    });
    if (!filePaths) return;
    return runImport(
      'simplenote',
      (onProgress) => importSimplenote(filePaths[0], noteStore, onProgress),
      options
    );
  }

  async function importGenericMarkdownHandler(options = {}) {
    const filePaths = await pickDialogPaths({
      title: 'Select Markdown Folder',
      properties: ['openDirectory'],
      useScopedStorage: true,
    });
    if (!filePaths) return;
    const dataDir = await storage.get('dataDir', '');
    return runImport(
      'genericMd',
      (onProgress) =>
        importGenericMarkdown(
          filePaths[0],
          noteStore,
          folderStore,
          dataDir,
          onProgress
        ),
      options
    );
  }

  async function importWordHandler(options = {}) {
    const filePaths = await pickDialogPaths({
      title: 'Select Word Documents',
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'Word Document', extensions: ['docx'] }],
    });
    if (!filePaths) return;
    const dataDir = await storage.get('dataDir', '');
    return runImport(
      'word',
      (onProgress) =>
        importWordDocuments(
          filePaths,
          noteStore,
          folderStore,
          dataDir,
          onProgress
        ),
      options
    );
  }

  async function runImportSource(key, options = {}) {
    switch (key) {
      case 'obsidian':
        return importObsidianHandler(options);
      case 'notion':
        return importNotionHandler(options);
      case 'bear':
        return importBearHandler(options);
      case 'evernote':
        return importEvernoteHandler(options);
      case 'appleNotes':
        return importAppleNotesHandler(options);
      case 'simplenote':
        return importSimplenoteHandler(options);
      case 'word':
        return importWordHandler(options);
      case 'genericMd':
        return importGenericMarkdownHandler(options);
      default:
        return null;
    }
  }

  const importSourceGroups = computed(() => {
    const groups = [
      {
        label: 'Markdown-based',
        items: [
          {
            key: 'obsidian',
            title: 'Obsidian',
            icon: 'obsidian',
            group: 'Markdown',
            description:
              'Point Beaver Notes at your Obsidian vault folder. Your folder structure and notes will be imported as-is.',
            buttonLabel: 'Select Vault Folder',
          },
          {
            key: 'notion',
            title: 'Notion',
            icon: 'riNotionFill',
            group: 'Markdown',
            description:
              'In Notion, go to Settings -> Export content -> Markdown & CSV. Download and unzip the export, then select the unzipped folder.',
            buttonLabel: 'Select Notion Export',
          },
          {
            key: 'bear',
            title: 'Bear',
            icon: 'bear',
            group: 'Markdown',
            description:
              'In Bear, go to File -> Export Notes -> Markdown. Select the exported folder below.',
            buttonLabel: 'Select Bear Export',
          },
          {
            key: 'genericMd',
            title: 'Markdown Folder',
            icon: 'riMarkdownLine',
            group: 'Markdown',
            description:
              'Import any folder of .md files. Subfolders become Beaver Notes folders.',
            buttonLabel: 'Select Folder',
          },
        ],
      },
      {
        label: 'Direct import',
        items: [
          {
            key: 'simplenote',
            title: 'Simplenote',
            icon: 'simpleNote',
            group: 'Direct',
            description:
              'In Simplenote, go to Settings -> Export and download notes.json. Select the file below.',
            buttonLabel: 'Select notes.json',
          },
          {
            key: 'word',
            title: 'Word',
            icon: 'riFileWord2Line',
            group: 'Direct',
            description:
              'Select one or more .docx files. Beaver Notes will import document text, links, tables, and embedded images.',
            buttonLabel: 'Select .docx files',
          },
          {
            key: 'evernote',
            title: 'Evernote',
            icon: 'riEvernoteFill',
            group: 'Direct',
            description:
              'In Evernote, right-click a notebook and choose Export Notes. Save as .enex format. You can optionally enter the notebook name to create a matching folder.',
            buttonLabel: 'Select ENEX File',
          },
        ],
      },
    ];

    if (isMacOS.value) {
      groups[1].items.push({
        key: 'appleNotes',
        title: 'Apple Notes',
        icon: 'riAppleFill',
        group: 'Direct',
        description:
          "Beaver Notes will read your notes directly from Apple Notes. You'll see a permission prompt - click OK to allow access.",
        buttonLabel: 'Import from Apple Notes',
      });
    }

    return groups;
  });

  const importSourceMap = computed(() =>
    importSourceGroups.value.reduce((acc, group) => {
      group.items.forEach((item) => {
        acc[item.key] = item;
      });
      return acc;
    }, {})
  );

  const importSources = computed(() =>
    importSourceGroups.value.flatMap((group) => group.items)
  );

  const activeImportSource = computed(
    () => importSourceMap.value[selectedImportSource.value] || null
  );
  const activeImportState = computed(
    () => importState[selectedImportSource.value] || importState.obsidian
  );
  const activeImportIssuesText = computed(() =>
    getImportIssuesText(selectedImportSource.value)
  );

  function openImportModal(key = selectedImportSource.value) {
    if (importSourceMap.value[key]) {
      selectedImportSource.value = key;
    }
    showImportModal.value = true;
  }

  function selectImportSource(key) {
    if (!importSourceMap.value[key]) return;
    selectedImportSource.value = key;
  }

  async function startSelectedImport() {
    await runImportSource(selectedImportSource.value);
  }

  return {
    activeImportIssuesText,
    activeImportSource,
    activeImportState,
    copyImportIssues,
    exportAllHTMLHandler,
    exportAllMarkdownHandler,
    exportHtmlState,
    exportMdState,
    getImportIssuesText,
    importAppleNotesHandler,
    importBearHandler,
    importEvernoteHandler,
    importGenericMarkdownHandler,
    importNotionHandler,
    importObsidianHandler,
    importSimplenoteHandler,
    importSourceGroups,
    importSources,
    importState,
    importWordHandler,
    openImportModal,
    runImportSource,
    runImport,
    selectImportSource,
    selectedImportSource,
    showImportModal,
    startSelectedImport,
  };
}
