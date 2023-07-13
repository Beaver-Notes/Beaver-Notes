import { useRoute } from 'vue-router';
import copyImage from '@/utils/copy-image';

export function useEditorImage(editor) {
  const route = useRoute();

  if (typeof editor !== 'object' || editor === null)
    return console.error('Editor is required');

  function setImage(url) {
    editor.chain().focus().setImage({ src: url }).run();
  }
  function selectImage(applyImg) {
    return new Promise((resolve, reject) => {
      const { ipcRenderer } = window.electron;

      ipcRenderer
        .callMain('dialog:open', {
          properties: ['openFile'],
          filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg'] }],
        })
        .then(({ canceled, filePaths }) => {
          if (canceled || filePaths.length === 0) return reject();

          copyImage(filePaths[0], route.params.id).then(({ fileName }) => {
            const imgPath = `assets://${route.params.id}/${fileName}`;

            if (applyImg) setImage(imgPath);

            resolve(imgPath);
          });
        });
    });
  }

  return {
    set: setImage,
    select: selectImage,
  };
}
