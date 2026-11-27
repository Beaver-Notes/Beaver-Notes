import { invoke } from '@tauri-apps/api/core';

let cachedDeviceId = null;

function readLegacyDeviceId() {
  try {
    return localStorage.getItem('deviceId') || null;
  } catch {
    return null;
  }
}

// Rust kv `sync:local:device-id` is the single source; the legacy localStorage UUID is passed as seed and adopted only when kv is absent, so existing installs keep their identity.
export async function getSyncDeviceId() {
  if (cachedDeviceId) return cachedDeviceId;
  const legacy = readLegacyDeviceId();
  try {
    const id = await invoke('sync_device_id', legacy ? { seed: legacy } : {});
    if (typeof id === 'string' && id.trim()) {
      cachedDeviceId = id;
      try {
        localStorage.setItem('deviceId', id);
      } catch {}
      return cachedDeviceId;
    }
  } catch {}
  if (legacy) {
    cachedDeviceId = legacy;
    return cachedDeviceId;
  }
  try {
    const id = typeof crypto?.randomUUID === 'function'
      ? crypto.randomUUID()
      : `local-${Date.now()}-${Math.floor(Math.random() * 1e9)}`;
    try { localStorage.setItem('deviceId', id); } catch {}
    cachedDeviceId = id;
  } catch {
    cachedDeviceId = `local-${Date.now()}-${Math.floor(Math.random() * 1e9)}`;
  }
  return cachedDeviceId;
}

