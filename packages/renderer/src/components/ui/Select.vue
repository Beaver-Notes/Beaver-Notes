<!-- eslint-disable vue/multi-word-component-names -->
<template>
  <div
    :class="{ 'inline-block': !block }"
    class="ui-select cursor-pointer rtl:-rotate-180"
  >
    <label v-if="label" :for="selectId" class="text-neutral-200 text-sm ml-2">
      {{ label }}
    </label>
    <div
      class="ui-select__content flex items-center w-full block transition focus-within:ring-2 ring-secondary bg-input rounded-lg appearance-none focus:outline-none relative"
    >
      <v-remixicon
        v-if="prependIcon"
        size="20"
        :name="prependIcon"
        class="absolute text-neutral-600 dark:text-neutral-200 left-0 ml-2"
      />
      <select
        :id="selectId"
        :class="{ 'pl-8': prependIcon }"
        :value="modelValue"
        class="px-4 rtl:rotate-180 pr-8 bg-transparent py-2 z-10 appearance-none w-full h-full"
        @change="emitValue"
      >
        <option v-if="placeholder" value="" selected>
          {{ placeholder }}
        </option>
        <slot></slot>
      </select>
      <v-remixicon
        size="28"
        name="riArrowDropDownLine"
        class="absolute text-neutral-600 dark:text-neutral-200 mr-2 right-0 rtl:right-auto rtl:left-0"
      />
    </div>
  </div>
</template>
<script>
import { useComponentId } from '@/composable/componentId';

export default {
  props: {
    modelValue: {
      type: [String, Number],
      default: '',
    },
    label: {
      type: String,
      default: '',
    },
    prependIcon: {
      type: String,
      default: '',
    },
    placeholder: {
      type: String,
      default: '',
    },
    block: Boolean,
    showDetail: Boolean,
  },
  emits: ['update:modelValue', 'change'],
  setup(props, { emit }) {
    const selectId = useComponentId('select');

    function emitValue({ target }) {
      emit('update:modelValue', target.value);
      emit('change', target.value);
    }

    return {
      selectId,
      emitValue,
    };
  },
};
</script>
<style>
.ui-select__arrow {
  top: 50%;
  transform: translateY(-50%) rotate(90deg);
}
.ui-select option,
.ui-select optgroup {
  @apply bg-neutral-100 dark:bg-neutral-700;
}
</style>
