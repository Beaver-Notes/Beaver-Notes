<template>
  <div class="flex items-start mb-6 space-x-4">
    <div class="flex-1">
      <ui-input
        :model-value="query"
        class="w-full note-search-input"
        prepend-icon="riSearch2Line"
        placeholder="Search..."
        @keydown.esc="$event.target.blur()"
        @change="$emit('update:query', $event.toLocaleLowerCase())"
      />
      <span class="text-sm text-gray-600 dark:text-gray-300 ml-2">
        Press {{ keyBinding }}+F to start search
      </span>
    </div>
    <div class="flex items-center divide-x btn-group">
      <ui-button
        v-tooltip="label === '' ? 'Select label' : 'Delete current label'"
        icon
        class="rounded-r-none"
        @click="$emit('delete:label', label)"
      >
        <v-remixicon
          :name="label === '' ? 'riPriceTag3Line' : 'riDeleteBin6Line'"
        />
      </ui-button>
      <ui-select :model-value="label" @change="$emit('update:label', $event)">
        <option value="" selected>Select label</option>
        <option v-for="item in labels" :key="item" :valye="item">
          {{ item }}
        </option>
      </ui-select>
    </div>
    <div class="flex items-center divide-x btn-group">
      <ui-button
        v-tooltip="sortOrder === 'asc' ? 'Ascending' : 'Descending'"
        icon
        class="rounded-r-none"
        @click="$emit('update:sortOrder', sortOrder === 'asc' ? 'desc' : 'asc')"
      >
        <v-remixicon :name="sortOrder === 'asc' ? 'riSortAsc' : 'riSortDesc'" />
      </ui-button>
      <ui-select :model-value="sortBy" @change="$emit('update:sortBy', $event)">
        <option v-for="(name, id) in sorts" :key="id" :value="id">
          {{ name }}
        </option>
      </ui-select>
    </div>
  </div>
</template>

<script>
import { onUnmounted } from 'vue';
import Mousetrap from '@/lib/mousetrap';

export default {
  props: {
    sortOrder: {
      type: String,
      default: 'asc',
    },
    sortBy: {
      type: String,
      default: 'createdAt',
    },
    query: {
      type: String,
      default: '',
    },
    label: {
      type: String,
      default: '',
    },
    labels: {
      type: Object,
      default: () => ({}),
    },
  },
  emits: [
    'update:query',
    'update:label',
    'update:sortOrder',
    'update:sortBy',
    'delete:label',
  ],
  setup() {
    const isMacOS = navigator.platform.toUpperCase().includes('MAC');
    const keyBinding = isMacOS ? 'Cmd' : 'Ctrl';

    const sorts = {
      title: 'Alphabetical',
      createdAt: 'Created date',
      updatedAt: 'Last updated',
    };

    Mousetrap.bind(isMacOS ? 'mod+f' : 'ctrl+f', () => {
      document.querySelector('.note-search-input input')?.focus();
    });

    onUnmounted(() => {
      Mousetrap.unbind(isMacOS ? 'mod+f' : 'ctrl+f');
    });

    return {
      sorts,
      keyBinding,
    };
  },
};
</script>

<style>
.btn-group .ui-select__content {
  @apply rounded-l-none;
}
</style>
