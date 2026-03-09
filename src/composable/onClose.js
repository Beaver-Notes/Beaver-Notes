import { addCloseHandler } from '@/lib/tauri-bridge';

export const onClose = (fn) => {
  if (window) addCloseHandler(fn);
};
