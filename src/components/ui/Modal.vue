<template>
  <div class="modal-ui">
    <div v-if="$slots.activator" class="modal-ui__activator">
      <slot name="activator" v-bind="{ open: () => (show = true) }"></slot>
    </div>
    <teleport :to="teleportTo" :disabled="disabledTeleport">
      <transition name="modal" mode="out-in">
        <div
          v-if="show"
          class="modal-ui__content-container fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-black/20 p-0 md:p-5 mobile:items-end"
          :style="{ 'backdrop-filter': blur && 'blur(2px)' }"
          @click.self="closeModal"
        >
          <slot v-if="customContent"></slot>
          <ui-card
            v-else
            ref="modalContent"
            role="document"
            :class="[
              'modal-ui__content w-full shadow-lg mobile:max-w-full mobile:rounded-t-[1.25rem] mobile:rounded-b-none mobile:border-x-0 mobile:border-b-0 mobile:shadow-sm',
              contentClass,
              { '!transition-none': isDragging },
            ]"
            :style="modalContentStyle"
            @touchstart.passive="handleTouchStart"
            @touchmove="handleTouchMove"
            @touchend="handleTouchEnd"
            @touchcancel="handleTouchCancel"
          >
            <div
              class="mx-auto mt-2 hidden h-1 w-9 rounded-full bg-neutral-400/60 mobile:block"
            ></div>
            <div>
              <div class="flex items-center justify-between gap-3">
                <span class="content-header w-full">
                  <slot name="header"></slot>
                </span>
                <v-remixicon
                  v-show="!persist"
                  class="cursor-pointer shrink-0 text-neutral-500 hover:text-neutral-700 dark:text-neutral-400 dark:hover:text-neutral-200 transition-colors"
                  name="riCloseLine"
                  size="20"
                  role="button"
                  aria-label="Close"
                  tabindex="0"
                  @click="closeModal"
                ></v-remixicon>
              </div>
            </div>
            <div>
              <slot name="actions"></slot>
              <slot></slot>
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
    customContent: Boolean,
    persist: Boolean,
    blur: Boolean,
    disabledTeleport: Boolean,
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
    const touchStartedOnScrollable = ref(false);
    const touchStartTime = ref(0);
    const SWIPE_CLOSE_THRESHOLD = 96;
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
      { immediate: true }
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
      touchStartedOnScrollable.value = false;
      touchStartTime.value = 0;
    }

    function handleTouchStart(event) {
      if (props.persist || !show.value) return;

      const touch = event.touches?.[0];
      if (!touch) return;

      touchStartY.value = touch.clientY;
      touchCurrentY.value = touch.clientY;
      touchStartTime.value = performance.now();
      touchStartedOnScrollable.value = Boolean(
        getScrollableParent(event.target)?.scrollTop > 0
      );
      isDragging.value = false;
    }

    function handleTouchMove(event) {
      if (props.persist || !show.value) return;

      const touch = event.touches?.[0];
      if (!touch) return;

      touchCurrentY.value = touch.clientY;
      const deltaY = touchCurrentY.value - touchStartY.value;

      if (deltaY <= 0 || touchStartedOnScrollable.value) {
        if (!isDragging.value) dragOffsetY.value = 0;
        return;
      }

      isDragging.value = true;
      dragOffsetY.value = Math.min(deltaY, 160);
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

      const el = modalContent.value;
      if (el) {
        const dur = prefersReducedMotion() ? '0.01ms' : '300ms';
        el.style.transition = `transform ${dur} var(--ease-spring), opacity ${dur} var(--ease-standard)`;
        el.style.transform = 'translate3d(0, 0, 0)';
        el.style.opacity = '1';
        el.addEventListener('transitionend', () => {
          el.style.transition = '';
          resetDrag();
        }, { once: true });
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
  transition: opacity var(--motion-base) var(--ease-standard),
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
