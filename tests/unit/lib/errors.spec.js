import { describe, it, expect } from 'vitest';
import { isError, errorMessage } from '@/lib/tauri/errors.js';

describe('isError', () => {
  it('matches a structured AppError of the given kind', () => {
    expect(isError({ kind: 'WrongPassword', message: 'Wrong password.' }, 'WrongPassword')).toBe(true);
  });

  it('does not match a structured AppError of a different kind', () => {
    expect(isError({ kind: 'EncryptionLocked', message: 'locked' }, 'WrongPassword')).toBe(false);
  });

  it('returns false when the error is a plain string', () => {
    expect(isError('Wrong password.', 'WrongPassword')).toBe(false);
  });

  it('returns false for null', () => {
    expect(isError(null, 'WrongPassword')).toBe(false);
  });

  it('returns false for undefined', () => {
    expect(isError(undefined, 'WrongPassword')).toBe(false);
  });
});

describe('errorMessage', () => {
  it('returns the message of a structured AppError', () => {
    expect(errorMessage({ kind: 'Io', message: 'boom' })).toBe('boom');
  });

  it('returns the string itself for a plain string error', () => {
    expect(errorMessage('plain failure')).toBe('plain failure');
  });

  it('returns "null" for a null error', () => {
    expect(errorMessage(null)).toBe('null');
  });

  it('returns "undefined" for an undefined error', () => {
    expect(errorMessage(undefined)).toBe('undefined');
  });

  it('falls back to String() for non-object, non-string values', () => {
    expect(errorMessage(42)).toBe('42');
  });
});
