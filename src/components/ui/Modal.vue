<template>
  <div class="modal-ui">
    <div v-if="$slots.activator" class="modal-ui__activator">
      <slot name="activator" v-bind="{ open: () => (show = true) }"></slot>
    </div>
    <teleport :to="teleportTo" :disabled="disabledTeleport">
      <transition name="modal" mode="out-in">
        <div
          v-if="show"
          class="modal-ui__content-container fixed inset-0 flex items-center justify-center bg-black/20 p-0 md:p-5 mobile:items-end"
          :class="overlayClass"
          :style="{ 'backdrop-filter': blur && 'blur(2px)' }"
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
              // Vertical-only pan: kills diagonal page pans; grid scroll + close-drag unaffected
              'modal-ui__content w-full shadow-lg touch-pan-y mobile:max-w-full mobile:rounded-t-[1.25rem] mobile:rounded-b-none mobile:border-x-0 mobile:border-b-0 mobile:shadow-sm',
              contentClass,
              { '!transition-none': isDragging },
            ]"
            :style="modalContentStyle"
          >
            <div
              class="hidden cursor-grab touch-none select-none mobile:block -mt-2 px-8 pb-1 pt-3"
              @touchstart.passive="handleTouchStart"
              @touchmove="handleTouchMove"
              @touchend="handleTouchEnd"
              @touchcancel="handleTouchCancel"
            >
              <div
                class="mx-auto h-1 w-9 rounded-full bg-neutral-400/60"
              ></div>
            </div>
            <div v-if="$slots.header || title" class="mb-4">
              <slot name="header">
                <div class="flex flex-row items-center gap-4">
                  <div
                    v-if="icon"
                    class="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl"
                    :class="iconVariant === 'danger'
                      ? 'bg-red-100 dark:bg-red-900/30'
                      : 'bg-neutral-100 dark:bg-neutral-700'"
                  >
                    <v-remixicon
                      :name="icon"
                      size="24"
                      :class="iconVariant === 'danger' ? 'text-red-500' : 'text-neutral-600 dark:text-neutral-300'"
                    />
                  </div>
                  <h3 class="font-semibold text-lg tracking-tight leading-snug">{{ title }}</h3>
                </div>
              </slot>
            </div>
            <div>
              <slot></slot>
            </div>
            <div
              v-if="$slots.actions"
              class="flex gap-3 mobile:flex-col-reverse pt-4 mt-4 border-t border-neutral-200 dark:border-neutral-700"
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
    const SWIPE_CLOSE_THRESHOLD = 96;
    // Slop before a downward touch becomes a card drag: a scroll gesture
    // often starts with a few px of downward wobble, which must not claim it.
    const DRAG_SLOP_PX = 12;
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

      resetDrag();
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
      opacity:
        dragOffsetY.value > 0
          ? String(Math.max(0.82, 1 - dragOffsetY.value / 420))
          : '',
    }));

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
      touchStartTime.value = performance.now();
      touchScrollableAncestor.value = getScrollableParent(event.target);
      isDragging.value = false;
    }

    function handleTouchMove(event) {
      if (props.persist || !show.value) return;

      const touch = event.touches?.[0];
      if (!touch) return;

      // Yield once the browser has committed to native scroll — while the
      // gesture is unattributed we must never preventDefault (on iOS the
      // first prevented move kills native scroll for the whole gesture).
      if (!event.cancelable) return;

      touchCurrentY.value = touch.clientY;
      const deltaY = touchCurrentY.value - touchStartY.value;

      // Per-move edge check against the remembered scrollable ancestor:
      // swipe only when moving down from the ancestor's top edge, otherwise
      // hand the gesture to native scroll.
      const ancestor = touchScrollableAncestor.value;
      if (ancestor && !(deltaY > 0 && ancestor.scrollTop <= 0)) {
        dragOffsetY.value = 0;
        return;
      }

      if (deltaY <= DRAG_SLOP_PX) {
        // Always release: a reversed drag must let go immediately so the
        // browser can take over native scrolling instead of freezing mid-pose.
        dragOffsetY.value = 0;
        return;
      }

      isDragging.value = true;
      const engaged = deltaY - DRAG_SLOP_PX;
      // ponytail: rubber-band past the 160 soft bound instead of a hard clamp
      dragOffsetY.value =
        engaged <= 160 ? engaged : 160 + (engaged - 160) * 0.3;
      event.preventDefault();
    }

    function handleTouchEnd() {
      if (!isDragging.value) {
        resetDrag();
        return;
      }

      const elapsed = performance.now() - touchStartTime.value;
      const velocity = Math.abs(dragOffsetY.value) / Math.max(elapsed, 1);

      if (dragOffsetY.value >= SWIPE_CLOSE_THRESHOLD || velocity > 0.11) {
        closeModal();
        return;
      }

      // modalContent is a component ref: reach the DOM node via $el first.
      const el = modalContent.value?.$el || modalContent.value;
      if (el && el.style) {
        const dur = prefersReducedMotion() ? '0.01ms' : '300ms';
        el.style.transition = `transform ${dur} var(--ease-spring), opacity ${dur} var(--ease-standard)`;
        el.style.transform = 'translate3d(0, 0, 0)';
        el.style.opacity = '1';
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
   instead of displacing the whole sheet. Inner scrollers (picker grid,
   customizer list) keep working; no consumer uses the `scrollable` prop. */
.modal-ui__content-container {
  overflow-y: clip;
}

@media (max-width: 767px) {
  .modal-ui__content {
    transform-origin: center bottom;
    padding-bottom: max(env(safe-area-inset-bottom, 0px), 0.75rem) !important;
  }

  .modal-enter-from .modal-ui__content,
  .modal-leave-to .modal-ui__content {
    transform: translate3d(0, 24px, 0);
  }
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
