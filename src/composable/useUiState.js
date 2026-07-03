import { reactive, ref } from 'vue';

const inReaderMode = ref(false);
const showPrompt = ref(false);
const overlayCount = ref(0);

function openOverlay() {
  overlayCount.value++;
}

function closeOverlay() {
  overlayCount.value = Math.max(0, overlayCount.value - 1);
}

const state = reactive({ inReaderMode, showPrompt, overlayCount, openOverlay, closeOverlay });

export function useUiState() {
  return state;
}
