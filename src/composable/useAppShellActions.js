import { computed } from 'vue';
import { useRouter, useRoute } from 'vue-router';
import emitter from 'tiny-emitter/instance';
import { useTranslations } from '@/composable/useTranslations';
import { useNoteStore } from '@/store/note';
import { useFolderStore } from '@/store/folder';
import { useAppStore } from '@/store/app';

export function useAppShellActions({ includeSettingsNav = false } = {}) {
  const route = useRoute();
  const router = useRouter();
  const appStore = useAppStore();
  const noteStore = useNoteStore();
  const folderStore = useFolderStore();
  const { translations } = useTranslations();

  const currentFolderId = computed(() =>
    route.name === 'Folder' ? route.params.id ?? null : null
  );

  const navItems = computed(() => {
    const items = [
      {
        name: translations.value.sidebar.notes,
        path: '/',
        icon: 'riBookletLine',
        shortcut: 'mod+Shift+N',
      },
      {
        name: translations.value.sidebar.archive,
        path: '/?archived=true',
        icon: 'riArchiveDrawerLine',
        shortcut: 'mod+Shift+A',
      },
    ];

    if (includeSettingsNav) {
      items.push({
        name: translations.value.settings.title,
        path: '/settings',
        icon: 'riSettingsLine',
        shortcut: 'mod+,',
      });
    }

    return items;
  });

  function openSettings() {
    router.push('/settings');
  }

  function openLastEdited() {
    const noteId = localStorage.getItem('lastNoteEdit');
    if (noteId) router.push(`/note/${noteId}`);
  }

  async function addNote() {
    const folderId =
      currentFolderId.value && (await folderStore.exists(currentFolderId.value))
        ? currentFolderId.value
        : null;

    noteStore.add({ folderId }).then(({ id }) => {
      if (appStore.setting.openAfterCreation) {
        const target = `/note/${id}`;
        if (router.currentRoute.value.path !== target) {
          router.push(target);
        }
      }
    });
  }

  async function addFolder() {
    const parentId =
      currentFolderId.value && (await folderStore.exists(currentFolderId.value))
        ? currentFolderId.value
        : null;

    folderStore.add({ parentId });
  }

  function handleNavigation(nav) {
    router.push(nav.path);
    emitter.emit('clear-label');
  }

  function createShortcutMap(extraShortcuts = {}) {
    return {
      'mod+n': addNote,
      'mod+,': openSettings,
      'mod+shift+f': () => {
        if (route.name === 'Note') return false;
        return addFolder();
      },
      'mod+shift+w': openLastEdited,
      'mod+shift+n': () => router.push('/'),
      'mod+shift+a': () => router.push('/?archived=true'),
      ...extraShortcuts,
    };
  }

  return {
    translations,
    navItems,
    currentFolderId,
    addNote,
    addFolder,
    openSettings,
    openLastEdited,
    handleNavigation,
    createShortcutMap,
  };
}
