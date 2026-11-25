<template>
  <div class="modal-ui">
    <div v-if="$slots.activator" class="modal-ui__activator">
      <slot name="activator" v-bind="{ open: () => (show = true) }"></slot>
    </div>
    <teleport :to="teleportTo" :disabled="disabledTeleport">
      <transition name="modal" mode="out-in">
        <div
          v-if="show"
          class="modal-ui__content-container group fixed inset-0 flex items-center justify-center bg-black/20 p-0 md:p-5 mobile:items-end mobile:p-0 tablet:items-end tablet:p-0 folded:items-end folded:p-0"
          :class="overlayClass"
          :style="[
            overlayStyle,
            { 'backdrop-filter': blur && 'blur(2px)' },
          ]"
          @click.self="closeModal"
        >
          <slot v-if="customContent"></slot>
          <ui-card
            v-else
            ref="modalContent"
            role="dialog"
            aria-modal="true"
            :aria-label="title || undefined"
            :class="[
              'modal-ui__content w-full shadow-lg touch-pan-y foldable:max-w-xl foldable:max-h-[100dvh] foldable:mr-[var(--app-rail-width)]',
              'folded:max-w-full folded:max-h-[100dvh] folded:overflow-y-auto',
              'folded:mr-0',
              'folded:pl-[calc(var(--app-safe-area-left)+1rem)]',
              'folded:pr-[var(--app-rail-width)]',
              'folded:rounded-t-[1.25rem] folded:rounded-b-none folded:border-x-0 folded:border-b-0 folded:shadow-sm',
              'folded:origin-bottom folded:!pb-[max(env(safe-area-inset-bottom,0px),0.75rem)]',
              'folded:motion-safe:group-[.modal-enter-from]:[transform:translate3d(0,24px,0)]',
              'folded:motion-safe:group-[.modal-leave-to]:[transform:translate3d(0,24px,0)]',
              'mobile:max-w-full mobile:max-h-[calc(100dvh_-_0.75rem)] mobile:overflow-y-auto',
              'mobile:rounded-t-[1.25rem] mobile:rounded-b-none mobile:border-x-0 mobile:border-b-0 mobile:shadow-sm',
              'mobile:origin-bottom mobile:!pb-[max(env(safe-area-inset-bottom,0px),0.75rem)]',
              'mobile:motion-safe:group-[.modal-enter-from]:[transform:translate3d(0,24px,0)]',
              'mobile:motion-safe:group-[.modal-leave-to]:[transform:translate3d(0,24px,0)]',
              'tablet:max-w-2xl tablet:overflow-y-auto',
              'tablet:rounded-t-[1.25rem] tablet:rounded-b-none tablet:border-x-0 tablet:border-b-0 tablet:shadow-sm',
              'tablet:origin-bottom tablet:!pb-[max(env(safe-area-inset-bottom,0px),0.75rem)]',
              'tablet:motion-safe:group-[.modal-enter-from]:[transform:translate3d(0,24px,0)]',
              'tablet:motion-safe:group-[.modal-leave-to]:[transform:translate3d(0,24px,0)]',
              contentClass,
              { '!transition-none': isDragging },
            ]"
            :style="modalContentStyle"
          >
            <div
              class="hidden cursor-grab touch-none select-none mobile:block tablet:block folded:block -mt-2 px-8 pb-1 pt-3 h-11"
              @touchstart.passive="handleTouchStart"
              @touchmove="handleTouchMove"
              @touchend="handleTouchEnd"
              @touchcancel="handleTouchCancel"
            >
              <div class="mx-auto h-1 w-9 rounded-full bg-neutral-400/60"></div>
            </div>

            <div v-if="$slots.header || title" class="mb-4">
              <slot name="header">
                <div class="flex flex-row items-center gap-4">
                  <div
                    v-if="icon"
                    class="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl"
                    :class="
                      iconVariant === 'danger'
                        ? 'bg-red-100 dark:bg-red-900/30'
                        : 'bg-neutral-100 dark:bg-neutral-700'
                    "
                  >
                    <v-remixicon
                      :name="icon"
                      size="24"
                      :class="
                        iconVariant === 'danger'
                          ? 'text-red-500'
                          : 'text-neutral-600 dark:text-neutral-300'
                      "
                    />
                  </div>
                  <h3 class="font-semibold text-lg tracking-tight leading-snug">
                    {{ title }}
                  </h3>
                </div>
              </slot>
            </div>

            <div>
              <slot></slot>
            </div>

            <div
              v-if="$slots.actions"
              class="flex gap-3 mobile:flex-col-reverse tablet:flex-col-reverse pt-4 mt-4"
            >
              <slot name="actions"></slot>
            </div>
          </ui-card>
        </div>
      </transition>
    </teleport>
  </div>
</template>

<script>
import { computed, ref, watch, onUnmounted, nextTick } from 'vue';
import { useUiState } from '@/composable/useUiState';
import { useFocusTrap } from '@/composable/useFocusTrap';

export default {
  props: {
    modelValue: {
      type: Boolean,
      default: false,
    },
    teleportTo: {
      type: String,
      default: 'body',
    },
    contentClass: {
      type: String,
      default: 'max-w-lg',
    },
    overlayClass: {
      type: String,
      default: 'z-50',
    },
    customContent: Boolean,
    persist: Boolean,
    blur: Boolean,
    disabledTeleport: Boolean,
    title: { type: String, default: '' },
    icon: { type: String, default: '' },
    iconVariant: { type: String, default: '' },
  },
  emits: ['close', 'update:modelValue'],
  setup(props, { emit }) {
    const uiState = useUiState();
    const show = ref(false);
    const modalContent = ref(null);
    const previouslyFocused = ref(null);
    const trapRef = ref(null);
    const { activate, deactivate } = useFocusTrap(trapRef);
    const dragOffsetY = ref(0);
    const isDragging = ref(false);
    const touchStartY = ref(0);
    const touchCurrentY = ref(0);
    const touchScrollableAncestor = ref(null);
    const touchStartTime = ref(0);
    let touchLastY = 0;
    let touchLastTime = 0;
    const SWIPE_CLOSE_THRESHOLD = 96;
    // Slop before a downward touch becomes a card drag: a scroll gesture
    // often starts with a few px of downward wobble, which must not claim it.
    const DRAG_SLOP_PX = 12;
    const SOFT_MAX_PX = 160;
    const FLICK_VELOCITY = 0.5; // px per ms

    const prefersReducedMotion = () =>
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

    function toggleBodyOverflow(value) {
      if (value) {
        const scrollbarWidth =
          window.innerWidth - document.documentElement.clientWidth;
        document.body.style.paddingRight = `${scrollbarWidth}px`;
      } else {
        document.body.style.paddingRight = '';
      }
      document.body.classList.toggle('overflow-hidden', value);
    }
    function closeModal() {
      if (props.persist) return;

      // If we're mid-drag and past threshold, the sheet should finish its exit
      // from the current drag offset (so the leave transition starts from the
      // finger's position, not from rest).
      const isDismissing = isDragging.value && dragOffsetY.value >= SWIPE_CLOSE_THRESHOLD;
      if (!isDismissing) resetDrag();

      show.value = false;
      emit('close', false);
      emit('update:modelValue', false);

      toggleBodyOverflow(false);
      deactivate();
      if (previouslyFocused.value && previouslyFocused.value.focus) {
        previouslyFocused.value.focus();
      }
    }
    function keyupHandler({ code }) {
      if (code === 'Escape') closeModal();
    }

    watch(
      () => props.modelValue,
      (value) => {
        show.value = value;
        if (!value) resetDrag();
        toggleBodyOverflow(value);
      },
      { immediate: true },
    );

    watch(show, (value) => {
      if (value) {
        previouslyFocused.value = document.activeElement;
        window.addEventListener('keyup', keyupHandler);
        uiState.openOverlay();
        nextTick(() => {
          trapRef.value = modalContent.value?.$el || modalContent.value;
          activate();
        });
      } else {
        window.removeEventListener('keyup', keyupHandler);
        // v-model closes bypass closeModal(): release the trap here too,
        // otherwise the next open activate() no-ops and focus leaks.
        deactivate();
        uiState.closeOverlay();
      }
    });
    onUnmounted(() => {
      if (show.value) uiState.closeOverlay();
      window.removeEventListener('keyup', keyupHandler);
    });

    const modalContentStyle = computed(() => ({
      transform:
        dragOffsetY.value > 0
          ? `translate3d(0, ${dragOffsetY.value}px, 0)`
          : '',
    }));

    const overlayStyle = computed(() => {
      if (dragOffsetY.value <= 0) return { opacity: '1' };
      return { opacity: String(Math.max(0.82, 1 - dragOffsetY.value / 420)) };
    });

    function getScrollableParent(target) {
      let current = target;

      while (current && current !== modalContent.value) {
        if (!(current instanceof HTMLElement)) {
          current = current?.parentElement;
          continue;
        }

        const style = window.getComputedStyle(current);
        const canScroll =
          /(auto|scroll)/.test(style.overflowY) &&
          current.scrollHeight > current.clientHeight;

        if (canScroll) return current;
        current = current.parentElement;
      }

      return null;
    }

    function resetDrag() {
      dragOffsetY.value = 0;
      isDragging.value = false;
      touchStartY.value = 0;
      touchCurrentY.value = 0;
      touchScrollableAncestor.value = null;
      touchStartTime.value = 0;
    }

    // Swipe-to-close is confined to the top strip element (touch listeners live
    // there, not on the card), so grid/list touches can never be hijacked.
    // Drag-vs-scroll arbitration ported from reka-ui's useSwipeDismiss (MIT,
    // itself a port of Vaul): remember the scrollable ancestor at touchstart
    // and re-check its edge on every move — never snapshot scrollTop.
    function handleTouchStart(event) {
      if (props.persist || !show.value) return;

      const touch = event.touches?.[0];
      if (!touch) return;

      touchStartY.value = touch.clientY;
      touchCurrentY.value = touch.clientY;
      touchLastY = touch.clientY;
      touchStartTime.value = performance.now();
      touchLastTime = performance.now();
      touchScrollableAncestor.value = getScrollableParent(event.target);
      isDragging.value = false;
    }

    function handleTouchMove(event) {
      if (props.persist || !show.value) return;

      const touch = event.touches?.[0];
      if (!touch) return;

      if (!event.cancelable) return;

      touchCurrentY.value = touch.clientY;
      const now = performance.now();
      const deltaY = touchCurrentY.value - touchStartY.value;

      const ancestor = touchScrollableAncestor.value;
      if (ancestor && !(deltaY > 0 && ancestor.scrollTop <= 0)) {
        dragOffsetY.value = 0;
        return;
      }

      if (deltaY <= DRAG_SLOP_PX) {
        dragOffsetY.value = 0;
        return;
      }

      isDragging.value = true;
      const engaged = deltaY - DRAG_SLOP_PX;
      dragOffsetY.value =
        engaged <= SOFT_MAX_PX ? engaged : SOFT_MAX_PX + (engaged - SOFT_MAX_PX) * 0.3;

      // Track recent move for release velocity
      touchLastY = touch.clientY;
      touchLastTime = now;

      event.preventDefault();
    }

    function handleTouchEnd() {
      if (!isDragging.value) {
        resetDrag();
        return;
      }

      // Release velocity from the last few move events (not whole-gesture average)
      const now = performance.now();
      const recentMs = Math.max(now - touchLastTime, 1);
      const velocity = Math.abs(touchCurrentY.value - touchLastY) / recentMs;

      const shouldDismiss =
        dragOffsetY.value >= SWIPE_CLOSE_THRESHOLD || velocity > FLICK_VELOCITY;

      if (shouldDismiss) {
        // Exit animation starts from current drag offset; leave transition uses
        // --ease-exit which already matches the skill's Vaul curve (500ms spring).
        closeModal();
        return;
      }

      // Snap back with spring
      const el = modalContent.value?.$el || modalContent.value;
      if (el && el.style) {
        const dur = prefersReducedMotion() ? '0.01ms' : '300ms';
        el.style.transition = `transform ${dur} var(--ease-spring)`;
        el.style.transform = 'translate3d(0, 0, 0)';
        el.addEventListener(
          'transitionend',
          () => {
            el.style.transition = '';
            resetDrag();
          },
          { once: true },
        );
      } else {
        resetDrag();
      }
    }

    function handleTouchCancel() {
      resetDrag();
    }

    return {
      show,
      closeModal,
      modalContent,
      modalContentStyle,
      overlayStyle,
      isDragging,
      handleTouchStart,
      handleTouchMove,
      handleTouchEnd,
      handleTouchCancel,
      trapRef,
    };
  },
};
</script>

<style>
.modal-enter-active,
.modal-leave-active {
  transition: opacity var(--motion-fast) var(--ease-standard);
}

.modal-enter-active .modal-ui__content,
.modal-leave-active .modal-ui__content {
  transition:
    opacity var(--motion-base) var(--ease-standard),
    transform var(--motion-base) var(--ease-standard);
  transform: translate3d(0, 0, 0) scale(1);
  opacity: 1;
}

.modal-enter-from,
.modal-leave-to {
  opacity: 0;
}

.modal-enter-from .modal-ui__content,
.modal-leave-to .modal-ui__content {
  transform: translate3d(0, 14px, 0) scale(0.985);
  opacity: 0;
}

.modal-leave-active .modal-ui__content {
  transition-timing-function: var(--ease-exit);
}

.modal-ui__content {
  transform-origin: center center;
  will-change: transform, opacity;
}

/* Fixed backdrop must never be a scroller: `clip` (unlike `hidden`) is not a
   scroll container, so chained scrolls from inner scrollers skip it entirely
   instead of displacing the whole sheet. */
.modal-ui__content-container {
  overflow-y: clip;
}

@media (prefers-reduced-motion: reduce) {
  .modal-enter-active,
  .modal-leave-active,
  .modal-enter-active .modal-ui__content,
  .modal-leave-active .modal-ui__content {
    transition-duration: 0.01ms;
  }

  .modal-enter-from .modal-ui__content,
  .modal-leave-to .modal-ui__content {
    transform: none;
    opacity: 1;
  }
}
</style>
