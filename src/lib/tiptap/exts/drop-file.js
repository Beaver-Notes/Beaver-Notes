import { Extension } from '@tiptap/core';
import { saveFile } from '@/utils/copy-doc';
import { useStore } from '@/store';
import { Plugin, PluginKey } from 'prosemirror-state';
import { insertImages } from './image';

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
            drop: async (view, event) => {
              event.preventDefault();
              event.stopPropagation();

              const { editor } = this;
              const id = this.options.id;

              if (!id) {
                console.error('Error: Missing document ID');
                return false;
              }

              const files = event.dataTransfer?.files;
              if (!files || files.length === 0) return false;

              try {
                for (const file of files) {
                  const mimeType = file.type;

                  // Ignore image files
                  if (mimeType.startsWith('image/')) {
                    const imageFiles = Array.from(
                      event.dataTransfer.files
                    ).filter((file) => file.type.startsWith('image/'));

                    // Process each image file
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
                      const transaction = view.state.tr.insert(
                        coordinates.pos,
                        node
                      );

                      view.dispatch(transaction);
                    });

                    return true;
                  }

                  const store = useStore();
                  const noteId = store.activeNoteId;

                  const { fileName, relativePath } = await saveFile(
                    file,
                    noteId
                  );
                  const src = `${relativePath}`;

                  if (mimeType.startsWith('audio/')) {
                    editor.commands.setAudio(src);
                  } else if (mimeType.startsWith('video/')) {
                    editor.commands.setVideo(src);
                  } else {
                    editor.commands.setFileEmbed(src, fileName);
                  }
                }
                return true;
              } catch (error) {
                console.error('Error saving and embedding files:', error);
                return false;
              }
            },
          },
        },
      }),
    ];
  },
});
