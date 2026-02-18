import emitter from 'tiny-emitter/instance';

import { getTranslations } from '@/utils/getTranslations';
const translations = getTranslations();

function getModifierKey() {
  return navigator.platform.includes('Mac') ? 'Cmd' : 'Ctrl';
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
