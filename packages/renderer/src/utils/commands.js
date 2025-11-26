import emitter from 'tiny-emitter/instance';
import enTranslations from '@/assets/locales/en.json';
import itTranslations from '@/assets/locales/it.json';
import esTranslations from '@/assets/locales/es.json';
import deTranslations from '@/assets/locales/de.json';
import zhTranslations from '@/assets/locales/zh.json';
import nlTranslations from '@/assets/locales/nl.json';
import ukTranslations from '@/assets/locales/uk.json';

function getModifierKey() {
  return navigator.platform.includes('Mac') ? 'Cmd' : 'Ctrl';
}

const selectedLanguage = localStorage.getItem('selectedLanguage') || 'en';

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

if (selectedLanguage === 'es') {
  translations = esTranslations;
}

if (selectedLanguage === 'uk') {
  translations = ukTranslations;
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
