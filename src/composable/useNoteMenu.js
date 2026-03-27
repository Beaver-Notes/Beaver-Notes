import { computed, ref } from 'vue';
import { useRouter } from 'vue-router';
import useAudioRecorder from '@/utils/record';
import { useGroupTooltip } from '@/composable/groupTooltip';
import { useStore } from '@/store';
import { useNoteStore } from '@/store/note';
import { useEditorImage } from '@/composable/editorImage';
import { useDialog } from '@/composable/dialog';
import { useStorage } from '@/composable/storage';
import { useTranslations } from '@/composable/useTranslations';
import { useToolbarConfig } from '@/composable/useToolbarConfig';
import { useNoteMenuActions } from '@/composable/useNoteMenuActions';
import { useNoteMenuState } from '@/composable/useNoteMenuState';
import { backend, path } from '@/lib/tauri-bridge';

const storage = useStorage('settings');

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

  const store = useStore();
  const noteStore = useNoteStore();
  const router = useRouter();
  const dialog = useDialog();
  const editorImage = useEditorImage(props.editor);
  useGroupTooltip();

  const {
    currentTextColor,
    fmtMap,
    highlighterColors,
    isTableActive,
    lists,
    printContent,
    setHighlightColor,
    setTextColor,
    shareActions,
    tableActions,
    textColors,
  } = useNoteMenuActions({
    editor: props.editor,
    noteId: props.id,
    noteTitle: props.note.title,
    translations,
    backend,
  });

  const noteMenuState = useNoteMenuState({
    dialog,
    editor: props.editor,
    editorImage,
    noteId: props.id,
    noteStore,
    printContent,
    router,
    store,
    translations,
  });

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
      isItemVisible('draw-block')
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
    fmtMap,
    highlighterColors,
    isTableActive,
    lists,
    printContent,
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
    ...noteMenuState,
  };
}
