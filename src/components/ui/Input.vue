<!-- eslint-disable vue/multi-word-component-names -->
<template>
  <div class="inline-block input-ui w-full">
    <label class="relative w-full">
      <span
        v-if="label"
        class="text-sm dark:text-neutral-200 text-neutral-600 mb-1 ml-1"
      >
        {{ label }}
      </span>

      <div
        class="flex items-center gap-2 rounded-lg w-full bg-input bg-transparent transition border focus-within:ring-1 ring-secondary px-3 py-2"
        :class="{ 'opacity-75 pointer-events-none': disabled }"
        @click="focusInput"
      >
        <slot name="prepend">
          <v-remixicon
            v-if="prependIcon"
            class="shrink-0 dark:text-neutral-200 text-neutral-600"
            :name="prependIcon"
          />
        </slot>

        <div class="flex items-center gap-2 flex-1 min-w-0 flex-wrap">
          <slot name="before" />

          <div class="relative flex-1 min-w-[120px]">
            <slot name="overlay" />

            <input
              ref="inputRef"
              v-autofocus="autofocus"
              v-bind="{
                readonly: disabled || readonly || null,
                placeholder,
                type: inputType,
              }"
              class="w-full bg-transparent outline-none border-0 p-0"
              :value="modelValue"
              @keydown="$emit('keydown', $event)"
              @input="emitValue"
              @blur="$emit('blur', $event)"
            />
          </div>
        </div>

        <div
          v-if="hasRightButtons || $slots.append"
          class="flex items-center gap-2 shrink-0"
        >
          <slot name="append" />

          <button
            v-if="password"
            type="button"
            class="text-sm text-secondary"
            @click.stop="toggleVisibility"
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
            @click.stop="clearInput"
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
  emits: ['update:modelValue', 'change', 'keydown', 'blur'],
  setup(props, { emit, expose }) {
    const visible = ref(false);
    const inputRef = ref(null);

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
      focusInput();
    }

    function toggleVisibility() {
      visible.value = !visible.value;
    }

    function focusInput() {
      inputRef.value?.focus();
    }

    expose({ focus: focusInput });

    return {
      inputRef,
      emitValue,
      clearInput,
      toggleVisibility,
      focusInput,
      visible,
      inputType,
      hasRightButtons,
    };
  },
};
</script>
