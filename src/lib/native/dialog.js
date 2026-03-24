import { backend } from '@/lib/tauri-bridge';

export function openDialog(props) {
  return backend.invoke('dialog:open', props);
}

export function saveDialog(props) {
  return backend.invoke('dialog:save', props);
}

export function showMessage(props) {
  return backend.invoke('dialog:message', props);
}
