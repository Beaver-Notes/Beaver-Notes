// tests/unit/store/app.spec.js
import { describe, it, expect } from 'vitest';
import { invokeCommand } from '@/lib/tauri/commands';
import { useAppStore } from '@/store/app';

describe('app store', () => {
  it('initialises setting refs from defaults', () => {
    const store = useAppStore();
    expect(store.setting.collapsibleHeading).toBe(true);
    expect(store.loading).toBe(false);
  });

  it('persists a setting and updates in-memory state', async () => {
    const store = useAppStore();
    await store.setSettingStorage('soundsEnabled', false);
    expect(store.setting.soundsEnabled).toBe(false);
    // setting flows through the storage wrapper -> backend.invoke
    expect(invokeCommand).toHaveBeenCalled();
  });
});
