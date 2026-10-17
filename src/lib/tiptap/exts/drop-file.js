import { Extension } from '@tiptap/core';
import { assetFileName } from '@/utils/assets/storage.js';
import { Plugin, PluginKey } from 'prosemirror-state';
import { insertImages, swapImageSrc } from './image';
import { insertFileBlockOptimistic } from './create-file-block';
import { notify } from '@/lib/native/app';
import mime from 'mime';

async function processDropFiles(view, editor, event, files, id) {
  try {
    for (const file of files) {
      const mimeType = file.type || mime.getType(file.name) || '';

      if (mimeType.startsWith('image/')) {
        const imageFiles = Array.from(files).filter((f) =>
          f.type.startsWith('image/')
        );

        insertImages(
          imageFiles,
          (src, alt) => {
            const coordinates = view.posAtCoords({
              left: event.clientX,
              top: event.clientY,
            });

            if (!coordinates) return;

            const node = view.state.schema.nodes.image.create({ alt, src });
            view.dispatch(view.state.tr.insert(coordinates.pos, node));
          },
          (tempSrc, finalSrc) => swapImageSrc(view, tempSrc, finalSrc),
        ).catch((error) => {
          console.error('Error saving dropped images:', error?.cause ?? error);
          void notify({ title: 'Image drop failed', body: 'The file was kept as a preview; try again.' }).catch(() => {});
        });

        continue;
      }

      // Optimistic: the node appears instantly (blob URL plays immediately
      // when we hold the bytes, '' placeholder for bare paths). Tauri exposes
      // the filesystem path on dropped files, so Rust streams the encrypt
      // instead of pushing the whole file through IPC.
      const fileName = assetFileName(file.path || file);
      const preview = file instanceof File ? file : null;

      const typeName = mimeType.startsWith('audio/')
        ? 'Audio'
        : mimeType.startsWith('video/')
          ? 'Video'
          : 'fileEmbed';

      const coordinates = view.posAtCoords({
        left: event.clientX,
        top: event.clientY,
      });

      const insert =
        !coordinates && typeName === 'Audio'
          ? (tempSrc) => editor.commands.setAudio(tempSrc, fileName)
          : !coordinates && typeName === 'Video'
            ? (tempSrc) => editor.commands.setVideo(tempSrc, fileName)
            : !coordinates
              ? (tempSrc) => editor.commands.setFileEmbed(tempSrc, fileName)
              : (tempSrc) => {
                  const attrs = { src: tempSrc, fileName };
                  const node = view.state.schema.nodes[typeName].create(attrs);
                  view.dispatch(view.state.tr.insert(coordinates.pos, node));
                };

      insertFileBlockOptimistic(view, {
        typeName,
        insert,
        file: file.path || file,
        preview,
        noteId: id,
        fileName,
      });
    }
  } catch (error) {
    console.error('Error saving and embedding files:', error?.cause ?? error);
    void notify({ title: 'File drop failed', body: 'Could not save the dropped file.' }).catch(() => {});
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
