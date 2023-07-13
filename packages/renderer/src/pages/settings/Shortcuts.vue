<template>
  <div class="general space-y-8 w-full max-w-xl">
    <section v-for="shortcut in shortcuts" :key="shortcut.title">
      <p class="mb-2">{{ shortcut.title }}</p>
      <ui-list class="rounded-lg">
        <ui-list-item v-for="item in shortcut.items" :key="item.name">
          <p class="flex-1">{{ item.name }}</p>
          <kbd v-for="key in item.keys" :key="key" class="mr-1">{{ getFormattedKey(key) }}</kbd>
        </ui-list-item>
      </ui-list>
    </section>
  </div>
</template>

<script setup>
const shortcuts = [
  {
    title: 'General shortcuts',
    items: [
      { name: 'Create new note', keys: getFormattedKeys(['Ctrl', 'N']) },
      { name: 'Toggle command prompt', keys: getFormattedKeys(['Ctrl', 'P']) },
      { name: 'Toggle dark theme', keys: getFormattedKeys(['Ctrl', 'Shift', 'L']) },
    ],
  },
  {
    title: 'Navigates shortcuts',
    items: [
      { name: 'To edited note', keys: getFormattedKeys(['Ctrl', 'Shift', 'W']) },
      { name: 'To notes', keys: getFormattedKeys(['Ctrl', 'Shift', 'N']) },
      { name: 'To archived notes', keys: getFormattedKeys(['Ctrl', 'Shift', 'A']) },
      { name: 'To settings', keys: getFormattedKeys(['Ctrl', ',']) },
    ],
  },
  {
    title: 'Editor shortcuts',
    items: [
      { name: 'Bold', keys: getFormattedKeys(['Ctrl', 'B']) },
      { name: 'Italic', keys: getFormattedKeys(['Ctrl', 'I']) },
      { name: 'Underline', keys: getFormattedKeys(['Ctrl', 'U']) },
      { name: 'Link', keys: getFormattedKeys(['Ctrl', 'K']) },
      { name: 'Strikethrough', keys: getFormattedKeys(['Ctrl', 'Shift', 'X']) },
      { name: 'Highlight', keys: getFormattedKeys(['Ctrl', 'Shift', 'E']) },
      { name: 'Inline code', keys: getFormattedKeys(['Ctrl', 'E']) },
      { name: 'Headings (1-6)', keys: getFormattedKeys(['Ctrl', 'Alt', '(1-6)']) },
      { name: 'Ordered list', keys: getFormattedKeys(['Ctrl', 'Shift', '7']) },
      { name: 'Bullet list', keys: getFormattedKeys(['Ctrl', 'Shift', '8']) },
      { name: 'Blockquote', keys: getFormattedKeys(['Ctrl', 'Shift', 'B']) },
      { name: 'Block code', keys: getFormattedKeys(['Ctrl', 'Alt', 'C']) },
      { name: 'Previous note', keys: getFormattedKeys(['Alt', 'Arrow left']) },
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
    return keys.map(key => key.replace('Ctrl', 'Cmd'));
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
