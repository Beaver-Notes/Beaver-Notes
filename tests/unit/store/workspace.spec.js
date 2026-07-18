// tests/unit/store/workspace.spec.js
import { describe, it, expect, vi } from 'vitest';
import { invokeCommand } from '@/lib/tauri/commands';
import { useWorkspaceStore } from '@/store/workspace';

describe('workspace store', () => {
  it('starts with empty workspaces and no active id', () => {
    const store = useWorkspaceStore();
    expect(store.workspaces).toEqual([]);
    expect(store.activeId).toBeNull();
    expect(store.loading).toBe(false);
  });

  it('retrieves workspaces via IPC and updates state', async () => {
    const store = useWorkspaceStore();
    vi.mocked(invokeCommand)
      .mockResolvedValueOnce([{ id: 'w1', name: 'Main' }])
      .mockResolvedValueOnce({ id: 'w1' });

    await store.retrieve();

    expect(invokeCommand).toHaveBeenCalledWith('workspace:list');
    expect(invokeCommand).toHaveBeenCalledWith('workspace:getActive');
    expect(store.workspaces).toHaveLength(1);
    expect(store.activeId).toBe('w1');
    expect(store.loading).toBe(false);
  });
});
