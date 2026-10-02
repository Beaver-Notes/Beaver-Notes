/**
 * Secure storage is silent, with no user-facing device password.
 *
 * When the OS secure store is available the Rust safe-storage layer mints and
 * stores the master key with no UI. When it is not, the key is never persisted
 * and the encryption gate asks for the vault key at launch.
 *
 * `maybePrompt` is kept as a no-op startup hook so the app shell does not need
 * to know which backend the OS provides.
 */
export function useDevicePasswordSetup() {
  async function maybePrompt() {}
  return { maybePrompt };
}
