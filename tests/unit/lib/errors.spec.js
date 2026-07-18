import { describe, it, expect } from 'vitest';
import { isError } from '@/lib/tauri/errors.js';

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
