import { describe, expect, it } from 'vitest';

import { computeRemovedSharedWorkspaces } from '../useCloudWorkspaces.js';

describe('workspace removal reconciliation', () => {
  it('flags shared workspaces missing from the backend', () => {
    const local = [
      { id: 'default', workspaceType: 'personal', cloudSync: false },
      { id: 'shared-1', workspaceType: 'shared', cloudSync: true },
      { id: 'shared-2', workspaceType: 'shared', cloudSync: true },
      { id: 'personal-cloud', workspaceType: 'personal', cloudSync: true },
    ];
    const backend = [{ id: 'shared-1' }, { id: 'personal-cloud' }];

    const toDelete = computeRemovedSharedWorkspaces(local, backend);
    expect(toDelete).toEqual(['shared-2']);
  });

  it('never deletes personal workspaces', () => {
    const local = [{ id: 'default', workspaceType: 'personal', cloudSync: false }];
    const toDelete = computeRemovedSharedWorkspaces(local, []);
    expect(toDelete).toEqual([]);
  });
});
