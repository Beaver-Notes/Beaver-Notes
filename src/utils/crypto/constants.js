/**
 * Shared cryptographic constants.
 *
 * Centralises algorithm names, key sizes, and iteration counts so that
 * app, note, and sync encryption paths all use the same values.
 */

export const ALGO_AES_GCM = 'AES-GCM';
export const ALGO_HKDF = 'HKDF';
export const ALGO_PBKDF2 = 'PBKDF2';
export const HASH_SHA_256 = 'SHA-256';
export const KEY_LENGTH_256 = 256;

export const IV_LENGTH_BYTES = 12;
export const SALT_LENGTH_BYTES = 32;
export const PBKDF2_ITERATIONS = 100_000;

export const ENVELOPE_VERSION = 2;
// Per-note password lock v3 uses Argon2id (matching the app encryption KDF)
// instead of PBKDF2. v2 (PBKDF2) notes remain decryptable for backward compat.
export const NOTE_ENVELOPE_VERSION_ARGON2 = 3;
export const BASE64_CHUNK_SIZE = 0x8000;
export const WORKER_POOL_MAX = 4;
