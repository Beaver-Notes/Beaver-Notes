export const OFFICIAL_SERVER_ORIGIN = 'https://api.beavernotes.com';

export function isOfficialServer(url) {
  try {
    return new URL(String(url || '')).origin === OFFICIAL_SERVER_ORIGIN;
  } catch {
    return false;
  }
}
