import { Plugin, PluginKey } from 'prosemirror-state';
import ImageResize from 'tiptap-extension-resize-image';
import { useStore } from '@/store';
import copyImage from '@/utils/copy-image';
import { writeImageFile } from '@/utils/copy-image';

export async function insertImages(files, callback) {
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
        const clipboardData =
          event.clipboardData || event.originalEvent.clipboardData;
        const items = clipboardData.items;
        const files = Array.from(items)
          .filter((item) => item.kind === 'file')
          .map((item) => item.getAsFile());
        const urls = Array.from(items).filter(
          (item) => item.kind === 'string' && item.type === 'text/plain'
        );

        // Check if both files and URLs are present
        if (files.length > 0 && urls.length > 0) {
          // Prioritize files, ignore URLs
          event.preventDefault(); // Stop default behavior to prevent URL insertion
        }

        // Handle image files
        if (files.length > 0) {
          insertImages(files, (src, alt) => {
            if (view.state.selection.$cursor) {
              const transaction = view.state.tr.replaceSelectionWith(
                view.state.schema.nodes.image.create({ src, alt })
              );
              view.dispatch(transaction);
            }
          });
          return;
        }

        // Handle URLs only if no files are present
        if (urls.length > 0) {
          urls[0].getAsString((url) => {
            if (url.match(/\.(jpeg|jpg|gif|png)$/)) {
              const transaction = view.state.tr.insertText(
                url,
                view.state.selection.from
              );
              view.dispatch(transaction);
            }
          });
        }
      },
    },
  },
});

export default ImageResize.extend({
  addProseMirrorPlugins() {
    return [handleImagePaste];
  },
});
