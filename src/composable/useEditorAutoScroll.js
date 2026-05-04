import { debounce } from '@/utils/helper';

const AUTO_SCROLL_DEBOUNCE_MS = 50;

/**
 * Composable that provides an auto-scroll helper for the TipTap editor.
 * Keeps the cursor visible when typing at the bottom of a long note.
 */
export function useEditorAutoScroll(noteEditorRef) {
  const autoScroll = debounce(() => {
    if (!noteEditorRef.value) {
      return;
    }
    const lastChild =
      noteEditorRef.value.$el.querySelector('.ProseMirror').lastChild;
    if (
      !(
        document.body.scrollHeight >
        (window.innerHeight || document.documentElement.clientHeight)
      )
    ) {
      return;
    }
    const selection = window.getSelection();
    if (!lastChild.contains(selection.anchorNode)) {
      return;
    }
    const range = selection.getRangeAt(0);
    const rect = range.getBoundingClientRect();
    const lastRect = lastChild.getBoundingClientRect();

    const lineHeight = rect.height;

    const offset = Math.abs(rect.bottom - lastRect.bottom);
    if (lastRect.top + lastRect.height <= window.innerHeight) {
      return;
    }
    if (lineHeight === 0) {
      lastChild.scrollIntoView();
    } else if (offset < lineHeight) {
      lastChild.scrollIntoView();
    }
  }, AUTO_SCROLL_DEBOUNCE_MS);

  return { autoScroll };
}
