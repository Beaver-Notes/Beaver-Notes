import { ref } from 'vue';

const DEFAULT_MERGE_BANNER_MS = 12000;

/**
 * Shared state for the "Review changes" experience (plan §6): the note page,
 * editor and history panel all read `active`/`label` and the merge-banner flag
 * from here. Cross-route state is not needed, so this stays out of Pinia.
 *
 * The inline diff/chunk widgets and the actual revert transaction live in the
 * version-preview extension; this composable only owns entry/exit and the
 * banner trigger so the editor binding stays in one place.
 */
export function useChangeReview({ mergeBannerMs = DEFAULT_MERGE_BANNER_MS } = {}) {
  const active = ref(false);
  const label = ref('');
  const mergeBannerVisible = ref(false);
  let restoreEditable = null;
  let bannerTimer = null;

  function clearBannerTimer() {
    if (bannerTimer) {
      clearTimeout(bannerTimer);
      bannerTimer = null;
    }
  }

  function dismissMergeBanner() {
    clearBannerTimer();
    mergeBannerVisible.value = false;
  }

  function start(editor, { content, label: nextLabel = '', meta = {} } = {}) {
    if (!editor || typeof content !== 'string' || !content) return false;
    if (!active.value) restoreEditable = editor.isEditable;
    if (editor.commands?.setChangeReview?.(content, { ...meta, label: nextLabel }) === false) {
      return false;
    }
    editor.setEditable(false, false);
    active.value = true;
    label.value = nextLabel;
    dismissMergeBanner();
    return true;
  }

  function exit(editor) {
    if (!active.value) return;
    active.value = false;
    label.value = '';
    try {
      editor?.commands?.clearChangeReview?.();
    } catch {
      // Editor already torn down (note switch): nothing to clear.
    }
    try {
      if (editor && restoreEditable != null) {
        editor.setEditable(restoreEditable, false);
      }
    } catch {
      // Destroyed editor: the doc is gone, nothing to restore.
    }
    restoreEditable = null;
  }

  function handleRemoteApplied(noteId, currentNoteId) {
    if (active.value || !currentNoteId || noteId !== currentNoteId) return false;
    clearBannerTimer();
    mergeBannerVisible.value = true;
    bannerTimer = setTimeout(() => {
      mergeBannerVisible.value = false;
      bannerTimer = null;
    }, mergeBannerMs);
    return true;
  }

  return {
    active,
    label,
    mergeBannerVisible,
    start,
    exit,
    handleRemoteApplied,
    dismissMergeBanner,
  };
}
