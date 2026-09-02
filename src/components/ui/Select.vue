<template>
  <div :class="{ 'inline-block': !block }" class="ui-select">
    <label
      v-if="label"
      :for="selectId"
      class="text-neutral-200 text-sm ltr:ml-2 rtl:mr-2"
    >
      {{ label }}
    </label>

    <div
      class="ui-select__content flex items-center w-full block transition focus-within:ring-1 ring-secondary bg-input rounded-lg appearance-none focus:outline-none relative"
    >
      <v-remixicon
        v-if="prependIcon"
        :name="prependIcon"
        class="absolute text-neutral-600 dark:text-neutral-200 ltr:left-0 rtl:right-0 ltr:ml-2 rtl:mr-2"
      />

      <button
        :id="selectId"
        ref="selectButton"
        :class="[
          prependIcon ? 'ltr:pl-8 rtl:pr-8' : '',
          'px-4 ltr:pr-8 rtl:pl-8 py-2 z-10 w-full h-full ltr:text-left rtl:text-right bg-transparent focus:outline-none',
        ]"
        type="button"
        :aria-labelledby="label ? `${selectId}-label` : undefined"
        :aria-haspopup="true"
        :aria-expanded="isOpen"
        @click="toggle"
        @keydown="onKeydown"
        @blur="handleBlur"
      >
        <span v-if="selectedText" class="block truncate">
          {{ selectedText }}
        </span>
        <span v-else-if="placeholder" class="block truncate text-neutral-500">
          {{ placeholder }}
        </span>
      </button>

      <!-- Dropdown Arrow (rotate only when open, not for RTL) -->
      <v-remixicon
        name="riArrowDownSLine"
        :class="{ 'rotate-180': isOpen }"
        class="absolute ltr:right-2 rtl:left-2 top-1/2 -translate-y-1/2 text-neutral-600 dark:text-neutral-200 transition-transform duration-200 pointer-events-none"
      />

      <!-- Dropdown Menu (teleported so it is never clipped by an
           overflow/scrolling ancestor like the onboarding modal) -->
      <Teleport to="body">
        <Transition
          enter-active-class="transition duration-200 ease-[var(--ease-standard)]"
          enter-from-class="opacity-0 scale-95"
          enter-to-class="opacity-100 scale-100"
          leave-active-class="transition duration-150 ease-out"
          leave-from-class="opacity-100 scale-100"
          leave-to-class="opacity-0 scale-95"
        >
          <div
            v-show="isOpen"
            ref="dropdown"
            :style="[floatingStyles, { width: dropdownWidth ? dropdownWidth + 'px' : 'auto' }]"
            class="bg-white dark:bg-neutral-900 border rounded-xl shadow-xl z-50 p-1.5 origin-top"
            role="listbox"
            :aria-activedescendant="focusedIndex >= 0 ? `${selectId}-option-${focusedIndex}` : undefined"
          >
          <div v-if="search" class="mb-2">
            <ui-input
              ref="searchInput"
              v-model="searchQuery"
              type="text"
              :placeholder="translations.index.search"
              class="w-full"
              @keydown="onSearchKeydown"
            />
          </div>

          <div class="max-h-48 overflow-y-auto space-y-0.5">
            <div
              v-if="placeholder && !hideePlaceholderInDropdown"
              class="p-1.5 rounded-lg hover:bg-neutral-100 dark:hover:bg-neutral-700 text-neutral-500 transition-colors"
              :class="{
                'bg-neutral-100 dark:bg-neutral-700': modelValue === '',
              }"
              @click="select({ value: '', text: placeholder })"
            >
              {{ placeholder }}
            </div>

            <div
              v-for="(option, index) in filteredOptions"
              :key="`${option.value}-${index}`"
              :ref="(el) => setOptionRef(el, index)"
              :id="`${selectId}-option-${index}`"
              class="p-1.5 rounded-lg hover:bg-neutral-100 dark:hover:bg-neutral-700 transition-colors"
              role="option"
              :aria-selected="option.value === String(modelValue)"
              :class="{
                'bg-neutral-100 dark:bg-neutral-700':
                  option.value === String(modelValue) ||
                  (index === focusedIndex && !option.disabled),
                'opacity-50 cursor-not-allowed': option.disabled,
              }"
              @click="select(option)"
            >
              {{ option.text }}
            </div>

            <div
              v-if="search && searchQuery && filteredOptions.length === 0"
              class="p-1.5 rounded-lg text-neutral-500 text-center"
            >
              {{ translations.index?.notFound || 'No options found' }}
            </div>
          </div>
        </div>
        </Transition>
      </Teleport>
    </div>
  </div>
</template>

<script>
import { ref, computed, onMounted, onUnmounted, nextTick, watch } from 'vue';
import { useFloating, offset, flip, shift, autoUpdate } from '@floating-ui/vue';
import { useTranslations } from '@/composable/useTranslations';
import { useScrollLock } from '@/utils/ui/scrollLock.js';

export default {
  props: {
    modelValue: [String, Number],
    label: String,
    prependIcon: String,
    placeholder: String,
    block: Boolean,
    search: Boolean,
    hideePlaceholderInDropdown: {
      type: Boolean,
      default: false,
    },
    options: {
      type: Array,
      default: () => [],
    },
  },
  emits: ['update:modelValue', 'change'],
  setup(props, { emit, slots }) {
    const selectId = `select-${Math.random().toString(36).substr(2, 9)}`;
    const selectButton = ref(null);
    const dropdown = ref(null);
    const searchInput = ref(null);
    const isOpen = ref(false);
    const focusedIndex = ref(-1);
    const searchQuery = ref('');
    const optionRefs = ref([]);
    const dropdownWidth = ref(0);
    const { translations } = useTranslations();

    const { floatingStyles } = useFloating(selectButton, dropdown, {
      placement: 'bottom-start',
      middleware: [offset(6), flip(), shift({ padding: 8 })],
      whileElementsMounted: autoUpdate,
    });

    const setOptionRef = (el, index) => {
      if (el) {
        optionRefs.value[index] = el;
      }
    };

    watch(focusedIndex, async (newIndex) => {
      if (newIndex >= 0 && isOpen.value) {
        await nextTick();
        const focusedElement = optionRefs.value[newIndex];
        if (focusedElement && focusedElement.scrollIntoView) {
          focusedElement.scrollIntoView({
            block: 'center',
            behavior: 'smooth',
          });
        }
      }
    });

    const allOptions = computed(() => {
      if (props.options.length > 0) {
        return props.options.map((opt) =>
          typeof opt === 'string'
            ? { value: opt, text: opt, disabled: false }
            : { disabled: false, ...opt }
        );
      }

      const slotContent = slots.default?.();
      if (!slotContent) return [];

      const options = [];
      const parseVNode = (vnode) => {
        if (vnode?.type === 'option') {
          const value = vnode.props?.value ?? '';
          const text = vnode.children || value;
          options.push({
            value: String(value),
            text: String(text),
            disabled: !!vnode.props?.disabled,
          });
        } else if (Array.isArray(vnode)) {
          vnode.forEach(parseVNode);
        } else if (vnode?.children) {
          parseVNode(vnode.children);
        }
      };

      parseVNode(slotContent);
      return options;
    });

    const filteredOptions = computed(() => {
      if (!props.search || !searchQuery.value) return allOptions.value;

      const query = searchQuery.value.toLowerCase();
      return allOptions.value.filter((opt) =>
        opt.text.toLowerCase().includes(query)
      );
    });

    const selectedText = computed(() => {
      const option = allOptions.value.find(
        (opt) => opt.value === String(props.modelValue)
      );
      return option?.text || '';
    });

    const { lock: lockScroll, unlock: unlockScroll } = useScrollLock();

    const toggle = () => {
      if (!isOpen.value) {
        lockScroll();
      } else {
        unlockScroll();
      }
      isOpen.value = !isOpen.value;
      if (isOpen.value) {
        dropdownWidth.value = selectButton.value?.offsetWidth || 0;
        nextTick(() => {
          searchQuery.value = '';
          optionRefs.value = [];

          const currentIndex = filteredOptions.value.findIndex(
            (opt) => opt.value === String(props.modelValue)
          );
          focusedIndex.value = Math.max(0, currentIndex);

          if (props.search && searchInput.value) {
            searchInput.value.focus();
          }
        });
      } else {
        optionRefs.value = [];
      }
    };

    const select = (option) => {
      if (option.disabled) return;

      emit('update:modelValue', option.value);
      emit('change', option.value);
      isOpen.value = false;
      unlockScroll();
      selectButton.value?.focus();
    };

    const selectFocused = () => {
      const option = filteredOptions.value[focusedIndex.value];
      if (option && !option.disabled) {
        select(option);
      }
    };

    const moveFocus = (direction) => {
      const max = filteredOptions.value.length - 1;
      let newIndex = focusedIndex.value + direction;

      if (newIndex < 0) newIndex = max;
      if (newIndex > max) newIndex = 0;

      let attempts = 0;
      while (
        filteredOptions.value[newIndex]?.disabled &&
        attempts < filteredOptions.value.length
      ) {
        newIndex += direction;
        if (newIndex < 0) newIndex = max;
        if (newIndex > max) newIndex = 0;
        attempts++;
      }

      focusedIndex.value = newIndex;
    };

    const onKeydown = (e) => {
      if (!isOpen.value) {
        if (['Enter', ' ', 'ArrowDown', 'ArrowUp'].includes(e.key)) {
          e.preventDefault();
          toggle();
        }
        return;
      }

      switch (e.key) {
        case 'Escape':
          e.preventDefault();
          isOpen.value = false;
          unlockScroll();
          selectButton.value?.focus();
          break;
        case 'Enter':
        case ' ':
          e.preventDefault();
          selectFocused();
          break;
        case 'ArrowDown':
          e.preventDefault();
          moveFocus(1);
          break;
        case 'ArrowUp':
          e.preventDefault();
          moveFocus(-1);
          break;
      }
    };

    const onSearchKeydown = (e) => {
      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault();
          moveFocus(1);
          break;
        case 'ArrowUp':
          e.preventDefault();
          moveFocus(-1);
          break;
        case 'Enter':
          e.preventDefault();
          selectFocused();
          break;
        case 'Escape':
          e.preventDefault();
          isOpen.value = false;
          unlockScroll();
          selectButton.value?.focus();
          break;
      }
    };

    const handleBlur = () => {
      setTimeout(() => {
        if (!dropdown.value?.contains(document.activeElement)) {
          isOpen.value = false;
          unlockScroll();
        }
      }, 150);
    };

    const onClickOutside = (e) => {
      if (
        !selectButton.value?.contains(e.target) &&
        !dropdown.value?.contains(e.target)
      ) {
        isOpen.value = false;
        unlockScroll();
      }
    };

    onMounted(() => {
      document.addEventListener('click', onClickOutside);
    });

    onUnmounted(() => {
      document.removeEventListener('click', onClickOutside);
      if (isOpen.value) {
        unlockScroll();
      }
    });

    return {
      selectId,
      selectButton,
      dropdown,
      searchInput,
      isOpen,
      focusedIndex,
      searchQuery,
      selectedText,
      filteredOptions,
      optionRefs,
      dropdownWidth,
      floatingStyles,
      translations,
      setOptionRef,
      toggle,
      select,
      onKeydown,
      onSearchKeydown,
      handleBlur,
    };
  },
};
</script>

<style>
.ui-select__arrow {
  top: 50%;
  transform: translateY(-50%) rotate(90deg);
}

.ui-select .optgroup-container {
  @apply bg-neutral-100 dark:bg-neutral-700;
}

.ui-select .z-50 {
  z-index: 50;
}

/* Custom scrollbar for dropdown */
.ui-select .max-h-60::-webkit-scrollbar {
  width: 6px;
}

.ui-select .max-h-60::-webkit-scrollbar-track {
  @apply bg-neutral-200 dark:bg-neutral-900;
}

.ui-select .max-h-60::-webkit-scrollbar-thumb {
  @apply bg-neutral-400 dark:bg-neutral-600 rounded;
}

.ui-select .max-h-60::-webkit-scrollbar-thumb:hover {
  @apply bg-neutral-500 dark:bg-neutral-500;
}
</style>
