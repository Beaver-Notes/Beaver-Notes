/**
 * usePaperBlockBus.js
 *
 * Singleton reactive bus that lets the currently-focused paper block
 * expose its controls to NoteMenu / NoteMenuMobile without prop-drilling
 * or Tiptap-level hacks.
 *
 * Usage:
 *   Paper.vue  → registers itself via `registerPaperBlock(api)` when editing
 *                and calls `unregisterPaperBlock()` on unmount / editing ends
 *   NoteMenu   → reads `activePaperBlock` (null when no paper block is active)
 */

import { ref } from 'vue';

// Module-level singleton — survives across component lifecycles
const activePaperBlock = ref(null);

export function usePaperBlockBus() {
  /**
   * Called by Paper.vue when a block enters edit mode.
   * @param {Object} api  - { drawModeRef, toolbarState, setTool, setColor, setSize,
   *                          setBackground, deleteSelection, exportSVG,
   *                          presets, applyPreset, savePreset, onColorInput,
   *                          activePresets, currentToolColor, currentToolSize,
   *                          sizeMin, sizeMax, paperTypes }
   */
  function registerPaperBlock(api) {
    activePaperBlock.value = api;
  }

  /** Called by Paper.vue when editing ends or the component unmounts. */
  function unregisterPaperBlock(api) {
    // Only clear if we're still the registered block (guard against races)
    if (activePaperBlock.value === api) {
      activePaperBlock.value = null;
    }
  }

  return { activePaperBlock, registerPaperBlock, unregisterPaperBlock };
}
