<!-- eslint-disable vue/multi-word-component-names -->
<template>
  <div class="general space-y-8 mb-14 w-full max-w-xl">
    <section v-for="shortcut in shortcuts" :key="shortcut.title">
      <p class="mb-2">{{ translations.shortcuts[shortcut.title] || '-' }}</p>
      <ui-list class="rounded-lg">
        <ui-list-item v-for="item in shortcut.items" :key="item.name">
          <p class="flex-1">
            {{
              translations.shortcuts[item.name] ||
              translations.sidebar[item.name]
            }}
          </p>
          <kbd v-for="key in item.keys" :key="key" class="mr-1">
            <!-- Directly include "Drag" and "Arrow left" -->
            {{
              key === 'Drag'
                ? translations.shortcuts.Drag
                : key === 'Arrow left'
                ? translations.shortcuts.Arrowleft
                : getFormattedKey(key)
            }}
          </kbd>
        </ui-list-item>
      </ui-list>
    </section>
  </div>
</template>

<script setup>
import { onMounted, ref } from 'vue';
import { useTranslation } from '@/composable/translations';

// Translations

const translations = ref({
  shortcuts: {},
  sidebar: {},
});

onMounted(async () => {
  await useTranslation().then((trans) => {
    if (trans) {
      translations.value = trans;
    }
  });
});
const shortcuts = [
  {
    title: 'General',
    items: [
      { name: 'Createnewnote', keys: getFormattedKeys(['Ctrl', 'N']) },
      {
        name: 'Togglecommandprompt',
        keys: getFormattedKeys(['Ctrl', 'Shift', 'P']),
      },
      {
        name: 'Toggledarktheme',
        keys: getFormattedKeys(['Ctrl', 'Shift', 'L']),
      },
      { name: 'toggleSync', keys: getFormattedKeys(['Ctrl', 'Shift', 'Y']) },
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
      { name: 'Highlight', keys: getFormattedKeys(['Ctrl', 'Shift', 'H']) },
      { name: 'SuperScript', keys: getFormattedKeys(['Ctrl', '.']) },
      { name: 'SubScript', keys: getFormattedKeys(['Alt', ',']) },
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
  @apply dark:text-neutral-200 text-neutral-600;
}
section .ui-list {
  @apply bg-neutral-800 bg-opacity-5 dark:bg-neutral-200 dark:bg-opacity-5;
}
</style>
