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
            {{
              key === 'Drag'
                ? translations.shortcuts.drag
                : key === 'Arrow left'
                ? translations.shortcuts.arrowLeft
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
    title: 'general',
    items: [
      { name: 'createNewNote', keys: getFormattedKeys(['Ctrl', 'N']) },
      {
        name: 'toggleCommandPrompt',
        keys: getFormattedKeys(['Ctrl', 'Shift', 'P']),
      },
      {
        name: 'toggleDarkTheme',
        keys: getFormattedKeys(['Ctrl', 'Shift', 'L']),
      },
      { name: 'toggleSync', keys: getFormattedKeys(['Ctrl', 'Shift', 'Y']) },
    ],
  },
  {
    title: 'navigates',
    items: [
      {
        name: 'toEditedNote',
        keys: getFormattedKeys(['Ctrl', 'Shift', 'W']),
      },
      { name: 'toNotes', keys: getFormattedKeys(['Ctrl', 'Shift', 'N']) },
      {
        name: 'toArchivedNotes',
        keys: getFormattedKeys(['Ctrl', 'Shift', 'A']),
      },
      { name: 'toSettings', keys: getFormattedKeys(['Ctrl', ',']) },
    ],
  },
  {
    title: 'editor',
    items: [
      { name: 'bold', keys: getFormattedKeys(['Ctrl', 'B']) },
      { name: 'italic', keys: getFormattedKeys(['Ctrl', 'I']) },
      { name: 'underline', keys: getFormattedKeys(['Ctrl', 'U']) },
      { name: 'link', keys: getFormattedKeys(['Ctrl', 'K']) },
      { name: 'strikethrough', keys: getFormattedKeys(['Ctrl', 'Shift', 'X']) },
      { name: 'highlight', keys: getFormattedKeys(['Ctrl', 'Shift', 'H']) },
      { name: 'superscript', keys: getFormattedKeys(['Ctrl', '.']) },
      { name: 'subscript', keys: getFormattedKeys(['Alt', ',']) },
      { name: 'inlineCode', keys: getFormattedKeys(['Ctrl', 'E']) },
      {
        name: 'headings',
        keys: getFormattedKeys(['Ctrl', 'Alt', '(1-6)']),
      },
      { name: 'orderedList', keys: getFormattedKeys(['Ctrl', 'Shift', '7']) },
      { name: 'bulletList', keys: getFormattedKeys(['Ctrl', 'Shift', '8']) },
      { name: 'blockQuote', keys: getFormattedKeys(['Ctrl', 'Shift', 'B']) },
      { name: 'codeBlock', keys: getFormattedKeys(['Ctrl', 'Alt', 'C']) },
      { name: 'previousNote', keys: getFormattedKeys(['Alt', 'Arrow left']) },
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
