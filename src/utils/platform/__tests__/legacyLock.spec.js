import { describe, it, expect } from 'vitest';
import { findLegacyLockedNotes, unwrapLegacyData } from '../legacyLock.js';

describe('findLegacyLockedNotes', () => {
  it('detects CryptoJS-envelope locked notes', () => {
    const data = {
      notes: {
        n1: { id: 'n1', isLocked: true, content: { content: ['U2FsdGVkX1+cipher'] } },
      },
      lockStatus: {},
      isLocked: {},
    };
    const result = findLegacyLockedNotes(data);
    expect(result.hasLocked).toBe(true);
    expect(result.count).toBe(1);
    expect(result.notes[0].id).toBe('n1');
  });

  it('detects {v:2} JSON-envelope locked notes', () => {
    const data = {
      notes: {
        n2: { id: 'n2', isLocked: true, content: { content: ['{"v":2,"salt":"s","iv":"i","cipher":"c"}'] } },
      },
      lockStatus: {},
      isLocked: {},
    };
    const result = findLegacyLockedNotes(data);
    expect(result.hasLocked).toBe(true);
    expect(result.count).toBe(1);
    expect(result.notes[0].id).toBe('n2');
  });

  it('detects {v:3} JSON-envelope locked notes via the lockStatus map', () => {
    const data = {
      notes: {
        n3: { id: 'n3', content: { content: ['{"v":3,"salt":"s","iv":"i","cipher":"c"}'] } },
      },
      lockStatus: { n3: 'locked' },
      isLocked: {},
    };
    const result = findLegacyLockedNotes(data);
    expect(result.hasLocked).toBe(true);
    expect(result.notes.map((n) => n.id)).toContain('n3');
  });

  it('does not flag locked notes without a legacy cipher envelope', () => {
    const data = {
      notes: {
        n4: { id: 'n4', isLocked: true, content: { type: 'doc', content: [] } },
      },
      lockStatus: {},
      isLocked: {},
    };
    const result = findLegacyLockedNotes(data);
    expect(result.hasLocked).toBe(false);
    expect(result.count).toBe(0);
  });

  it('does not flag unlocked notes that happen to carry ciphertext', () => {
    const data = {
      notes: {
        n5: { id: 'n5', isLocked: false, content: { content: ['U2FsdGVkX1+cipher'] } },
      },
      lockStatus: {},
      isLocked: {},
    };
    const result = findLegacyLockedNotes(data);
    expect(result.hasLocked).toBe(false);
  });

  it('does not flag an ae:6 app-encrypted envelope (workspace-key, no legacy password)', () => {
    const data = {
      notes: {
        n6: { id: 'n6', isLocked: true, content: { ae: 6, iv: 'iv', cipher: 'cipher', kid: 'ws' } },
      },
      lockStatus: {},
      isLocked: {},
    };
    const result = findLegacyLockedNotes(data);
    expect(result.hasLocked).toBe(false);
  });
});

describe('unwrapLegacyData', () => {
  it('unwraps a wrapped { data } shape', () => {
    const raw = { data: { notes: {} }, notNotes: true };
    expect(unwrapLegacyData(raw)).toBe(raw.data);
  });

  it('returns the raw object when there is no wrapping', () => {
    const raw = { notes: {} };
    expect(unwrapLegacyData(raw)).toBe(raw);
  });
});
