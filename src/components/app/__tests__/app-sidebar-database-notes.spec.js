import { describe, it, expect, vi } from 'vitest'
import { ref } from 'vue'
import { createPinia } from 'pinia'
import { mount } from '@vue/test-utils'

vi.mock('vue-router', async (importOriginal) => ({
  ...(await importOriginal()),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useRoute: () => ({ name: 'Home', path: '/', params: {}, query: {}, fullPath: '/' }),
}))
vi.mock('@/composable/useAppShellActions', () => ({
  useAppShellActions: () => ({
    translations: ref({
      sidebar: { addNotes: 'New Note', newFolder: 'New Folder', notes: 'All Notes', archive: 'Archive' },
      tray: {},
      settings: { title: 'Settings' },
    }),
    navItems: [],
    addNote: vi.fn(),
    addFolder: vi.fn(),
    openSettings: vi.fn(),
    openLastEdited: vi.fn(),
    handleNavigation: vi.fn(),
    createShortcutMap: () => ({}),
  }),
}))
vi.mock('@/composable/theme', () => ({
  useTheme: () => ({ setTheme: vi.fn(), isDark: () => false }),
}))
vi.mock('@/utils/sync', () => ({ forceSyncNow: vi.fn() }))
vi.mock('@/utils/ui/globalShortcuts.js', () => ({ bindGlobalShortcuts: vi.fn() }))
vi.mock('@/lib/tauri/runtime', () => ({ isMacOSRuntime: () => false }))
vi.mock('@/composable/useSounds', () => ({ useSounds: () => ({ play: vi.fn() }) }))
vi.mock('@/store/database', () => ({
  useDatabaseStore: () => ({ databases: [], hydrate: vi.fn() }),
}))
vi.mock('@/store/sync-progress', () => ({
  useSyncProgressStore: () => ({
    isSyncing: false,
    phase: '',
    phaseMessage: '',
    total: 0,
    progress: 0,
    attention: null,
  }),
}))
vi.mock('tiny-emitter/instance', () => ({
  default: { on: vi.fn(), off: vi.fn(), emit: vi.fn() },
}))

import AppSidebar from '../AppSidebar.vue'
import { useNoteStore } from '@/store/note'

describe('sidebar hides database-backed notes', () => {
  it('excludes inDatabase notes from Recent while ordinary notes surface', () => {
    const pinia = createPinia()
    const now = Date.now()
    const base = {
      content: { type: 'doc', content: [] },
      labels: [],
      createdAt: now,
      updatedAt: now,
      isBookmarked: false,
      isArchived: false,
      isLocked: false,
      isFullWidth: false,
      folderId: null,
    }
    useNoteStore(pinia).$patch({
      data: {
        n1: { ...base, id: 'n1', title: 'Plain note' },
        n2: { ...base, id: 'n2', title: 'Row backing note', inDatabase: true },
      },
    })

    const w = mount(AppSidebar, {
      global: {
        plugins: [pinia],
        stubs: {
          'v-remixicon': { template: '<i />' },
          WorkspaceSwitcher: { template: '<div />' },
          FolderCustomizeModal: { template: '<div />' },
          'router-link': { template: '<a><slot /></a>' },
        },
        directives: { tooltip: {} },
      },
    })

    expect(w.text()).toContain('Plain note')
    expect(w.text()).not.toContain('Row backing note')
    w.unmount()
  })
})
