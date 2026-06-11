import { backend } from '@/lib/tauri-bridge';

export function isSupported() {
  return backend.invoke('app-icon:isSupported');
}

export function getName() {
  return backend.invoke('app-icon:getName');
}

export function changeIcon(options) {
  return backend.invoke('app-icon:change', { options });
}

export function resetIcon(options) {
  return backend.invoke('app-icon:reset', { options });
}
