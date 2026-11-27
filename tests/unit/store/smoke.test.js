// Broad store smoke test: every store must construct with sane defaults and
// survive its primary mutation. One case per store instead of a 17-line file
// each, so adding a store is a row in CASES rather than a new spec.
// Per-store behaviour that is not "constructs + mutates" lives in its own spec
// (note.test.js covers FTS indexing of locked notes).
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import { invokeCommand } from '@/lib/tauri/commands';

vi.mock('@/lib/tauri/commands', () => ({
  invokeCommand: vi.fn(() => Promise.resolve()),
  listenCommand: vi.fn(() => Promise.resolve(() => {})),
}));
import { useAppStore } from '@/store/app';
import { useFolderStore } from '@/store/folder';
import { useI18nStore } from '@/store/i18n';
import { useLabelStore } from '@/store/label';
import { useStore } from '@/store/index';
import { useUndoStore } from '@/store/undo';
import { useWorkspaceStore } from '@/store/workspace';

const CASES = [
  {
    name: 'main',
    use: useStore,
    defaults: (s) => expect(s.activeNoteId).toBe(''),
    async mutate() {
      expect(Array.isArray(await useStore().retrieve())).toBe(true);
    },
  },
  {
    name: 'app',
    use: useAppStore,
    defaults: (s) => {
      expect(s.setting.collapsibleHeading).toBe(true);
      expect(s.loading).toBe(false);
    },
    async mutate() {
      vi.mocked(invokeCommand).mockResolvedValueOnce(undefined);
      const s = useAppStore();
      await s.setSettingStorage('soundsEnabled', false);
      expect(s.setting.soundsEnabled).toBe(false);
      expect(invokeCommand).toHaveBeenCalled();
    },
  },
  {
    name: 'folder',
    use: useFolderStore,
    defaults: (s) => {
      expect(s.data).toEqual({});
      expect(s.folders).toEqual([]);
    },
    async mutate() {
      const s = useFolderStore();
      const folder = await s.add({ name: 'Projects' });
      expect(folder.id).toBeTruthy();
      expect(s.data[folder.id].name).toBe('Projects');
      expect(s.folders).toHaveLength(1);
    },
  },
  {
    name: 'i18n',
    use: useI18nStore,
    defaults: (s) => expect(typeof s.lang).toBe('string'),
    async mutate() {
      vi.mocked(invokeCommand).mockResolvedValueOnce(undefined);
      const s = useI18nStore();
      await s.setLanguage('en');
      expect(s.lang).toBe('en');
      expect(document.documentElement.getAttribute('lang')).toBe('en');
    },
  },
  {
    name: 'label',
    use: useLabelStore,
    defaults: (s) => {
      expect(s.data).toEqual([]);
      expect(s.colors).toEqual({});
    },
    async mutate() {
      const s = useLabelStore();
      expect(await s.add('Work')).toBe('Work');
      expect(s.data).toContain('Work');
    },
  },
  {
    name: 'undo',
    use: useUndoStore,
    defaults: (s) => {
      expect(s.stack).toEqual([]);
      expect(s.lastAction).toBeNull();
    },
    mutate() {
      const action = { type: 'toggle-bookmark', notes: [{ id: 'n1', prev: false }] };
      const s = useUndoStore();
      s.push(action);
      expect(s.stack).toHaveLength(1);
      expect(s.lastAction).toStrictEqual(action);
    },
  },
  {
    name: 'workspace',
    use: useWorkspaceStore,
    defaults: (s) => {
      expect(s.workspaces).toEqual([]);
      expect(s.activeId).toBeNull();
      expect(s.loading).toBe(false);
    },
    async mutate() {
      // Unauthenticated retrieve is a deliberate no-op: useCloudWorkspaces
      // returns before any IPC when there is no account (useCloudWorkspaces.js:146).
      const s = useWorkspaceStore();
      await s.retrieve();
      expect(invokeCommand).not.toHaveBeenCalled();
      expect(s.workspaces).toEqual([]);
      expect(s.loading).toBe(false);
    },
  },
];

describe('store smoke', () => {
  beforeAll(() => {
    setActivePinia(createPinia());
  });

  beforeEach(() => {
    vi.mocked(invokeCommand).mockReset();
  });

  for (const c of CASES) {
    it(`${c.name}: initialises with defaults`, () => {
      c.defaults(c.use());
    });

    it(`${c.name}: survives its primary mutation`, async () => {
      await c.mutate();
    });
  }
});
