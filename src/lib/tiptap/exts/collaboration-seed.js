import { Extension } from '@tiptap/core';
import { initProseMirrorDoc } from '@tiptap/y-tiptap';
import { speed } from '@/utils/speed.js';

/**
 * Seed the editor with the Yjs document and hand y-prosemirror the matching
 * mapping. Without it, y-sync's first render replaces the empty document with
 * a full-document transaction — ~1.2s on notes with thousands of blocks.
 *
 * `onBeforeCreate` is the only window with the real editor schema that still
 * runs before `createDoc()` and the plugin list, so the doc and the mapping
 * are built from the same schema instance (ProseMirror compares schema types
 * by identity) and the collaboration plugin can pick the mapping up.
 */
export default Extension.create({
  name: 'collaborationSeed',

  onBeforeCreate() {
    const collab = this.editor.extensionManager.extensions.find(
      (extension) => extension.name === 'collaboration',
    );
    const collabOptions = collab?.options;
    if (!collabOptions?.document) return;

    try {
      const fragment =
        collabOptions.fragment ??
        collabOptions.document.getXmlFragment(collabOptions.field ?? 'default');
      const t = speed('pm_seed_doc');
      const { doc, mapping } = initProseMirrorDoc(fragment, this.editor.schema);
      t.end();
      // An empty fragment would produce a doc with no block, which PM can't
      // edit; let y-sync seed it the normal way (instant at that size).
      if (doc.childCount === 0) return;
      this.editor.options.content = doc;
      // `extension.options` is a freshly merged copy on every read, so the
      // mapping has to go through the options factory that builds it.
      const baseOptions = collab.config.addOptions;
      collab.config.addOptions = function () {
        const options =
          typeof baseOptions === 'function' ? baseOptions() : baseOptions;
        return {
          ...options,
          ySyncOptions: { ...options?.ySyncOptions, mapping },
        };
      };
    } catch (e) {
      console.warn('[editor] yjs seed skipped:', e?.message);
    }
  },
});
