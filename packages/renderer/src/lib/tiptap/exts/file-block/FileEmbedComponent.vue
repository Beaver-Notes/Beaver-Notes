<template>
  <NodeViewWrapper>
    <div>
      <div
        class="mt-2 mb-2 file-embed bg-neutral-100 dark:bg-[#353333] p-3 rounded-lg flex items-center justify-between"
      >
        <div class="flex items-center cursor-pointer" @click="openDocument">
          <v-remixicon name="riFile2Line" class="w-6 h-6 mr-2" />
          <span>{{ truncatedFileName }}</span>
        </div>
        <button
          class="download-button bg-input p-1 px-3 rounded-lg outline-none"
          @click="downloadFile"
        >
          <v-remixicon name="riDownloadLine" class="w-6 h-6" />
        </button>
      </div>
    </div>
  </NodeViewWrapper>
</template>

<script>
import { NodeViewWrapper, nodeViewProps } from '@tiptap/vue-3';
import { ref, computed } from 'vue';
const { ipcRenderer } = window.electron;

export default {
  components: {
    NodeViewWrapper,
  },
  props: nodeViewProps,
  setup(props) {
    const fileName = ref(props.node.attrs.fileName || '');

    // Truncate the file name
    const truncatedFileName = computed(() => {
      const maxLength = 20; // Maximum characters to display
      if (fileName.value.length > maxLength) {
        return `${fileName.value.slice(0, maxLength)}...`;
      }
      return fileName.value;
    });

    function normalizeSrc(src) {
      if (src.startsWith('file-assets://')) {
        return src.replace('file-assets://', 'file-assets/');
      }
      return src;
    }

    function openDocument() {
      let src = props.node.attrs.src;
      src = normalizeSrc(src);
      ipcRenderer.callMain('open-file-external', src);
    }

    function downloadFile(event) {
      event.stopPropagation();
      let src = props.node.attrs.src;
      src = normalizeSrc(src);
      const link = document.createElement('a');
      link.href = src;
      link.download = fileName.value;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    }

    return {
      fileName,
      truncatedFileName,
      openDocument,
      downloadFile,
    };
  },
};
</script>
