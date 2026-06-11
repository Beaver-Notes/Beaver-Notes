import { backend } from '@/lib/tauri-bridge';

export function enableIndexing(enabled) {
  return backend.invoke('spotsearch:enableIndexing', { enabled });
}

export function indexItems(items) {
  return backend.invoke('spotsearch:indexItems', { items });
}

export function deleteItems(ids) {
  return backend.invoke('spotsearch:deleteItems', { ids });
}

export function deleteDomain(domain) {
  return backend.invoke('spotsearch:deleteDomain', { domain });
}
