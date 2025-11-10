<template>
  <NodeViewWrapper>
    <div>
      <div
        class="mt-2 mb-2 file-embed bg-neutral-100 dark:bg-[#353333] p-3 rounded-lg flex items-center justify-between"
      >
        <div class="flex items-center cursor-pointer">
          <v-remixicon name="riFile2Line" class="w-6 h-6 mr-2" />
          <span class="file-name truncate max-w-2/3">{{ fileName }}</span>
        </div>
        <div class="flex items-center gap-2">
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
import { ref, onMounted } from 'vue';
const { ipcRenderer } = window.electron;

export default {
  components: {
    NodeViewWrapper,
  },
  props: nodeViewProps,
  setup(props) {
    const fileName = ref(props.node.attrs.fileName || '');

    function normalizeSrc(src) {
      const [base] = src.split('?');
      return base;
    }

    function openDocument() {
      const src = encodeURI(normalizeSrc(props.node.attrs.src));
      ipcRenderer.callMain('open-file-external', src);
    }

    function refreshFileEmbed() {
      const baseSrc = props.node.attrs.src.split('?')[0];
      props.updateAttributes({
        src: `${baseSrc}?t=${Date.now()}`,
      });
    }

    onMounted(() => {
      ipcRenderer.answerMain('file-updated', ({ originalPath }) => {
        console.log('Got request from main', originalPath);
        refreshFileEmbed();
        return { status: 'ok' };
      });
    });

    function downloadFile(event) {
      event.stopPropagation();
      let src = normalizeSrc(props.node.attrs.src);
      src = encodeURI(src);
      const link = document.createElement('a');
      link.href = src;
      link.download = fileName.value;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    }

    return {
      fileName,
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
