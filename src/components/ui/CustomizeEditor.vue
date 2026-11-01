<template>
  <ui-modal
    :model-value="modelValue"
    content-class="max-w-[420px]"
    :overlay-class="overlayClass"
    :persist="persist"
    @close="onCancel"
    @update:model-value="$emit('update:modelValue', $event)"
  >
    <template #header>
      <div
        v-if="pickerOpen"
        class="grid grid-cols-[auto_1fr_auto] items-center gap-2"
      >
        <button
          type="button"
          class="motion-press flex h-9 w-9 items-center justify-center rounded-lg text-neutral-500 hover:bg-neutral-100 hover:text-neutral-700 dark:text-neutral-400 dark:hover:bg-neutral-800 dark:hover:text-neutral-200"
          :aria-label="backLabel"
          @click="closePicker(true)"
        >
          <v-remixicon name="riArrowLeftLine" size="20" />
        </button>
        <h3 class="text-center font-semibold text-lg tracking-tight">
          {{ chooseIconLabel }}
        </h3>
        <button
          type="button"
          class="motion-press flex h-9 w-9 items-center justify-center rounded-lg text-neutral-500 hover:bg-neutral-100 hover:text-neutral-700 dark:text-neutral-400 dark:hover:bg-neutral-800 dark:hover:text-neutral-200"
          :aria-label="closeLabel"
          @click="onCancel"
        >
          <v-remixicon name="riCloseLine" size="20" />
        </button>
      </div>
      <div v-else class="relative flex items-center justify-center">
        <h3 class="font-semibold text-lg tracking-tight">{{ title }}</h3>
        <button
          type="button"
          class="motion-press absolute right-0 flex h-9 w-9 items-center justify-center rounded-lg text-neutral-500 hover:bg-neutral-100 hover:text-neutral-700 dark:text-neutral-400 dark:hover:bg-neutral-800 dark:hover:text-neutral-200"
          :aria-label="closeLabel"
          @click="onCancel"
        >
          <v-remixicon name="riCloseLine" size="20" />
        </button>
      </div>
    </template>

    <!-- Edit view: preview-is-editor, name, colors, quick icons. -->
    <div v-if="!pickerOpen" class="flex flex-col items-center gap-5 px-1 py-1">
      <button
        ref="previewRef"
        type="button"
        class="motion-press relative block rounded-2xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        :aria-label="chooseIconLabel"
        @click="openPicker"
      >
        <!-- Same construction as HomeFolderCard: tab + stacked sheets + gradient body. -->
        <span v-if="kind === 'folder'" class="relative block w-40 aspect-6/5">
          <span
            class="absolute top-[10%] left-0 z-0 h-[20%] w-[40%] rounded-tl-xl rounded-tr-md transition-colors"
            :style="{
              backgroundColor: draftColor,
              filter: 'saturate(0.8)',
            }"
          />
          <span
            class="absolute top-[20%] left-0 z-0 h-[80%] w-full rounded-xl rounded-tl-none transition-colors"
            :style="{
              backgroundColor: draftColor,
              filter: 'saturate(0.8)',
            }"
          />
          <span
            class="absolute top-[15%] left-[14%] z-10 h-[58%] w-[72%] rounded-lg border border-neutral-200 bg-white p-3 dark:border-neutral-300"
          >
            <span class="mb-2 block h-1 w-full rounded-full bg-neutral-100" />
            <span class="mb-2 block h-1 w-full rounded-full bg-neutral-100" />
            <span class="block h-1 w-2/3 rounded-full bg-neutral-100" />
          </span>
          <span
            class="absolute top-[23%] left-[21%] z-10 h-[64%] w-[72%] rotate-2 rounded-lg border border-neutral-200 bg-white p-4 dark:border-neutral-300"
          >
            <span class="mb-3 block h-2 w-12 rounded-full bg-blue-400/30" />
            <span class="mb-2 block h-1 w-full rounded-full bg-neutral-200" />
            <span class="mb-2 block h-1 w-full rounded-full bg-neutral-200" />
            <span class="block h-1 w-4/5 rounded-full bg-neutral-200" />
          </span>
          <span
            class="absolute bottom-0 left-0 z-20 flex h-[65%] w-full flex-col rounded-xl px-3 pb-2 pt-3"
            :style="folderBodyStyle"
          >
            <span class="flex min-h-0 flex-1 items-center justify-center">
              <span
                v-if="draftIcon"
                class="emoji-glyph text-3xl leading-none drop-shadow-sm"
                >{{ draftIcon }}</span
              >
              <v-remixicon
                v-else
                name="riFolder5Fill"
                class="size-8 text-white drop-shadow-sm"
              />
            </span>
            <span
              class="block truncate text-sm leading-tight font-bold text-white"
            >
              {{ draftName || namePlaceholder }}
            </span>
          </span>
        </span>
        <span
          v-else
          class="emoji-glyph flex h-20 w-20 items-center justify-center rounded-2xl text-4xl leading-none"
          :style="workspaceTileStyle"
          >{{ draftIcon }}</span
        >
        <span
          class="absolute -bottom-1 -right-1 flex h-6 w-6 items-center justify-center rounded-full bg-neutral-900 text-white ring-2 ring-white dark:bg-white dark:text-neutral-900 dark:ring-neutral-900"
          aria-hidden="true"
        >
          <v-remixicon name="riPencilLine" size="12" />
        </span>
      </button>

      <ui-input
        ref="nameInputRef"
        v-model="draftName"
        :placeholder="namePlaceholder"
        class="customize-name w-full"
        @keydown.enter="onPrimary"
      />

      <div
        class="-mx-3 flex items-center justify-center gap-1.5 px-3"
        role="group"
        :aria-label="colorLabel"
      >
        <button
          v-for="swatch in CUSTOMIZE_PALETTE"
          :key="swatch.hex"
          type="button"
          class="motion-press mobile:h-10 mobile:w-10 flex h-9 w-9 shrink-0 items-center justify-center rounded-full"
          :aria-label="swatch.label"
          :aria-pressed="isColorSelected(swatch.hex)"
          @click="draftColor = swatch.hex"
        >
          <span
            class="block h-6 w-6 rounded-full"
            :class="
              isColorSelected(swatch.hex)
                ? 'ring-2 ring-primary ring-offset-2 ring-offset-white dark:ring-offset-neutral-900'
                : 'ring-1 ring-black/10 dark:ring-white/10'
            "
            :style="{ backgroundColor: swatch.hex }"
          />
        </button>
        <label
          class="motion-press mobile:h-10 mobile:w-10 relative flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-full"
          :aria-label="customColorLabel"
        >
          <span
            class="block h-6 w-6 rounded-full"
            :class="
              isCustomColor
                ? 'ring-2 ring-primary ring-offset-2 ring-offset-white dark:ring-offset-neutral-900'
                : 'ring-1 ring-black/10 dark:ring-white/10'
            "
            style="
              background: conic-gradient(
                from 0deg,
                #ef4444,
                #fbbf24,
                #84cc16,
                #06b6d4,
                #3b82f6,
                #8b5cf6,
                #ec4899,
                #ef4444
              );
            "
            aria-hidden="true"
          />
          <input
            type="color"
            class="absolute inset-0 h-full w-full cursor-pointer opacity-0"
            :value="draftColor"
            tabindex="-1"
            aria-hidden="true"
            @input="draftColor = $event.target.value"
          />
        </label>
      </div>

      <!-- Name-based emoji suggestions (live emoji dataset search). -->
      <div
        v-if="suggestedIcons.length"
        class="flex w-full flex-wrap justify-center gap-1"
        role="group"
        :aria-label="chooseIconLabel"
      >
        <button
          v-for="emoji in suggestedIcons"
          :key="`suggested-${emoji}`"
          type="button"
          class="emoji-glyph motion-press flex h-9 w-9 items-center justify-center rounded-lg text-xl transition-colors duration-150 hover:bg-neutral-100 dark:hover:bg-neutral-800"
          :class="{
            'bg-primary/15 ring-1 ring-primary': emoji === draftIcon,
          }"
          :aria-label="emoji"
          :aria-pressed="emoji === draftIcon"
          @click="draftIcon = emoji"
        >
          {{ emoji }}
        </button>
      </div>

      <p v-if="error" class="text-sm text-red-500" role="alert">{{ error }}</p>
    </div>

    <!-- Picker view: same modal, live preview shrinks, name goes read-only. -->
    <div
      v-else
      ref="rootQuery"
      class="flex flex-col items-center gap-3 px-1 py-1"
    >
      <div class="pointer-events-none scale-[0.7] -my-4" aria-hidden="true">
        <span v-if="kind === 'folder'" class="relative block w-40 aspect-6/5">
          <span
            class="absolute top-[10%] left-0 z-0 h-[20%] w-[40%] rounded-tl-xl rounded-tr-md"
            :style="{
              backgroundColor: draftColor,
              filter: 'saturate(0.8)',
            }"
          />
          <span
            class="absolute top-[20%] left-0 z-0 h-[80%] w-full rounded-xl rounded-tl-none"
            :style="{
              backgroundColor: draftColor,
              filter: 'saturate(0.8)',
            }"
          />
          <span
            class="absolute top-[15%] left-[14%] z-10 h-[58%] w-[72%] rounded-lg border border-neutral-200 bg-white p-3 dark:border-neutral-300"
          >
            <span class="mb-2 block h-1 w-full rounded-full bg-neutral-100" />
            <span class="mb-2 block h-1 w-full rounded-full bg-neutral-100" />
            <span class="block h-1 w-2/3 rounded-full bg-neutral-100" />
          </span>
          <span
            class="absolute top-[23%] left-[21%] z-10 h-[64%] w-[72%] rotate-2 rounded-lg border border-neutral-200 bg-white p-4 dark:border-neutral-300"
          >
            <span class="mb-3 block h-2 w-12 rounded-full bg-blue-400/30" />
            <span class="mb-2 block h-1 w-full rounded-full bg-neutral-200" />
            <span class="mb-2 block h-1 w-full rounded-full bg-neutral-200" />
            <span class="block h-1 w-4/5 rounded-full bg-neutral-200" />
          </span>
          <span
            class="absolute bottom-0 left-0 z-20 flex h-[65%] w-full flex-col rounded-xl px-3 pb-2 pt-3"
            :style="folderBodyStyle"
          >
            <span class="flex min-h-0 flex-1 items-center justify-center">
              <span
                v-if="draftIcon"
                class="emoji-glyph text-3xl leading-none drop-shadow-sm"
                >{{ draftIcon }}</span
              >
              <v-remixicon
                v-else
                name="riFolder5Fill"
                class="size-8 text-white drop-shadow-sm"
              />
            </span>
            <span
              class="block truncate text-sm leading-tight font-bold text-white"
            >
              {{ draftName || namePlaceholder }}
            </span>
          </span>
        </span>
        <span
          v-else
          class="emoji-glyph flex h-20 w-20 items-center justify-center rounded-2xl text-4xl leading-none"
          :style="workspaceTileStyle"
          >{{ draftIcon }}</span
        >
      </div>
      <p
        class="w-full truncate px-2 text-center text-lg font-semibold text-neutral-900 dark:text-neutral-100"
      >
        {{ draftName || namePlaceholder }}
      </p>
      <ui-emoji-picker
        :current="draftIcon"
        :columns="pickerColumns"
        class="w-full"
        @select="draftIcon = $event"
      />
      <button
        v-if="showUseDefault"
        type="button"
        class="motion-press text-sm text-neutral-500 hover:text-neutral-700 dark:text-neutral-400 dark:hover:text-neutral-200"
        @click="useDefaultIcon"
      >
        {{ useDefaultLabel }}
      </button>
    </div>

    <template #actions>
      <div class="flex w-full gap-3">
        <ui-button
          class="mobile:!min-h-[48px] mobile:!h-auto mobile:!py-3 flex-1"
          @click="onCancelAction"
        >
          {{ cancelLabel }}
        </ui-button>
        <ui-button
          class="mobile:!min-h-[48px] mobile:!h-auto mobile:!py-3 flex-1"
          color="bg-neutral-900 text-white hover:bg-neutral-800 dark:bg-white dark:text-neutral-900 dark:hover:bg-neutral-100"
          :loading="saving"
          :disabled="primaryDisabled"
          @click="onPrimary"
        >
          {{ pickerOpen ? useIconLabel : primaryLabel }}
        </ui-button>
      </div>
    </template>
  </ui-modal>
</template>

<script>
import { ref, computed, watch, nextTick, onBeforeUnmount } from 'vue';
import { useTranslations } from '@/composable/useTranslations';
import {
  CUSTOMIZE_PALETTE,
  CUSTOMIZE_DEFAULT_COLOR,
  lightenHex,
} from '@/lib/customize';
import { loadEmojiDataset, filterEmojisByQuery } from '@/lib/emojis';

const MAX_SUGGESTIONS = 8;

export default {
  name: 'CustomizeEditor',
  props: {
    modelValue: { type: Boolean, default: false },
    kind: {
      type: String,
      default: 'folder',
      validator: (v) => ['folder', 'workspace'].includes(v),
    },
    title: { type: String, default: '' },
    primaryLabel: { type: String, default: '' },
    namePlaceholder: { type: String, default: '' },
    initialName: { type: String, default: '' },
    initialColor: { type: String, default: '' },
    initialIcon: { type: String, default: '' },
    saving: { type: Boolean, default: false },
    error: { type: String, default: '' },
    autofocusName: { type: Boolean, default: false },
    disablePrimaryWhenEmpty: { type: Boolean, default: false },
    showUseDefault: { type: Boolean, default: false },
    overlayClass: { type: String, default: 'z-50' },
    persist: { type: Boolean, default: false },
  },
  emits: ['update:modelValue', 'close', 'save'],
  setup(props, { emit }) {
    const { translations } = useTranslations();

    const draftName = ref(props.initialName || '');
    const draftColor = ref(props.initialColor || CUSTOMIZE_DEFAULT_COLOR);
    const draftIcon = ref(props.initialIcon || '');
    const pickerOpen = ref(false);
    const emojiPool = ref([]);

    const previewRef = ref(null);
    const nameInputRef = ref(null);
    const rootQuery = ref(null);

    const group = computed(() =>
      props.kind === 'folder'
        ? translations.value.card || {}
        : translations.value.workspaceDialog || {},
    );
    const chooseIconLabel = computed(
      () => group.value.chooseIcon || 'Choose icon',
    );
    const useIconLabel = computed(() => group.value.useIcon || 'Use icon');
    const useDefaultLabel = computed(
      () =>
        translations.value.card?.useDefaultIcon || 'Use default folder icon',
    );
    const cancelLabel = computed(
      () => translations.value.dialog?.cancel || 'Cancel',
    );
    const closeLabel = computed(
      () => translations.value.dialog?.close || 'Close',
    );
    const backLabel = computed(() => translations.value.dialog?.back || 'Back');
    const customColorLabel = computed(
      () => group.value.customColor || 'Custom color',
    );
    const colorLabel = computed(
      () => group.value.colors || group.value.colorLabel || 'Color',
    );

    const isCustomColor = computed(
      () =>
        !CUSTOMIZE_PALETTE.some(
          (swatch) =>
            swatch.hex.toLowerCase() === (draftColor.value || '').toLowerCase(),
        ),
    );

    function isColorSelected(hex) {
      return (draftColor.value || '').toLowerCase() === hex.toLowerCase();
    }

    const workspaceTileStyle = computed(() => {
      const color = draftColor.value || CUSTOMIZE_DEFAULT_COLOR;
      return {
        backgroundColor: /^#[0-9a-fA-F]{6}$/.test(color)
          ? `${color}21`
          : color,
        boxShadow: `inset 0 0 0 2px ${color}`,
      };
    });

    // Same gradient body as HomeFolderCard.
    const folderBodyStyle = computed(() => {
      const color = draftColor.value || CUSTOMIZE_DEFAULT_COLOR;
      return {
        background: `linear-gradient(to bottom, ${lightenHex(color, 0.18)}, ${color})`,
        transformOrigin: 'bottom center',
      };
    });

    // Live search of the draft name against the shared emoji dataset —
    // the same data and matching rules as the picker's search box.
    const suggestedIcons = computed(() => {
      const name = draftName.value.trim();
      if (!name || !emojiPool.value.length) return [];
      return filterEmojisByQuery(emojiPool.value, name, MAX_SUGGESTIONS).map(
        (emoji) => emoji.char,
      );
    });

    // Load the dataset once when the dialog opens; suggestions appear as
    // soon as it resolves (nothing renders before then).
    watch(
      () => props.modelValue,
      (open) => {
        if (open && !emojiPool.value.length) {
          loadEmojiDataset()
            .then(({ base }) => {
              emojiPool.value = base;
            })
            .catch(() => {
              // Offline/broken dataset: no suggestions, picker still works
              // with its own error state.
            });
        }
      },
      { immediate: true },
    );

    // Desktop grid-cols-8 parity; phones get 7 wider columns.
    const pickerColumns = computed(() =>
      typeof window !== 'undefined' &&
      window.matchMedia?.('(max-width: 767px)').matches
        ? 7
        : 8,
    );

    const primaryDisabled = computed(
      () => props.disablePrimaryWhenEmpty && !draftName.value.trim(),
    );

    function detachEscape() {
      if (typeof document !== 'undefined') {
        document.removeEventListener('keyup', onEscapeCapture, true);
      }
    }

    // Escape closes the picker first; the modal's own Escape handler never
    // sees it (capture + stopPropagation runs before its bubble listener).
    // A non-empty search field consumes the first Escape to clear itself.
    function onEscapeCapture(event) {
      if (event.key !== 'Escape' && event.code !== 'Escape') return;
      const active = document.activeElement;
      if (
        active &&
        active.matches?.('.note-search-input input') &&
        active.value
      ) {
        return;
      }
      event.stopPropagation();
      event.preventDefault();
      closePicker(true);
    }

    function openPicker() {
      pickerOpen.value = true;
    }

    function closePicker(focusPreview = false) {
      pickerOpen.value = false;
      if (focusPreview) {
        nextTick(() => previewRef.value?.focus?.());
      }
    }

    function useDefaultIcon() {
      draftIcon.value = '';
      closePicker(true);
    }

    function onCancel() {
      emit('close');
      emit('update:modelValue', false);
    }

    function onCancelAction() {
      if (pickerOpen.value) closePicker(true);
      else onCancel();
    }

    function onSave() {
      if (primaryDisabled.value) return;
      emit('save', {
        name: draftName.value.trim(),
        color: draftColor.value,
        icon: draftIcon.value,
      });
    }

    function onPrimary() {
      if (pickerOpen.value) closePicker(true);
      else onSave();
    }

    watch(
      () => props.modelValue,
      (open) => {
        if (open) {
          draftName.value = props.initialName || '';
          draftColor.value = props.initialColor || CUSTOMIZE_DEFAULT_COLOR;
          draftIcon.value = props.initialIcon || '';
          pickerOpen.value = false;
          if (props.autofocusName) {
            nextTick(() => nameInputRef.value?.focus?.());
          }
        } else {
          detachEscape();
        }
      },
      { immediate: true },
    );

    watch(pickerOpen, (open) => {
      if (open) {
        document.addEventListener('keyup', onEscapeCapture, true);
        // Focus the picker's search box; the dataset loads underneath.
        nextTick(() =>
          rootQuery.value
            ?.querySelector('.note-search-input input')
            ?.focus?.(),
        );
      } else {
        detachEscape();
      }
    });

    onBeforeUnmount(detachEscape);

    return {
      CUSTOMIZE_PALETTE,
      draftName,
      draftColor,
      draftIcon,
      pickerOpen,
      previewRef,
      nameInputRef,
      rootQuery,
      group,
      chooseIconLabel,
      useIconLabel,
      useDefaultLabel,
      cancelLabel,
      closeLabel,
      backLabel,
      customColorLabel,
      colorLabel,
      isCustomColor,
      isColorSelected,
      workspaceTileStyle,
      folderBodyStyle,
      suggestedIcons,
      pickerColumns,
      primaryDisabled,
      onEscapeCapture,
      openPicker,
      closePicker,
      useDefaultIcon,
      onCancel,
      onCancelAction,
      onSave,
      onPrimary,
    };
  },
};
</script>

<style scoped>
.emoji-glyph {
  font-family:
    'Apple Color Emoji', 'Segoe UI Emoji', 'Noto Color Emoji',
    'Twemoji', sans-serif;
}

/* The name is the only input: borderless, centered, title-sized. */
.customize-name :deep(label > div) {
  background-color: transparent;
  justify-content: center;
  padding-left: 0;
  padding-right: 0;
}
.customize-name :deep(label > div:focus-within) {
  box-shadow: none;
}
.customize-name :deep(input) {
  text-align: center;
  font-size: 1.25rem;
  line-height: 1.75rem;
  font-weight: 600;
}
</style>
