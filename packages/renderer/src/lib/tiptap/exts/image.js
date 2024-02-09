import { Plugin, PluginKey } from 'prosemirror-state';
import Image from '@tiptap/extension-image';
import { useStore } from '@/store';
import copyImage from '@/utils/copy-image';
import { writeImageFile } from '@/utils/copy-image';

async function insertImages(files, callback) {
  const store = useStore();

  for (const file of files) {
    console.log(file);
    const isImage = file.type.startsWith('image/') && file instanceof File;

    if (!isImage) {
      continue;
    }

    const noteId = store.activeNoteId;
    const name = file.name;
    const currentDate = new Date();
    const timestamp = currentDate.getTime(); // Get timestamp in milliseconds

    if (file.path) {
      const { fileName } = await copyImage(file.path, noteId, timestamp);
      // Append timestamp to the filename
      callback(`assets://${noteId}/${fileName}`, name);
    } else {
      const { fileName } = await writeImageFile(file, noteId, timestamp);
      callback(`assets://${noteId}/${fileName}`, name);
    }
  }
}

const handleImagePaste = new Plugin({
  key: new PluginKey('handlePasteLink'),
  props: {
    handleDOMEvents: {
      paste: async (view, event) => {
        const files = (event.clipboardData || event.originalEvent.clipboardData)
          .files;

        insertImages(files, (src, alt) => {
          if (view.state.selection.$cursor) {
            const transaction = view.state.tr.replaceSelectionWith(
              view.state.schema.nodes.image.create({ src, alt })
            );
            view.dispatch(transaction);
          }
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

export default Image.extend({
  addProseMirrorPlugins() {
    return [handleImagePaste];
  },
});
