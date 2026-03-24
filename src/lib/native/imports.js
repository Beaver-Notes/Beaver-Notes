import { backend } from '@/lib/tauri-bridge';

export function importEvernote(props) {
  return backend.invoke('import:evernote', props);
}

export function importAppleNotes() {
  return backend.invoke('import:apple-notes', {});
}

export function onImportProgress(handler) {
  return backend.on('import-progress', handler);
}

export function onImportComplete(handler) {
  return backend.on('import-complete', handler);
}
