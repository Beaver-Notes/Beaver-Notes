import { computed, ref, shallowReactive } from 'vue';
import {
  importObsidian,
  importNotion,
  importBear,
  importSimplenote,
  importGenericMarkdown,
  startRustImport,
} from '@/utils/import/bulkImport';
import { openDialog } from '@/lib/native/dialog';
import { getAppDirectory } from '@/lib/native/app';
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

export function useImport({
  storage: _storage,
  noteStore,
  folderStore,
  clipboard,
  isMacOS,
}) {
  const importState = shallowReactive({
    obsidian: createProgressState(),
    notion: createProgressState(),
    bear: createProgressState(),
    evernote: createProgressState({ notebookName: '' }),
    appleNotes: createProgressState(),
    simplenote: createProgressState(),
    genericMd: createProgressState(),
  });
  const showImportModal = ref(false);
  const selectedImportSource = ref('obsidian');

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

  async function importDirectorySource(key, title, importer, options = {}) {
    const filePaths = await pickDialogPaths({
      title,
      properties: ['openDirectory'],
      useScopedStorage: true,
    });
    if (!filePaths) return;
    const appDirectory = await getAppDirectory();
    return runImport(
      key,
      (onProgress) => importer(filePaths[0], appDirectory, onProgress),
      options
    );
  }

  async function importObsidianHandler(options = {}) {
    return importDirectorySource(
      'obsidian',
      t?.settings?.selectObsidianVault || 'Select Obsidian Vault',
      (path, appDir, onProgress) =>
        importObsidian(path, noteStore, folderStore, appDir, onProgress),
      options
    );
  }

  async function importNotionHandler(options = {}) {
    return importDirectorySource(
      'notion',
      t?.settings?.selectNotionExport || 'Select Notion Export',
      (path, appDir, onProgress) =>
        importNotion(path, noteStore, folderStore, appDir, onProgress),
      options
    );
  }

  async function importBearHandler(options = {}) {
    return importDirectorySource(
      'bear',
      t?.settings?.selectBearExport || 'Select Bear Export',
      (path, appDir, onProgress) =>
        importBear(path, noteStore, folderStore, appDir, onProgress),
      options
    );
  }

  async function importEvernoteHandler(options = {}) {
    const { notebookName } = options;
    const filePaths = await pickDialogPaths({
      title: t?.settings?.selectEnexFile || 'Select ENEX File',
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
      title: t?.settings?.selectSimplenoteExport || 'Select notes.json',
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
    return importDirectorySource(
      'genericMd',
      t?.settings?.selectMarkdownFolder || 'Select Markdown Folder',
      (path, appDir, onProgress) =>
        importGenericMarkdown(path, noteStore, folderStore, appDir, onProgress),
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
    openImportModal,
    runImportSource,
    runImport,
    selectImportSource,
    selectedImportSource,
    showImportModal,
    startSelectedImport,
  };
}
