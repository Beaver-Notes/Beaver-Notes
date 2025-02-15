<!-- eslint-disable vue/multi-word-component-names -->
<template>
  <div class="inline-block input-ui">
    <label class="relative w-full">
      <span
        v-if="label"
        class="text-sm dark:text-neutral-200 text-neutral-600 mb-1 ml-1"
      >
        {{ label }}
      </span>
      <div class="flex items-center relative">
        <slot name="prepend">
          <v-remixicon
            v-if="prependIcon"
            class="ml-2 dark:text-neutral-200 text-neutral-600 absolute left-0"
            :name="prependIcon"
          ></v-remixicon>
        </slot>
        <input
          v-autofocus="autofocus"
          v-bind="{ readonly: disabled || readonly || null, placeholder, type }"
          class="py-2 px-4 rounded-lg w-full bg-input bg-transparent transition ring-2 ring-secondary"
          :class="{
            'opacity-75 pointer-events-none': disabled,
            'pl-10': prependIcon || $slots.prepend,
            'pr-10': clearable, // Add padding if clear button is visible
          }"
          :value="modelValue"
          @keydown="$emit('keydown', $event)"
          @input="emitValue"
        />
        <button
          v-if="clearable && modelValue"
          class="absolute right-2 text-neutral-600 dark:text-neutral-200"
          @click="clearInput"
        >
          <v-remixicon name="riDeleteBackLine" />
        </button>
      </div>
    </label>
  </div>
</template>

<script>
export default {
  props: {
    // eslint-disable-next-line vue/require-prop-types
    modelModifiers: {
      default: () => ({}),
    },
    disabled: {
      type: Boolean,
      default: false,
    },
    readonly: {
      type: Boolean,
      default: false,
    },
    autofocus: {
      type: Boolean,
      default: false,
    },
    modelValue: {
      type: String,
      default: '',
    },
    prependIcon: {
      type: String,
      default: '',
    },
    label: {
      type: String,
      default: '',
    },
    type: {
      type: String,
      default: 'text',
    },
    placeholder: {
      type: String,
      default: '',
    },
    clearable: {
      type: Boolean,
      default: false, // Add clearable prop
    },
  },
  emits: ['update:modelValue', 'change', 'keydown'],
  setup(props, { emit }) {
    function emitValue(event) {
      let { value } = event.target;

      if (props.modelModifiers.lowercase) {
        value = value.toLocaleLowerCase();
      }

      emit('update:modelValue', value);
      emit('change', value);
    }

    function clearInput() {
      emit('update:modelValue', '');
      emit('change', '');
    }

    return {
      emitValue,
      clearInput,
    };
  },
};
</script>
