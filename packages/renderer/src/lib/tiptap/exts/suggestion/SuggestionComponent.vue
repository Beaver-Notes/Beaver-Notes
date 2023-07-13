<template>
  <ui-card
    class="border max-w-xs"
    padding="p-2"
    style="max-width: 16rem; min-width: 6rem"
  >
    <ui-list class="cursor-pointer space-y-1">
      <p v-if="items.length === 0 && query.length === 0" class="text-center">
        No data
      </p>
      <template v-else>
        <ui-list-item
          v-for="(item, index) in items"
          :key="index"
          :active="index === selectedIndex"
          class="label-item w-full text-overflow"
          @click="selectItem(index)"
        >
          <p class="text-overflow">{{ getLabel(item) || 'Untitled' }}</p>
        </ui-list-item>
      </template>
      <ui-list-item
        v-if="showAdd && query.length !== 0"
        :active="items.length === selectedIndex"
        class="text-overflow w-full"
        @click="onAdd(query, command)"
      >
        <v-remixicon name="riAddLine" class="mr-2" />
        Add "<strong class="text-overflow"> {{ query.slice(0, 50) }} </strong>"
      </ui-list-item>
    </ui-list>
  </ui-card>
</template>

<script setup>
/* eslint-disable no-undef */
import { watch, ref } from 'vue';

const props = defineProps({
  onSelect: Function,
  labelKey: {
    type: String,
    default: '',
  },
  range: {
    type: Object,
    default: () => ({}),
  },
  onAdd: {
    type: Function,
    default: () => {},
  },
  command: {
    type: Function,
    required: true,
  },
  editor: {
    type: Object,
    default: () => ({}),
  },
  query: {
    type: String,
    default: '',
  },
  items: {
    type: Array,
    default: () => [],
  },
  showAdd: {
    type: Boolean,
    default: false,
  },
});

const selectedIndex = ref(0);

function getLabel(item) {
  if (props.labelKey) {
    return item[props.labelKey];
  }

  return item;
}
function onKeyDown({ event }) {
  switch (event.key) {
    case 'ArrowUp':
      upHandler();
      return true;
    case 'ArrowDown':
      downHandler();
      return true;
    case 'Enter':
      enterHandler();
      return true;
    default:
      return false;
  }
}
function upHandler() {
  selectedIndex.value =
    (selectedIndex.value + props.items.length - 1) % props.items.length;
}
function downHandler() {
  const itemsLength =
    props.items.length + (props.showAdd && props.query !== '' ? 1 : 0);
  selectedIndex.value = (selectedIndex.value + 1) % itemsLength;
}
function enterHandler() {
  selectItem(selectedIndex.value);
}
function selectItem(index) {
  const item = props.items[index];

  if (item) {
    props.onSelect({ item, ...props });
  } else if (props.showAdd && props.query !== '') {
    props.onAdd(props.query, props.command);
  }
}

watch(
  () => props.items,
  () => {
    selectedIndex.value = 0;
  }
);

defineExpose({ onKeyDown });
</script>
