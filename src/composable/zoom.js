import { getSettingSync, setSetting } from './settings';
import { setZoomLevel } from '@/lib/native/app';

const DEFAULT_ZOOM_LEVEL = 1.0;

// Set once at boot when the stored zoom is applied, so duplicate apply calls
// (entry + app-shell) collapse into a single IPC round-trip.
let zoomAppliedAtBoot = false;

export function markZoomAppliedAtBoot() {
  zoomAppliedAtBoot = true;
}

export function wasZoomAppliedAtBoot() {
  return zoomAppliedAtBoot;
}

export function getStoredZoomLevel(fallback = DEFAULT_ZOOM_LEVEL) {
  const parsed = parseFloat(getSettingSync('zoomLevel'));
  return Number.isNaN(parsed) ? fallback : parsed;
}

export function formatZoomLevel(level) {
  return Number(level).toFixed(2);
}

export async function setStoredZoomLevel(newZoomLevel) {
  zoomAppliedAtBoot = true;
  await setZoomLevel(newZoomLevel);

  const formattedZoomLevel = formatZoomLevel(newZoomLevel);
  await setSetting('zoomLevel', formattedZoomLevel);

  return formattedZoomLevel;
}
