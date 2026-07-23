// tests/unit/store/folder.spec.js
import { describe, it, expect } from 'vitest';
import { useFolderStore } from '@/store/folder';

describe('folder store', () => {
  it('starts with no folders', () => {
    const store = useFolderStore();
    expect(store.data).toEqual({});
    expect(store.folders).toEqual([]);
  });

  it('adds a folder and exposes it through the folders getter', async () => {
    const store = useFolderStore();
    const folder = await store.add({ name: 'Projects' });
    expect(folder.id).toBeTruthy();
    expect(store.data[folder.id].name).toBe('Projects');
    expect(store.folders).toHaveLength(1);
  });
});
