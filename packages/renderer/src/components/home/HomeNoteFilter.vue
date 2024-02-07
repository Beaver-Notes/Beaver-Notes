<template>
  <div class="flex items-start mb-6 space-x-4">
    <div class="flex-1">
      <ui-input
        :model-value="query"
        class="w-full note-search-input"
        prepend-icon="riSearch2Line"
        :placeholder="translations.filter.searchplaceholder || '-'"
        @keydown.esc="$event.target.blur()"
        @change="$emit('update:query', $event.toLocaleLowerCase())"
      />
      <span class="text-sm text-gray-600 dark:text-gray-300 ml-2">
        {{ keyBinding }} {{ translations.filter.search || '-' }}
      </span>
    </div>
    <div class="flex items-center divide-x btn-group">
      <ui-button
        v-tooltip="
          label === ''
            ? translations.filter.Selectlabel
            : translations.filter.deletelabel
        "
        icon
        class="rounded-r-none"
        @click="$emit('delete:label', label)"
      >
        <v-remixicon
          :name="label === '' ? 'riPriceTag3Line' : 'riDeleteBin6Line'"
        />
      </ui-button>
      <ui-select
        :model-value="label"
        :placeholder="translations.filter.Selectlabel || '-'"
        @change="$emit('update:label', $event)"
      >
        <option v-for="item in labels" :key="item" :valye="item">
          {{ item }}
        </option>
      </ui-select>
    </div>
    <div class="flex items-center divide-x btn-group">
      <ui-button
        v-tooltip="
          sortOrder === 'asc'
            ? translations.filter.ascending
            : translations.filter.discending
        "
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
import { onUnmounted, onMounted, shallowReactive, computed } from 'vue';
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

    const translations = shallowReactive({
      filter: {
        Selectlabel: 'filter.Selectlabel',
        search: 'filter.search',
        searchplaceholder: 'filter.searchplaceholder',
        Alphabetical: 'filter.Alphabetical',
        Createddate: 'filter.Createddate',
        deletelabel: 'filter.deletelabel',
        ascending: 'filter.ascending',
        descending: 'filter.descending',
      },
    });

    const sorts = computed(() => {
      return {
        title: translations.filter.Alphabetical,
        createdAt: translations.filter.Createddate,
        updatedAt: translations.filter.Lastupdated,
      };
    });

    Mousetrap.bind(isMacOS ? 'mod+f' : 'ctrl+f', () => {
      document.querySelector('.note-search-input input')?.focus();
    });

    onUnmounted(() => {
      Mousetrap.unbind(isMacOS ? 'mod+f' : 'ctrl+f');
    });

    onMounted(async () => {
      // Load translations
      const loadedTranslations = await loadTranslations();
      if (loadedTranslations) {
        Object.assign(translations, loadedTranslations);
      }
    });

    const loadTranslations = async () => {
      const selectedLanguage = localStorage.getItem('selectedLanguage') || 'en';
      try {
        const translationModule = await import(
          `../../pages/settings/locales/${selectedLanguage}.json`
        );
        return translationModule.default;
      } catch (error) {
        console.error('Error loading translations:', error);
        return null;
      }
    };

    return {
      sorts,
      keyBinding,
      translations,
    };
  },
};
</script>

<style>
.btn-group .ui-select__content {
  @apply rounded-l-none;
}
</style>
