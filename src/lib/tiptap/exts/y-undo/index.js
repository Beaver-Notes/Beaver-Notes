import { Extension } from '@tiptap/core';
import * as Y from 'yjs';
import { ySyncPluginKey } from '@tiptap/y-tiptap';

// Yjs-mode undo. Collaboration already registers yUndoPlugin (plus the
// Mod-z / Mod-y / Shift-Mod-z commands), so returning a second one here would
// make EditorState.create throw "Adding different instances of a keyed plugin
// (y-undo$)". Instead the manager built below is handed to Collaboration via
// its yUndoOptions: whole-doc scope, default deleteFilter/captureTransaction,
// tracked only against ySyncPluginKey so remote sync and title writes stay
// out of the stack while block-level deletions (file cards, embeds) remain
// undoable.
const YUndo = Extension.create({
  name: 'yUndo',

  // Before Collaboration (priority 1000): its addProseMirrorPlugins reads
  // yUndoOptions, so the override below has to be installed first.
  priority: 1001,

  addProseMirrorPlugins() {
    const collab = this.editor.extensionManager.extensions.find(
      (ext) => ext.name === 'collaboration'
    );
    const ydoc = collab?.options?.document;
    if (!ydoc) return [];

    const undoManager = new Y.UndoManager(ydoc, {
      trackedOrigins: new Set([ySyncPluginKey]),
    });

    // extension.options is a recomputed getter, so a plain assignment would
    // be lost on the next read — wrap addOptions instead.
    const prevAddOptions = collab.config.addOptions;
    collab.config.addOptions = function () {
      const base = (prevAddOptions ? prevAddOptions.call(this) : {}) || {};
      return { ...base, yUndoOptions: { ...base.yUndoOptions, undoManager } };
    };

    return [];
  },
});

export default YUndo;
