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
      paste: (view, event) => {
        const clipboardData =
          event.clipboardData || event.originalEvent.clipboardData;
        if (!clipboardData) return false;

        const items = Array.from(clipboardData.items);
        const files = items
          .filter((item) => item.kind === 'file')
          .map((item) => item.getAsFile())
          .filter(Boolean);

        if (files.length === 0) {
          return false;
        }

        const urls = items.filter(
          (item) => item.kind === 'string' && item.type === 'text/plain'
        );

        if (files.length > 0) {
          event.preventDefault();
          insertImages(files, (src, alt) => {
            const { tr, schema } = view.state;
            const imageNode = schema.nodes.image.create({ src, alt });
            view.dispatch(tr.replaceSelectionWith(imageNode));
          });
        }

        if (urls.length > 0) {
          urls.forEach((urlItem) => {
            urlItem.getAsString((url) => {
              if (url.match(/\.(jpeg|jpg|gif|png)$/i)) {
                const { tr } = view.state;
                view.dispatch(tr.insertText(url, view.state.selection.from));
              }
            });
          });
        }

        return files.length > 0;
      },
    },
  },
});

export default ImageResize.extend({
  name: 'image',
  addProseMirrorPlugins() {
    return [handleImagePaste];
  },
});
