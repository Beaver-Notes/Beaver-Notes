import { describe, expect, it } from 'vitest';
import en from '@/assets/locales/en.json';

// Guard: user-facing copy must keep one locked vocabulary per secret:
//   server login            -> "Account password"
//   end-to-end secret       -> "Vault key"
//   account recovery        -> "Account recovery code"
//   vault recovery          -> "Vault recovery code"
// Add new banned patterns here when a wrong synonym sneaks back in.
const BANNED = [
  { name: 'vault password', re: /vault password/i },
  { name: 'workspace passphrase', re: /workspace passphrase/i },
  { name: 'encryption passphrase', re: /encryption passphrase/i },
  { name: 'vault passphrase', re: /vault passphrase/i },
  { name: 'keychain', re: /\bkeychain\b/i },
  { name: 'system keyring', re: /\bsystem keyring\b/i },
  { name: 'OS keychain', re: /\bos keychain\b/i },
  {
    name: 'bare password/passphrase placeholder',
    re: /placeholder[^=\n]*[=:][^\n]*['"`](?:password|passphrase)['"`]/i,
  },
];

const SOURCES = import.meta.glob('../../../**/*.{js,vue}', {
  query: '?raw',
  import: 'default',
  eager: true,
});

function isExcluded(file) {
  return (
    file.includes('/__tests__/') ||
    file.endsWith('/lib/tauri/bindings.ts') ||
    file.endsWith('/lib/tauri/commands.ts')
  );
}

// Comments are not user-facing; strip them before scanning.
function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

function collectJsonStrings(value, out = []) {
  if (typeof value === 'string') {
    out.push(value);
  } else if (Array.isArray(value)) {
    for (const item of value) collectJsonStrings(item, out);
  } else if (value && typeof value === 'object') {
    for (const item of Object.values(value)) collectJsonStrings(item, out);
  }
  return out;
}

const SAMPLES = [
  'Enter your vault password',
  'Wrong workspace passphrase.',
  'Encryption passphrase',
  'the vault passphrase',
  'your system keychain',
  'the system keyring',
  'the OS keychain',
  "placeholder: 'Password'",
];

describe('terminology guard', () => {
  it('loads the source corpus and each pattern catches its sample', () => {
    const files = Object.keys(SOURCES);
    expect(files.length).toBeGreaterThan(50);
    expect(files.some((f) => f.endsWith('App.vue'))).toBe(true);
    const missed = BANNED.filter(
      ({ re }) => !SAMPLES.some((sample) => re.test(sample)),
    ).map(({ name }) => name);
    expect(missed).toEqual([]);
  });

  it('has no banned secret synonyms in en.json copy', () => {
    const violations = [];
    for (const value of collectJsonStrings(en)) {
      for (const { name, re } of BANNED) {
        if (re.test(value)) violations.push(`${name}: ${value}`);
      }
    }
    expect(violations).toEqual([]);
  });

  it('has no banned secret synonyms in inline English fallbacks', () => {
    const violations = [];
    for (const [file, raw] of Object.entries(SOURCES)) {
      if (isExcluded(file)) continue;
      const text = stripComments(raw);
      for (const { name, re } of BANNED) {
        if (re.test(text)) violations.push(`${file}: ${name}`);
      }
    }
    expect(violations).toEqual([]);
  });

  it('locks the vocabulary the guard protects', () => {
    expect(en.settings.password).toBe('Vault key');
    expect(en.settings.encryptionPassphrase).toBe('Vault key');
    expect(en.settings.vaultKeyPlaceholder).toBe('Vault key');
    expect(en.account.recoveryCode).toBe('Account recovery code');

    const block = en.settings.whatUnlocksWhat;
    expect(block).toContain('Account password');
    expect(block).toContain('Vault key');
    expect(block).toContain('Account recovery code');
    expect(block).toContain('Vault recovery code');

    // Device password is no longer a user-facing concept.
    expect(en.devicePassword).toBeUndefined();
  });
});
