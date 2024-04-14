<!-- eslint-disable vue/multi-word-component-names -->
<template>
  <label class="checkbox-ui inline-flex items-center">
    <div
      class="relative h-5 w-5 inline-block focus-within:ring-2 ring-amber-300 rounded"
    >
      <input
        type="checkbox"
        class="opacity-0 checkbox-ui__input"
        :value="modelValue"
        v-bind="{ checked: modelValue }"
        @change="changeHandler"
      />
      <div
        class="border rounded absolute top-0 left-0 bg-input checkbox-ui__mark cursor-pointer"
      >
        <v-remixicon
          name="riCheckLine"
          size="20"
          class="text-white"
        ></v-remixicon>
      </div>
    </div>
    <span v-if="$slots.default" class="ltr:ml-2 rtl:mr-2">
      <slot></slot>
    </span>
  </label>
</template>
<script>
export default {
  props: {
    modelValue: {
      type: Boolean,
      default: false,
    },
  },
  emits: ['update:modelValue', 'change'],
  setup(props, { emit }) {
    function changeHandler({ target: { checked } }) {
      emit('update:modelValue', checked);
      emit('change', checked);
    }

    return {
      changeHandler,
    };
  },
};
</script>
<style scoped>
.checkbox-ui {
  &__mark {
    width: 100%;
    height: 100%;
    transition-property: background-color, border-color;
    transition-timing-function: ease;
    transition-duration: 200ms;
    display: flex;
    align-items: center;
    justify-content: center;
    .remixicon-icon {
      transform: scale(0) !important;
      transition: transform 200ms ease;
    }
  }
  &__input:checked ~ &__mark {
    @apply bg-primary border-primary bg-opacity-100;
  }
  &__input:checked ~ &__mark .v-remixicon {
    transform: scale(1) !important;
  }
  .v-remixicon {
    transform: scale(0);
  }
}
</style>
