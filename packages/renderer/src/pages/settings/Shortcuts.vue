<!-- eslint-disable vue/multi-word-component-names -->
<template>
  <div class="general space-y-8 w-full max-w-xl">
    <section v-for="shortcut in shortcuts" :key="shortcut.title">
      <p class="mb-2">{{ translations.shortcuts[shortcut.title] || '-' }}</p>
      <ui-list class="rounded-lg">
        <ui-list-item v-for="item in shortcut.items" :key="item.name">
          <p class="flex-1">{{ translations.shortcuts[item.name] || '-' }}</p>
          <kbd v-for="key in item.keys" :key="key" class="mr-1">{{
            getFormattedKey(key)
          }}</kbd>
        </ui-list-item>
      </ui-list>
    </section>
  </div>
</template>

<script setup>
import { onMounted, shallowReactive } from 'vue';

const shortcuts = [
  {
    title: 'General',
    items: [
      { name: 'Createnewnote', keys: getFormattedKeys(['Ctrl', 'N']) },
      { name: 'Togglecommandprompt', keys: getFormattedKeys(['Ctrl', 'P']) },
      {
        name: 'Toggledarktheme',
        keys: getFormattedKeys(['Ctrl', 'Shift', 'L']),
      },
      { name: 'Toggleexport', keys: getFormattedKeys(['Ctrl', 'Shift', 'E']) },
      { name: 'Toggleimport', keys: getFormattedKeys(['Ctrl', 'Shift', 'I']) },
    ],
  },
  {
    title: 'Navigates',
    items: [
      {
        name: 'Toeditednote',
        keys: getFormattedKeys(['Ctrl', 'Shift', 'W']),
      },
      { name: 'Tonotes', keys: getFormattedKeys(['Ctrl', 'Shift', 'N']) },
      {
        name: 'Toarchivednotes',
        keys: getFormattedKeys(['Ctrl', 'Shift', 'A']),
      },
      { name: 'Tosettings', keys: getFormattedKeys(['Ctrl', ',']) },
    ],
  },
  {
    title: 'Editor',
    items: [
      { name: 'Bold', keys: getFormattedKeys(['Ctrl', 'B']) },
      { name: 'Italic', keys: getFormattedKeys(['Ctrl', 'I']) },
      { name: 'Underline', keys: getFormattedKeys(['Ctrl', 'U']) },
      { name: 'Link', keys: getFormattedKeys(['Ctrl', 'K']) },
      { name: 'Strikethrough', keys: getFormattedKeys(['Ctrl', 'Shift', 'X']) },
      { name: 'Highlight', keys: getFormattedKeys(['Ctrl', 'Shift', 'E']) },
      { name: 'Inlinecode', keys: getFormattedKeys(['Ctrl', 'E']) },
      {
        name: 'Headings',
        keys: getFormattedKeys(['Ctrl', 'Alt', '(1-6)']),
      },
      { name: 'Orderedlist', keys: getFormattedKeys(['Ctrl', 'Shift', '7']) },
      { name: 'Bulletlist', keys: getFormattedKeys(['Ctrl', 'Shift', '8']) },
      { name: 'Blockquote', keys: getFormattedKeys(['Ctrl', 'Shift', 'B']) },
      { name: 'Blockcode', keys: getFormattedKeys(['Ctrl', 'Alt', 'C']) },
      { name: 'Previousnote', keys: getFormattedKeys(['Alt', 'Arrow left']) },
    ],
  },
];

// Translations

const translations = shallowReactive({
  shortcuts: {
    General: 'shortcuts.General',
    Navigates: 'shortcuts.Navigates',
    Editor: 'shortcuts.Editor',
    Createnewnote: 'shortcuts.Createnewnote',
    Togglecommandprompt: 'shortcuts.Togglecommandprompt',
    Toggledarktheme: 'shortcuts.Toggledarktheme',
    Toggleexport: 'shortcuts.Toggleexport',
    Toggleimport: 'shortcuts.Toggleimport',
    Toeditednote: 'shortcuts.Toeditednote',
    Tonotes: 'shortcuts.Tonotes',
    Toarchivednotes: 'shortcuts.Toarchivednotes',
    Tosettings: 'shortcuts.Tosettings',
    Bold: 'shortcuts.Bold',
    Italic: 'shortcuts.Italic',
    Underline: 'shortcuts.Underline',
    Link: 'shortcuts.Link',
    Strikethrough: 'shortcuts.Strikethrough',
    Highlight: 'shortcuts.Highlight',
    Inlinecode: 'shortcuts.Inlinecode',
    Headings: 'shortcuts.Headings',
    Orderedlist: 'shortcuts.Orderedlist',
    Bulletlist: 'shortcuts.Bulletlist',
    Blockquote: 'shortcuts.Blockquote',
    Blockcode: 'shortcuts.Blockcode',
    Previousnote: 'shortcuts.Previousnote',
  },
});

onMounted(async () => {
  const loadedTranslations = await loadTranslations();
  if (loadedTranslations) {
    Object.assign(translations, loadedTranslations);
  }
});

const loadTranslations = async () => {
  const selectedLanguage = localStorage.getItem('selectedLanguage') || 'en';
  try {
    const translationModule = await import(
      `./locales/${selectedLanguage}.json`
    );
    return translationModule.default;
  } catch (error) {
    console.error('Error loading translations:', error);
    return null;
  }
};

function getFormattedKey(key) {
  if (isMacOS()) {
    return key.replace('Ctrl', 'Cmd');
  }
  return key;
}

function getFormattedKeys(keys) {
  if (isMacOS()) {
    return keys.map((key) => key.replace('Ctrl', 'Cmd'));
  }
  return keys;
}

function isMacOS() {
  return navigator.platform.toUpperCase().indexOf('MAC') >= 0;
}
</script>

<style scoped>
section p.flex-1 {
  @apply dark:text-gray-200 text-gray-600;
}
section .ui-list {
  @apply bg-gray-800 bg-opacity-5 dark:bg-gray-200 dark:bg-opacity-5;
}
</style>
