<template>
  <NodeViewWrapper>
    <div>
      <div
        class="bg-neutral-50 dark:bg-neutral-900 border p-3 rounded-xl flex items-center gap-3"
      >
        <div
          class="w-12 h-12 shrink-0 rounded-lg overflow-hidden flex items-center justify-center"
        >
          <img
            v-if="iconUrl"
            :src="iconUrl"
            alt=""
            class="w-full h-full object-contain"
          />
          <v-remixicon
            v-else
            :name="fallbackIcon"
            class="w-6 h-6 text-neutral-500 dark:text-neutral-400"
          />
        </div>
        <div class="flex-1 min-w-0">
          <div class="text-sm font-medium">{{ fileName }}</div>
          <div class="flex flex-row gap-2">
            <div
              class="text-xs text-neutral-500 dark:text-neutral-400 truncate"
            >
              {{ fileKind }}
            </div>
            <div
              v-if="fileSize"
              class="text-xs text-neutral-400 dark:text-neutral-500"
            >
              {{ fileSize }}
            </div>
          </div>
        </div>
        <div
          v-if="missing"
          class="flex items-center gap-1 text-sm text-amber-600 dark:text-amber-400"
        >
          <v-remixicon name="riErrorWarningLine" class="w-4 h-4" />
          <span>{{
            translations.editor.fileNotFound || 'File not found'
          }}</span>
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
import { ref, onMounted, onUnmounted, watch } from 'vue';
import { backend } from '@/lib/tauri-bridge';
import { isMobileRuntime } from '@/lib/tauri/runtime';
import { openFileExternal, getAppDirectory } from '@/lib/native/app';
import { saveDialog } from '@/lib/native/dialog';
import {
  readData,
  writeFile,
  pathExists,
  stat,
  getFileIcon,
} from '@/lib/native/fs';
import { shareFileViaNative } from '@/lib/native/share';
import { base64ToUint8Array } from '@/utils/helpers/index.js';
import { useTranslations } from '@/composable/useTranslations';

import { kindFor, iconFor } from '@/utils/fileKind.js';

function formatSize(bytes) {
  if (!Number.isFinite(bytes)) return '';
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${unit === 0 ? Math.round(value) : value.toFixed(1)} ${units[unit]}`;
}

export default {
  components: {
    NodeViewWrapper,
  },
  props: nodeViewProps,
  setup(props) {
    const { translations } = useTranslations();
    const fileName = ref(props.node.attrs.fileName || '');
    const missing = ref(false);
    const fileSize = ref('');
    const iconUrl = ref('');
    const fileKind = ref(kindFor(fileName.value));
    const fallbackIcon = iconFor(fileName.value);

    function normalizeSrc(src) {
      const [base] = src.split('?');
      return base;
    }

    async function resolveFilePath(src) {
      const normalized = normalizeSrc(src);
      const match = normalized.match(
        /^(?:assets|file-assets):\/\/([^/]+)\/(.+)$/,
      );
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

    async function loadFileMeta() {
      try {
        const src = String(props.node.attrs.src || '');
        if (!src.startsWith('assets://') && !src.startsWith('file-assets://')) {
          return;
        }
        const filePath = await resolveFilePath(src);
        if (!filePath) return;
        try {
          const info = await stat(filePath);
          if (info && typeof info.size === 'number') {
            fileSize.value = formatSize(info.size);
          }
        } catch {}
        if (isMobileRuntime()) return;
        try {
          const base64 = await getFileIcon(filePath, 96);
          if (base64) iconUrl.value = `data:image/png;base64,${base64}`;
        } catch {}
      } catch {}
    }

    async function openDocument() {
      if (missing.value) return;
      try {
        const src = encodeURI(normalizeSrc(props.node.attrs.src));
        if (isMobileRuntime()) {
          const appDir = await getAppDirectory();
          const normalized = normalizeSrc(props.node.attrs.src);
          const match = normalized.match(
            /^(?:assets|file-assets):\/\/([^/]+)\/(.+)$/,
          );
          if (match) {
            const [, noteId, rest] = match;
            let decoded = rest;
            try {
              decoded = decodeURIComponent(rest);
            } catch {}
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
      loadFileMeta();
      backend
        .listenPayload('file-updated', () => {
          refreshFileEmbed();
          checkFileExists();
          loadFileMeta();
          return { status: 'ok' };
        })
        .then((unlisten) => {
          unlistenFileUpdated = unlisten;
        });
    });

    onUnmounted(() => {
      if (typeof unlistenFileUpdated === 'function') unlistenFileUpdated();
    });

    // Background-saved assets swap src after insert; re-resolve existence,
    // size and icon once the final assets:// URL lands.
    watch(
      () => props.node.attrs.src,
      (src) => {
        if (src && src.startsWith('assets://')) {
          checkFileExists();
          loadFileMeta();
        }
      },
    );

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
      fileKind,
      fileSize,
      iconUrl,
      fallbackIcon,
      missing,
      translations,
      openDocument,
      downloadFile,
    };
  },
};
</script>
