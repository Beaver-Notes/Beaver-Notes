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
    if (file.path) {
      const { fileName } = await copyImage(file.path, noteId);

      callback(`assets://${noteId}/${fileName}`, file.name);
    } else {
      const { fileName } = await writeImageFile(file, noteId);

      callback(`assets://${noteId}/${fileName}`, file.name);
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
          copy: async (view, event) => {
            // Handle copying images from the editor (optional, depending on your use case)
            const { from, to } = view.state.selection;
            const slice = view.state.doc.slice(from, to);
            const content = view.state.schema.nodeFromJSON(slice.toJSON());

            const clipboardData = event.clipboardData || window.clipboardData;
            clipboardData.setData('application/json', JSON.stringify(content));

            event.preventDefault();
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

    const handleImageCopy = new Plugin({
      key: new PluginKey('handleCopyLink'),
      props: {
        handleDOMEvents: {
          copy: async (view, event) => {
            // Handle copying images from outside the editor (e.g., from other websites)
            const clipboardData = event.clipboardData || window.clipboardData;
            const items = Array.from(clipboardData.items || []);

            const imageFiles = items.filter(
              (item) => item.type.startsWith('image/') && item.kind === 'file'
            );

            if (imageFiles.length > 0) {
              insertImages(imageFiles, (src, alt) => {
                clipboardData.setData('text/plain', alt);
                clipboardData.setData(
                  'text/html',
                  `<img src="${src}" alt="${alt}">`
                );
                clipboardData.setData('text/uri-list', src);

                // Add any other formats as needed
                event.preventDefault();
              });
            }
          },
        },
      },
    });

    return [handleImagePaste, handleImageCopy];
  },
});
