import emitter from 'tiny-emitter/instance';
import { useTheme } from '../composable/theme';
import enTranslations from './locales/en.json';
import itTranslations from './locales/it.json';
import deTranslations from './locales/de.json';
import zhTranslations from './locales/zh.json';
import nlTranslations from './locales/nl.json';

const theme = useTheme();

function getModifierKey() {
  return navigator.platform.includes('Mac') ? 'Cmd' : 'Ctrl';
}

const selectedLanguage = localStorage.getItem('selectedLanguage') || 'en'; // Get the selected language from localStorage

let translations = enTranslations;

if (selectedLanguage === 'it') {
  translations = itTranslations;
}

if (selectedLanguage === 'de') {
  translations = deTranslations;
}

if (selectedLanguage === 'zh') {
  translations = zhTranslations;
}

if (selectedLanguage === 'nl') {
  translations = nlTranslations;
}

let commands = [
  {
    id: 'new-note',
    title: translations.commands['new-note'],
    shortcut: [getModifierKey(), 'N'],
    handler: () => emitter.emit('new-note'),
  },
  {
    id: 'settings',
    title: translations.commands['settings'],
    shortcut: [getModifierKey(), ','],
    handler: () => emitter.emit('open-settings'),
  },
  {
    id: 'dark-theme',
    title: translations.commands['dark-theme'],
    handler: () => theme.setTheme('dark'),
  },
  {
    id: 'light-theme',
    title: translations.commands['light-theme'],
    handler: () => theme.setTheme('light'),
  },
];

export default commands;
