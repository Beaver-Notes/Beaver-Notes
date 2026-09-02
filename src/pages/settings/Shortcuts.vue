<template>
  <div class="general space-y-6 mb-14 w-full max-w-xl">
    <settings-group
      v-for="shortcut in shortcuts"
      :key="shortcut.title"
      :title="translations.shortcuts[shortcut.title] || '-'"
    >
      <div
        v-for="item in shortcut.items"
        :key="item.name"
        class="flex items-center gap-3 px-4 py-2.5"
      >
        <p class="flex-1 text-sm text-neutral-700 dark:text-neutral-200">
          {{
            translations.shortcuts[item.name] ||
            translations.sidebar[item.name]
          }}
        </p>
        <span class="flex items-center gap-1 shrink-0">
          <template v-for="(key, idx) in item.keys" :key="key">
            <span v-if="idx > 0" class="text-xs text-neutral-400 select-none">+</span>
            <kbd>
              {{
                key === 'Drag'
                  ? translations.shortcuts.drag
                  : key === 'Arrow left'
                  ? translations.shortcuts.arrowLeft
                  : getFormattedKey(key)
              }}
            </kbd>
          </template>
        </span>
      </div>
    </settings-group>
  </div>
</template>

// ponytail: customizable shortcuts explored — needs settings key for keybinding map + backend persistence + conflict UI; defer until requested.
<script setup>
import { useTranslations } from '@/composable/useTranslations';
import { isMacOSRuntime } from '@/lib/tauri/runtime';
import SettingsGroup from '@/components/settings/SettingsGroup.vue';

const { translations } = useTranslations();

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
  return isMacOSRuntime();
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
