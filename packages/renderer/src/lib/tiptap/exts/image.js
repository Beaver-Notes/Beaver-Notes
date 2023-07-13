import { Plugin, PluginKey } from 'prosemirror-state';
import Image from '@tiptap/extension-image';
import { useStore } from '@/store';
import copyImage from '@/utils/copy-image';

async function insertImages(files, callback) {
  const store = useStore();

  for (const file of files) {
    const isImage = file.type.startsWith('image/') && file.path;

    if (isImage) {
      const noteId = store.activeNoteId;
      const { fileName } = await copyImage(file.path, noteId);

      callback(`assets://${noteId}/${fileName}`, name);
    }
  }
}

export default Image.extend({
  addProseMirrorPlugins() {
    const handleImagePaste = new Plugin({
      key: new PluginKey('handlePasteLink'),
      props: {
        handleDOMEvents: {
          paste: async (view, event) => {
            insertImages(event.clipboardData.files, (src, alt) => {
              if (this.editor.isActive('image')) {
                this.editor.commands.setTextSelection(
                  view.state.tr.curSelection.to + 1
                );
              }

              this.editor.commands.setImage({
                alt,
                src,
              });
            });
          },
        },
        handleDrop: (view, event) => {
          insertImages(event.dataTransfer.files, (src, alt) => {
            const { schema } = view.state;
            const coordinates = view.posAtCoords({
              left: event.clientX,
              top: event.clientY,
            });
            const node = schema.nodes.image.create({
              alt,
              src,
            });
            const transaction = view.state.tr.insert(coordinates.pos, node);

            view.dispatch(transaction);
          });

          return true;
        },
      },
    });

    return [handleImagePaste];
  },
});
