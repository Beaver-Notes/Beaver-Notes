import { Extension } from '@tiptap/core';
import { saveFile } from '@/utils/assets/storage.js';
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
          const coordinates = view.posAtCoords({
            left: event.clientX,
            top: event.clientY,
          });

          if (!coordinates) return;

          const node = view.state.schema.nodes.image.create({ alt, src });
          view.dispatch(view.state.tr.insert(coordinates.pos, node));
        });

        continue;
      }

      const { fileName, relativePath } = await saveFile(file, id);
      const src = `${relativePath}`;

      const typeName = mimeType.startsWith('audio/')
        ? 'Audio'
        : mimeType.startsWith('video/')
          ? 'Video'
          : 'fileEmbed';

      const coordinates = view.posAtCoords({
        left: event.clientX,
        top: event.clientY,
      });

      if (!coordinates) {
        if (typeName === 'Audio') {
          editor.commands.setAudio(src);
        } else if (typeName === 'Video') {
          editor.commands.setVideo(src);
        } else {
          editor.commands.setFileEmbed(src, fileName);
        }

        continue;
      }

      const attrs =
        typeName === 'fileEmbed' ? { src, fileName } : { src };

      const node = view.state.schema.nodes[typeName].create(attrs);
      view.dispatch(view.state.tr.insert(coordinates.pos, node));
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
