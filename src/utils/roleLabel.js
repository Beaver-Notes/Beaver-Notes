const FALLBACK = {
  editor: 'Editor',
  viewer: 'Viewer',
  admin: 'Admin',
  owner: 'Owner',
};

// Prefer the localised role labels already shipped under `teamAdmin`; fall back
// to the English defaults so a raw role id never reaches the UI.
export function roleLabel(role, translations) {
  const key = String(role || '').toLowerCase();
  if (!key) return '';
  return translations?.teamAdmin?.[key] || FALLBACK[key] || key;
}
