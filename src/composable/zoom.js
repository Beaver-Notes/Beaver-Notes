import { backend } from '@/lib/tauri-bridge';
import { getSettingSync, setSetting } from './settings';

const DEFAULT_ZOOM_LEVEL = 1.0;

export function getStoredZoomLevel(fallback = DEFAULT_ZOOM_LEVEL) {
  const parsed = parseFloat(getSettingSync('zoomLevel'));
  return Number.isNaN(parsed) ? fallback : parsed;
}

export function formatZoomLevel(level) {
  return Number(level).toFixed(1);
}

export function setStoredZoomLevel(
  newZoomLevel,
  { syncDocument = false, reload = false } = {}
) {
  backend.invoke('app:set-zoom', newZoomLevel);

  const formattedZoomLevel = formatZoomLevel(newZoomLevel);
  void setSetting('zoomLevel', formattedZoomLevel);

  if (syncDocument) {
    document.body.style.zoom = formattedZoomLevel;
  }

  if (reload) {
    window.location.reload();
  }

  return formattedZoomLevel;
}
