import { shallowReactive } from 'vue';
import { exportAllMarkdown, exportAllHTML } from '@/utils/share/exportBulk';

function createProgressState(extra = {}) {
  return shallowReactive({
    running: false,
    done: 0,
    total: 0,
    result: null,
    ...extra,
  });
}

export function useExport() {
  const exportMdState = createProgressState();
  const exportHtmlState = createProgressState();

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

  return {
    exportMdState,
    exportHtmlState,
    exportAllMarkdownHandler,
    exportAllHTMLHandler,
  };
}
