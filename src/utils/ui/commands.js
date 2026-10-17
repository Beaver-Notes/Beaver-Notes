import emitter from 'tiny-emitter/instance';

import { isMacOSRuntime } from '@/lib/tauri/runtime';
import { getTranslations } from '@/utils/i18n/getTranslations';
const translations = getTranslations();

function getModifierKey() {
  return isMacOSRuntime() ? 'Cmd' : 'Ctrl';
}

let commands = [
  {
    id: 'new-note',
    title: translations.commands.newNote,
    icon: 'riEditLine',
    shortcut: [getModifierKey(), 'N'],
    handler: () => emitter.emit('new-note'),
  },
  {
    id: 'new-folder',
    title: translations.commands.newFolder,
    icon: 'riFolder5Fill',
    shortcut: [getModifierKey(), 'N'],
    handler: () => emitter.emit('new-folder'),
  },
  {
    id: 'settings',
    title: translations.commands.settings,
    icon: 'riSettingsLine',
    shortcut: [getModifierKey(), ','],
    handler: () => emitter.emit('open-settings'),
  },
  {
    id: 'dark-theme',
    icon: 'riMoonClearLine',
    title: translations.commands.darkTheme,
    handler: () => emitter.emit('dark'),
  },
  {
    id: 'light-theme',
    icon: 'riSunLine',
    title: translations.commands.lightTheme,
    handler: () => emitter.emit('light'),
  },
];

export default commands;
