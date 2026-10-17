// Device model for sync headers and admin display. UA-based: Android UAs carry
// the real model (`; MODEL Build/`); iOS UAs only say iPhone/iPad, so those
// stay generic. Cached: UA never changes within a session.
let cached = null;

function parseModel(ua) {
  if (!ua) return null;
  const android = ua.match(/;\s*([^;()]+?)\s+Build\//);
  if (android) return android[1].trim().slice(0, 64);
  if (/iPhone/.test(ua)) return 'iPhone';
  if (/iPad/.test(ua)) return 'iPad';
  return null;
}

function parseOs(ua, platform) {
  const p = `${platform || ''} ${ua || ''}`;
  if (/Android/.test(p)) return 'Android';
  if (/iPhone|iPad/.test(p)) return 'iOS';
  if (/Mac/.test(p)) return 'macOS';
  if (/Windows/.test(p)) return 'Windows';
  if (/Linux/.test(p)) return 'Linux';
  return null;
}

export function getDeviceModel() {
  if (cached !== null) return cached;
  if (typeof navigator === 'undefined') return (cached = '');
  const ua = navigator.userAgent || '';
  const model = parseModel(ua);
  const os = parseOs(ua, navigator.platform || '');
  if (model && os && model !== os) cached = `${model} · ${os}`;
  else cached = model || os || '';
  return cached;
}

export function resetDeviceModelCache() {
  cached = null;
}
