import emitter from 'tiny-emitter/instance';
import { useTheme } from '../composable/theme';
import enTranslations from '@/assets/locales/en.json';
import itTranslations from '@/assets/locales/it.json';
import esTranslations from '@/assets/locales/es.json';
import deTranslations from '@/assets/locales/de.json';
import zhTranslations from '@/assets/locales/zh.json';
import nlTranslations from '@/assets/locales/nl.json';
import ukTranslations from '@/assets/locales/uk.json';

const theme = useTheme();

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
    shortcut: [getModifierKey(), 'N'],
    handler: () => emitter.emit('new-note'),
  },
  {
    id: 'settings',
    title: translations.commands.settings,
    shortcut: [getModifierKey(), ','],
    handler: () => emitter.emit('open-settings'),
  },
  {
    id: 'dark-theme',
    title: translations.commands.darkTheme,
    handler: () => theme.setTheme('dark'),
  },
  {
    id: 'light-theme',
    title: translations.commands.lightTheme,
    handler: () => theme.setTheme('light'),
  },
];

export default commands;
