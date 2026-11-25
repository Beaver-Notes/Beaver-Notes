/**
 * useInkInput.js — scribble policy for ink input (REDESIGN phase D).
 *
 * The fix for the "cannot differentiate" Scribble bug: suppression is scoped
 * to a single in-flight stroke via `setScribbleSuppressed('ink:'+id, …)`,
 * only while that stroke is active — never a focus-based global toggle.
 *
 * - beginStroke(id) suppresses scribble for `ink:id` (blocked while finding).
 * - endStroke(id) clears only if `id` owns the active stroke (stale ends from
 *   a different stroke cannot clear another's suppression).
 * - strokeActive drives the chrome lock (A7) via a store flag.
 * - cleanup() always clears what it set (unmount safety).
 */
import { computed, ref } from 'vue';
import {
  clearScribbleSuppressed,
  setScribbleSuppressed,
} from '@/lib/native/scribble';

export function useInkInput({ isFinding } = {}) {
  const finding = isFinding ?? ref(false);
  const activeId = ref(null);
  let owner = null;

  const strokeActive = computed(() => activeId.value !== null);

  /** Begin a stroke: suppress scribble for `ink:id`. Returns false if blocked. */
  function beginStroke(id) {
    if (!id) return false;
    if (finding.value) return false; // A8: find mode suppresses pencil gestures
    activeId.value = id;
    owner = id;
    setScribbleSuppressed(`ink:${id}`, true);
    return true;
  }

  /** End a stroke: clears suppression only if `id` owns the active stroke. */
  function endStroke(id) {
    if (!id) return false;
    if (id !== activeId.value || owner !== id) return false; // stale — don't touch another's
    clearScribbleSuppressed(`ink:${id}`);
    activeId.value = null;
    owner = null;
    return true;
  }

  /** Forced cleanup (unmount / cancel). Clears whatever this instance set. */
  function cleanup() {
    if (owner) clearScribbleSuppressed(`ink:${owner}`);
    activeId.value = null;
    owner = null;
  }

  return { beginStroke, endStroke, cleanup, strokeActive, finding };
}
