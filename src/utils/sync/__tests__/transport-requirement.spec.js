import { describe, it, expect } from 'vitest';
import { transportRequirement } from '../settings-cloud-sync';

const FOLDER = { value: 'folder' };
const REMOTE = { value: 'remote' };

describe('transportRequirement', () => {
  it('explains the plan gate on cloud sync', () => {
    expect(transportRequirement(REMOTE, { isPaid: false, hasSyncPath: true })).toEqual({
      kind: 'plan',
      text: 'Requires the Basic plan',
      action: 'Upgrade',
    });
  });

  it('explains the missing folder on folder sync', () => {
    expect(transportRequirement(FOLDER, { isPaid: true, hasSyncPath: '' })).toEqual({
      kind: 'folder',
      text: 'Requires a folder',
      action: 'Browse',
    });
  });

  it('returns null when the option is selectable', () => {
    expect(transportRequirement(REMOTE, { isPaid: true, hasSyncPath: '' })).toBeNull();
    expect(transportRequirement(FOLDER, { isPaid: false, hasSyncPath: '/tmp/sync' })).toBeNull();
  });
});
