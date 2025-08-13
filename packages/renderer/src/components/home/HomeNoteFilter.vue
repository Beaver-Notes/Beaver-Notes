<template>
  <div class="flex items-start mb-6 space-x-4">
    <div class="flex-1 rtl:ml-4">
      <div class="flex items-center divide-x btn-group">
        <ui-input
          :model-value="query"
          class="w-full note-search-input"
          prepend-icon="riSearch2Line"
          :clearable="true"
          :placeholder="translations.filter.searchPlaceholder || '-'"
          @keydown.esc="$event.target.blur()"
          @change="$emit('update:query', $event.toLocaleLowerCase())"
        ></ui-input>
      </div>
      <span class="text-sm text-neutral-600 dark:text-neutral-300 ml-2">
        {{ keyBinding }} {{ translations.filter.search || '-' }}
      </span>
    </div>

    <div class="flex items-center divide-x btn-group">
      <ui-button
        v-tooltip="
          label === ''
            ? translations.filter.selectLabel
            : translations.filter.deleteLabel
        "
        icon
        class="ltr:rounded-r-none rtl:rounded-l-none"
        @click="deleteLabel"
      >
        <v-remixicon
          :name="label === '' ? 'riPriceTag3Line' : 'riDeleteBin6Line'"
        />
      </ui-button>
      <ui-select
        :model-value="newLabel"
        :placeholder="translations.filter.selectLabel || '-'"
        @change="$emit('update:label', $event)"
      >
        <option v-for="item in labels" :key="item" :value="item">
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
        class="ltr:rounded-r-none rtl:rounded-l-none"
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
import { watch, ref, onUnmounted, onMounted, computed } from 'vue';
import Mousetrap from '@/lib/mousetrap';
import { useTranslation } from '@/composable/translations';

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
  setup(props, { emit }) {
    const isMacOS = navigator.platform.toUpperCase().includes('MAC');
    const keyBinding = isMacOS ? 'Cmd' : 'Ctrl';
    const newLabel = ref(props.label);

    const translations = ref({ filter: {} });

    const sorts = computed(() => {
      return {
        title: translations.value.filter.alphabetical,
        createdAt: translations.value.filter.createdDate,
        updatedAt: translations.value.filter.lastUpdated,
      };
    });

    Mousetrap.bind(isMacOS ? 'mod+f' : 'ctrl+f', () => {
      document.querySelector('.note-search-input input')?.focus();
    });

    onUnmounted(() => {
      Mousetrap.unbind(isMacOS ? 'mod+f' : 'ctrl+f');
    });

    onMounted(async () => {
      await useTranslation().then((trans) => {
        if (trans) {
          translations.value = trans;
        }
      });
    });

    const clearSearch = () => {
      emit('update:query', '');
    };

    watch(
      () => props.label,
      (newLabelValue) => {
        newLabel.value = newLabelValue;
      }
    );

    const deleteLabel = async () => {
      emit('delete:label', props.label);
      newLabel.value = '';
    };

    return {
      sorts,
      keyBinding,
      translations,
      newLabel,
      deleteLabel,
      clearSearch,
    };
  },
};
</script>

<style>
.btn-group .ui-select__content {
  @apply rounded-l-none;
}
</style>
