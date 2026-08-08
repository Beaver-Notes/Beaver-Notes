<template>
  <NodeViewWrapper>
    <div>
      <div
        class="mt-2 mb-2 file-embed bg-neutral-100 dark:bg-neutral-800 p-3 rounded-lg flex items-center justify-between"
      >
        <div class="flex items-center">
          <v-remixicon name="riFile2Line" class="w-6 h-6 mr-2" />
          <span class="file-name truncate max-w-2/3">{{ fileName }}</span>
        </div>
        <div
          v-if="missing"
          class="flex items-center gap-1 text-sm text-amber-600 dark:text-amber-400"
        >
          <v-remixicon name="riAlertLine" class="w-4 h-4" />
          <span>{{ translations.editor.fileNotFound || 'File not found' }}</span>
        </div>
        <div v-else class="flex items-center gap-2">
          <button
            class="bg-input p-1 px-3 rounded-lg outline-none"
            @click="downloadFile"
          >
            <v-remixicon name="riDownloadLine" class="w-6 h-6" />
          </button>
          <button
            class="bg-input p-1 px-3 rounded-lg outline-none"
            @click="openDocument"
          >
            <v-remixicon name="riEyeLine" class="w-6 h-6" />
          </button>
        </div>
      </div>
    </div>
  </NodeViewWrapper>
</template>

<script>
import { NodeViewWrapper, nodeViewProps } from '@tiptap/vue-3';
import { ref, onMounted, onUnmounted } from 'vue';
import { backend } from '@/lib/tauri-bridge';
import { isMobileRuntime } from '@/lib/tauri/runtime';
import { openFileExternal, getAppDirectory } from '@/lib/native/app';
import { saveDialog } from '@/lib/native/dialog';
import { readData, writeFile, pathExists } from '@/lib/native/fs';
import { shareFileViaNative } from '@/lib/native/share';
import { base64ToUint8Array } from '@/utils/helpers/index.js';
import { useTranslations } from '@/composable/useTranslations';

export default {
  components: {
    NodeViewWrapper,
  },
  props: nodeViewProps,
  setup(props) {
    const { translations } = useTranslations();
    const fileName = ref(props.node.attrs.fileName || '');
    const missing = ref(false);

    function normalizeSrc(src) {
      const [base] = src.split('?');
      return base;
    }

    async function resolveFilePath(src) {
      const normalized = normalizeSrc(src);
      const match = normalized.match(/^(?:assets|file-assets):\/\/([^/]+)\/(.+)$/);
      if (!match) return null;
      const [, noteId, rest] = match;
      const appDir = await getAppDirectory();
      let decoded = rest;
      try {
        decoded = decodeURIComponent(rest);
      } catch {}
      return `${appDir}/assets/${noteId}/${decoded}`;
    }

    async function checkFileExists() {
      try {
        const src = String(props.node.attrs.src || '');
        if (!src.startsWith('assets://') && !src.startsWith('file-assets://')) {
          missing.value = false;
          return;
        }
        const filePath = await resolveFilePath(src);
        missing.value = filePath ? !(await pathExists(filePath)) : true;
      } catch (error) {
        missing.value = true;
      }
    }

    async function openDocument() {
      if (missing.value) return;
      try {
        const src = encodeURI(normalizeSrc(props.node.attrs.src));
        if (isMobileRuntime()) {
          const appDir = await getAppDirectory();
          const normalized = normalizeSrc(props.node.attrs.src);
          const match = normalized.match(/^(?:assets|file-assets):\/\/([^/]+)\/(.+)$/);
          if (match) {
            const [, noteId, rest] = match;
            let decoded = rest;
            try { decoded = decodeURIComponent(rest); } catch {}
            const filePath = `${appDir}/assets/${noteId}/${decoded}`;
            await shareFileViaNative(filePath);
          }
        } else {
          await openFileExternal(src);
        }
      } catch (error) {
        console.error('[FileEmbed] Failed to open document:', error);
      }
    }

    function refreshFileEmbed() {
      const baseSrc = props.node.attrs.src.split('?')[0];
      props.updateAttributes({
        src: `${baseSrc}?t=${Date.now()}`,
      });
    }

    let unlistenFileUpdated = null;
    onMounted(() => {
      checkFileExists();
      backend
        .listenPayload('file-updated', () => {
          refreshFileEmbed();
          checkFileExists();
          return { status: 'ok' };
        })
        .then((unlisten) => {
          unlistenFileUpdated = unlisten;
        });
    });

    onUnmounted(() => {
      if (typeof unlistenFileUpdated === 'function') unlistenFileUpdated();
    });

    async function downloadFile(event) {
      if (missing.value) return;
      event.stopPropagation();
      try {
        const src = encodeURI(normalizeSrc(props.node.attrs.src));
        const { canceled, filePath } = await saveDialog({
          defaultPath: fileName.value,
        });
        if (canceled || !filePath) return;

        const base64 = await readData(src);
        if (!base64) return;

        await writeFile(filePath, base64ToUint8Array(base64));
      } catch (error) {
        console.error('[FileEmbed] Failed to download file:', error);
      }
    }

    return {
      fileName,
      missing,
      translations,
      openDocument,
      downloadFile,
    };
  },
};
</script>

<style lang="css">
.file-name {
  display: inline-block;
  max-width: 200px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
</style>
