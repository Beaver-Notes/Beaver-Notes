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
          />
        </slot>

        <input
          v-autofocus="autofocus"
          v-bind="{
            readonly: disabled || readonly || null,
            placeholder,
            type: inputType,
          }"
          class="py-2 px-4 rounded-lg w-full bg-input bg-transparent transition focus:ring-2 ring-secondary"
          :class="{
            'opacity-75 pointer-events-none': disabled,
            'pl-10': prependIcon || $slots.prepend,
            'pr-24': hasRightButtons, // Enough padding for both buttons
          }"
          :value="modelValue"
          @keydown="$emit('keydown', $event)"
          @input="emitValue"
        />

        <div
          v-if="hasRightButtons"
          class="absolute right-2 top-1/2 transform -translate-y-1/2 flex items-center gap-2"
        >
          <button
            v-if="password"
            type="button"
            class="text-sm text-secondary"
            @click="toggleVisibility"
          >
            <v-remixicon
              :name="visible ? 'riEyeCloseLine' : 'riEyeLine'"
              class="text-2xl"
            />
          </button>

          <button
            v-if="clearable && modelValue"
            type="button"
            class="text-neutral-600 dark:text-neutral-200"
            @click="clearInput"
          >
            <v-remixicon name="riDeleteBackLine" />
          </button>
        </div>
      </div>
    </label>
  </div>
</template>

<script>
import { ref, computed } from 'vue';

export default {
  props: {
    modelModifiers: {
      type: Object,
      default: () => ({}),
    },
    disabled: Boolean,
    readonly: Boolean,
    autofocus: Boolean,
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
      default: false,
    },
    password: {
      type: Boolean,
      default: false,
    },
  },
  emits: ['update:modelValue', 'change', 'keydown'],
  setup(props, { emit }) {
    const visible = ref(false);

    const inputType = computed(() => {
      if (props.password) {
        return visible.value ? 'text' : 'password';
      }
      return props.type;
    });

    const hasRightButtons = computed(() => {
      return props.password || (props.clearable && props.modelValue.length > 0);
    });

    function emitValue(event) {
      let value = event.target.value;

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

    function toggleVisibility() {
      visible.value = !visible.value;
    }

    return {
      emitValue,
      clearInput,
      toggleVisibility,
      visible,
      inputType,
      hasRightButtons,
    };
  },
};
</script>
