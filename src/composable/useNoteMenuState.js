import { onMounted, onUnmounted, ref, shallowRef } from 'vue';
import { saveFile } from '@/utils/copy-doc';
import { getStoredZoomLevel, setStoredZoomLevel } from '@/composable/zoom';
import { useGlobalShortcuts } from '@/composable/useGlobalShortcuts';

function normalizePath(value) {
  return value.replace(/\\/g, '');
}

export function useNoteMenuState({
  editor,
  noteId,
  translations,
  noteStore,
  router,
  dialog,
  store,
  editorImage,
  printContent,
}) {
  const fontSize = ref(16);
  const imgUrl = shallowRef('');
  const fileUrl = shallowRef('');
  const videoUrl = shallowRef('');
  const headingsTree = shallowRef([]);
  const showHeadingsTree = shallowRef(false);
  const container = ref();

  function updateFontSize() {
    if (editor) {
      editor.chain().focus().setFontSize(`${fontSize.value}pt`).run();
    }
  }

  function getCurrentFontSize() {
    if (!editor) return null;
    const attrs = editor.getAttributes('textStyle');
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
    editor.commands.focus();
  }

  function insertFile() {
    const url = normalizePath(fileUrl.value);
    editor.commands.setFileEmbed(url, url.substring(url.lastIndexOf('/') + 1));
    fileUrl.value = '';
  }

  function insertVideo() {
    editor.commands.setVideo(normalizePath(videoUrl.value));
    videoUrl.value = '';
  }

  async function handleFileSelect(event) {
    for (const file of event.target.files) {
      const { fileName, relativePath } = await saveFile(file, noteId);
      editor.commands.setFileEmbed(`${relativePath}`, fileName);
    }
  }

  async function handleAudioSelect(event) {
    for (const file of event.target.files) {
      const { fileName, relativePath } = await saveFile(file, noteId);
      editor.commands.setAudio(`${relativePath}`, fileName);
    }
  }

  async function handleVideoSelect(event) {
    for (const file of event.target.files) {
      const { relativePath } = await saveFile(file, noteId);
      editor.commands.setVideo(`${relativePath}`);
    }
  }

  function getHeadingsTree() {
    const el = editor.options.element;
    headingsTree.value = Array.from(el.querySelectorAll('h1,h2,h3,h4')).map(
      (heading) => {
        let pos = null;
        try {
          pos = editor.view.posAtDOM(heading, 0);
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
      editor.commands.focus();
      editor.setOptions({ editable: false });
    } else {
      document.exitFullscreen();
      editor.setOptions({ editable: true });
    }
  }

  function deleteNode() {
    dialog.confirm({
      title: translations.value.card.confirmPrompt,
      okText: translations.value.card.confirm,
      cancelText: translations.value.card.cancel,
      onConfirm: async () => {
        await noteStore.delete(noteId);
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

  useGlobalShortcuts(() => ({
    'mod+alt+h': () => (showHeadingsTree.value = !showHeadingsTree.value),
    'mod+shift+d': deleteNode,
    'mod+shift+f': toggleReaderMode,
    'mod+p': printContent,
  }));

  onMounted(() => {
    if (editor) {
      editor.on('selectionUpdate', handleSelectionUpdate);
    }
  });

  onUnmounted(() => {
    editor?.off?.('selectionUpdate', handleSelectionUpdate);
  });

  return {
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
