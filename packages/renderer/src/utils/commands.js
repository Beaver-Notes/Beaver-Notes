import emitter from 'tiny-emitter/instance';
import { useTheme } from '../composable/theme';
import enTranslations from '../pages/settings/locales/en.json';
import itTranslations from '../pages/settings/locales/it.json';
import esTranslations from '../pages/settings/locales/es.json';
import deTranslations from '../pages/settings/locales/de.json';
import zhTranslations from '../pages/settings/locales/zh.json';
import nlTranslations from '../pages/settings/locales/nl.json';

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

let commands = [
  {
    id: 'new-note',
    title: translations.commands.newnote,
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
    title: translations.commands.darktheme,
    handler: () => theme.setTheme('dark'),
  },
  {
    id: 'light-theme',
    title: translations.commands.lighttheme,
    handler: () => theme.setTheme('light'),
  },
];

export default commands;
