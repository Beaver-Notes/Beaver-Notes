// One shared block naming each secret and what it unlocks. Shown wherever two
// secrets meet (account recovery and vault recovery), so the user always knows
// which secret they are typing.
export const WHAT_UNLOCKS_WHAT_FALLBACK =
  'What unlocks what:\n' +
  '• Account password - signs you in to your Beaver Cloud account.\n' +
  '• Vault key - decrypts your notes and assets on every device.\n' +
  '• Account recovery code - restores account sign-in if you lose your passkeys.\n' +
  '• Vault recovery code - restores the vault key if you forget it.';

export function whatUnlocksWhat(translations) {
  return translations?.settings?.whatUnlocksWhat || WHAT_UNLOCKS_WHAT_FALLBACK;
}
