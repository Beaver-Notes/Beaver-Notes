import { useRoute } from 'vue-router';
import copyImage from '@/utils/copy-image';

export function useEditorImage(editor) {
  const route = useRoute();

  if (typeof editor !== 'object' || editor === null)
    return console.error('Editor is required');

  function setImage(url) {
    editor.chain().focus().setImage({ src: url }).run();
  }

  async function selectImage(applyImg) {
    const { ipcRenderer } = window.electron;
    const clipboardImage = await getClipboardImage();

    if (clipboardImage) {
      // If there is an image in the clipboard, use it.
      if (applyImg) setImage(clipboardImage);
      return clipboardImage;
    } else {
      // If there is no image in the clipboard, open the file dialog.
      const { canceled, filePaths } = await ipcRenderer.callMain(
        'dialog:open',
        {
          properties: ['openFile'],
          filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg'] }],
        }
      );

      if (canceled || filePaths.length === 0) {
        throw new Error('No image selected');
      } else {
        copyImage(filePaths[0], route.params.id).then(({ fileName }) => {
          const imgPath = `assets://${route.params.id}/${fileName}`;

          if (applyImg) setImage(imgPath);

          return imgPath;
        });
      }
    }
  }

  async function getClipboardImage() {
    try {
      const clipboardItems = await navigator.clipboard.read();
      for (const item of clipboardItems) {
        const blob = await item.getType(['image/png', 'image/jpeg']);
        if (blob) {
          const url = URL.createObjectURL(blob);
          return url;
        }
      }
    } catch (error) {
      console.error('Error reading clipboard:', error);
    }
    return null;
  }

  return {
    set: setImage,
    select: selectImage,
  };
}
