import { Extension } from '@tiptap/core';
import { saveFile } from '@/utils/assets/storage.js';
import { useStore } from '@/store';
import { Plugin, PluginKey } from 'prosemirror-state';
import { insertImages } from './image';

async function processDropFiles(view, editor, event, files, id) {
  try {
    for (const file of files) {
      const mimeType = file.type;

      if (mimeType.startsWith('image/')) {
        const imageFiles = Array.from(files).filter((f) =>
          f.type.startsWith('image/')
        );

        insertImages(imageFiles, (src, alt) => {
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

        continue;
      }

      const store = useStore();
      const noteId = store.activeNoteId;

      const { fileName, relativePath } = await saveFile(file, noteId);
      const src = `${relativePath}`;

      if (mimeType.startsWith('audio/')) {
        editor.commands.setAudio(src);
      } else if (mimeType.startsWith('video/')) {
        editor.commands.setVideo(src);
      } else {
        editor.commands.setFileEmbed(src, fileName);
      }
    }
  } catch (error) {
    console.error('Error saving and embedding files:', error);
  }
}

export const dropFile = Extension.create({
  name: 'dropFile',

  addOptions() {
    return {
      id: '',
    };
  },

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey('dropFile'),
        props: {
          handleDOMEvents: {
            drop: (view, event) => {
              const files = event.dataTransfer?.files;
              if (!files || files.length === 0) return false;

              const hasFileType = files.length > 0 && files[0].type.length > 0;
              if (!hasFileType) return false;

              event.preventDefault();
              event.stopPropagation();

              const { editor } = this;
              const id = this.options.id;

              if (!id) {
                console.error('Error: Missing document ID');
                return false;
              }

              processDropFiles(view, editor, event, files, id);

              return true;
            },
          },
        },
      }),
    ];
  },
});
