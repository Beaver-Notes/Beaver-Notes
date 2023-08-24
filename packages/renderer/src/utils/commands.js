import emitter from 'tiny-emitter/instance';
import { useTheme } from '../composable/theme';

const theme = useTheme();

function getModifierKey() {
  return navigator.platform.includes('Mac') ? 'Cmd' : 'Ctrl';
}

const commands = [
  {
    id: 'new-note',
    title: 'Create new note',
    shortcut: [getModifierKey(), 'N'], 
    handler: () => emitter.emit('new-note'),
  },
  {
    id: 'settings',
    title: 'Settings',
    shortcut: [getModifierKey(), ','],
    handler: () => emitter.emit('open-settings'),
  },
  {
    id: 'dark-theme',
    title: 'Apply dark theme',
    handler: () => theme.setTheme('dark'),
  },
  {
    id: 'light-theme',
    title: 'Apply light theme',
    handler: () => theme.setTheme('light'),
  },
];

export default commands;
