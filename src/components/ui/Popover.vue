<template>
  <div class="ui-popover inline-block" :class="{ hidden: to }">
    <div
      ref="targetEl"
      class="ui-popover__trigger h-full inline-block"
      role="button"
      tabindex="0"
      aria-haspopup="true"
      :aria-expanded="isShow ? 'true' : 'false'"
      @click="onTriggerClick"
      @keydown.enter.prevent="onTriggerClick"
      @keydown.space.prevent="onTriggerClick"
    >
      <slot name="trigger" v-bind="{ isShow }"></slot>
    </div>
    <Teleport to="body">
      <div
        v-if="sheet && isShow"
        class="fixed inset-0 z-40 bg-black/20"
        :style="sheetBackdropStyle"
        @click="hide"
      ></div>
      <Transition name="ui-popover">
        <div
          v-show="isShow"
          ref="content"
          :role="sheet ? 'dialog' : undefined"
          :aria-modal="sheet ? 'true' : undefined"
          :style="[sheet ? undefined : floatingStyles, sheetDragStyle]"
          :class="[
            originClass,
            sheet
              ? 'ui-popover__content--sheet fixed inset-x-0 bottom-0 w-full rounded-t-2xl border-x-0 border-b-0 max-h-[80dvh] overflow-y-auto p-2 pb-[max(env(safe-area-inset-bottom),0.75rem)]'
              : 'rounded-xl p-1',
            { '!transition-none': sheetDragging },
          ]"
          class="ui-popover__content bg-white dark:bg-neutral-900 shadow-xl border z-50"
        >
          <!-- Grab strip: swipe-down closes the sheet; listeners live here so
               list/grid touches inside the panel are never hijacked. -->
          <div
            v-if="sheet"
            class="flex h-11 cursor-grab touch-none select-none items-center justify-center px-8"
            @touchstart.passive="onSheetTouchStart"
            @touchmove="onSheetTouchMove"
            @touchend="onSheetTouchEnd"
            @touchcancel="onSheetTouchCancel"
          >
            <div class="h-1 w-9 rounded-full bg-neutral-400/60"></div>
          </div>
          <slot v-bind="{ isShow }"></slot>
        </div>
      </Transition>
    </Teleport>
  </div>
</template>
<script>
import { ref, computed, watch, onMounted, onUnmounted } from 'vue';
import { useFloating, offset, flip, shift, autoUpdate } from '@floating-ui/vue';
import { useScrollLock } from '@/utils/ui/scrollLock.js';

export default {
  props: {
    placement: {
      type: String,
      default: 'bottom',
    },
    trigger: {
      type: String,
      default: 'click',
    },
    to: {
      type: [String, Object, HTMLElement],
      default: '',
    },
    disabled: {
      type: Boolean,
      default: false,
    },
    // Phone layout: the same slot content rendered as a bottom sheet instead of
    // a floating dropdown, for callers a phone has no room for a dropdown.
    sheet: Boolean,
    modelValue: {
      type: Boolean,
      default: false,
    },
  },
  emits: ['show', 'trigger', 'close', 'update:modelValue'],
  setup(props, { emit }) {
    const targetEl = ref(null);
    const content = ref(null);
    const isShow = ref(false);

    const reference = computed(() => {
      if (props.to) {
        return typeof props.to === 'string'
          ? document.querySelector(props.to)
          : props.to;
      }
      return targetEl.value;
    });

    const middleware = computed(() => [
      offset(15),
      flip(),
      shift({ padding: 15 }),
    ]);

    const placementRef = computed(() => props.placement);
    const { floatingStyles, placement: floatingPlacement } = useFloating(reference, content, {
      placement: placementRef,
      middleware,
      whileElementsMounted: autoUpdate,
      transform: false,
    });
    const originClass = computed(() => {
      const p = String(floatingPlacement.value || '');
      if (p.startsWith('top')) return 'origin-bottom';
      if (p.startsWith('left')) return 'origin-right';
      if (p.startsWith('right')) return 'origin-left';
      return 'origin-top';
    });

    const { lock: lockScroll, unlock: unlockScroll } = useScrollLock();

    // Sheet drag-to-close: only the grab strip listens, so panel content keeps
    // its native scroll. Track 1:1, rubber-band past 160px, dismiss on distance
    // OR release velocity, and settle back with a spring.
    const SHEET_DISMISS_PX = 120;
    const SHEET_SOFT_MAX = 160;
    const SHEET_FLICK_VELOCITY = 0.5; // px per ms
    const sheetDragOffset = ref(null);
    const sheetTransition = ref('');
    let sheetStartY = 0;
    let sheetLastTime = 0;
    let sheetVelocity = 0;
    let sheetDismissTimer = null;

    const prefersReducedMotion = () =>
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

    const sheetDragging = computed(() => (sheetDragOffset.value ?? 0) > 0);
    const sheetDragStyle = computed(() => {
      if (props.sheet === false || sheetDragOffset.value === null) return null;
      return {
        transform: `translateY(${Math.max(sheetDragOffset.value, 0)}px)`,
        transition: sheetTransition.value || 'none',
      };
    });
    const sheetBackdropStyle = computed(() => {
      const offset = sheetDragOffset.value ?? 0;
      const height = content.value?.offsetHeight || 360;
      return { opacity: String(Math.max(0, 1 - offset / Math.max(height, 1))) };
    });

    function clearSheetTimers() {
      if (sheetDismissTimer) {
        clearTimeout(sheetDismissTimer);
        sheetDismissTimer = null;
      }
    }

    function settleSheetBack() {
      const duration = prefersReducedMotion() ? '0.01ms' : '280ms';
      sheetTransition.value = `transform ${duration} var(--ease-spring)`;
      sheetDragOffset.value = 0;
      clearSheetTimers();
      sheetDismissTimer = setTimeout(
        () => {
          sheetDismissTimer = null;
          sheetDragOffset.value = null;
          sheetTransition.value = '';
        },
        prefersReducedMotion() ? 30 : 300,
      );
    }

    function dismissSheet() {
      const distance = content.value?.offsetHeight || 360;
      sheetTransition.value = `transform ${
        prefersReducedMotion() ? '0.01ms' : '220ms'
      } var(--ease-exit)`;
      sheetDragOffset.value = distance;
      clearSheetTimers();
      // Hide only after the sheet has slid out, otherwise the leave class
      // would restart from the rest position and jump.
      sheetDismissTimer = setTimeout(
        () => {
          sheetDismissTimer = null;
          sheetDragOffset.value = null;
          sheetTransition.value = '';
          hide();
        },
        prefersReducedMotion() ? 20 : 240,
      );
    }

    const onSheetTouchStart = (event) => {
      const touch = event.touches?.[0];
      if (!touch) return;
      clearSheetTimers();
      sheetTransition.value = '';
      sheetStartY = touch.clientY;
      sheetLastTime = performance.now();
      sheetVelocity = 0;
      sheetDragOffset.value = 0;
    };

    const onSheetTouchMove = (event) => {
      if (sheetDragOffset.value === null) return;
      if (!event.cancelable) return;
      const touch = event.touches?.[0];
      if (!touch) return;
      const now = performance.now();
      const delta = touch.clientY - sheetStartY;
      const next = delta > 0 ? delta : 0;
      sheetVelocity =
        (next - sheetDragOffset.value) / Math.max(now - sheetLastTime, 1);
      sheetLastTime = now;
      sheetDragOffset.value =
        next <= SHEET_SOFT_MAX
          ? next
          : SHEET_SOFT_MAX + (next - SHEET_SOFT_MAX) * 0.3;
      event.preventDefault();
    };

    const onSheetTouchEnd = () => {
      if (sheetDragOffset.value === null) return;
      if (
        sheetDragging.value &&
        (sheetDragOffset.value >= SHEET_DISMISS_PX ||
          sheetVelocity > SHEET_FLICK_VELOCITY)
      ) {
        dismissSheet();
        return;
      }
      if (sheetDragging.value) settleSheetBack();
      else {
        sheetDragOffset.value = null;
        sheetTransition.value = '';
      }
    };

    const onSheetTouchCancel = () => {
      clearSheetTimers();
      sheetDragOffset.value = null;
      sheetTransition.value = '';
    };

    const show = () => {
      if (props.disabled) return;
      isShow.value = true;
      lockScroll();
      emit('update:modelValue', true);
      emit('show');
      emit('trigger');
    };

    const hide = () => {
      isShow.value = false;
      unlockScroll();
      emit('update:modelValue', false);
      emit('close');
    };

    const onTriggerClick = () => {
      if (props.trigger !== 'click') return;
      if (isShow.value) hide();
      else show();
    };

    watch(
      () => props.modelValue,
      (val) => {
        if (val !== isShow.value) {
          isShow.value = val;
          if (val) {
            lockScroll();
          } else {
            unlockScroll();
          }
        }
      }
    );

    const handleClickOutside = (e) => {
      if (!isShow.value) return;
      const target = reference.value;
      const floating = content.value;
      if (
        target &&
        !target.contains(e.target) &&
        floating &&
        !floating.contains(e.target)
      ) {
        hide();
      }
    };

    const handleKeydown = (e) => {
      if (e.key === 'Escape' && isShow.value) {
        hide();
        targetEl.value?.focus();
      }
    };

    onMounted(() => {
      document.addEventListener('click', handleClickOutside, true);
      document.addEventListener('keydown', handleKeydown, true);
    });

    onUnmounted(() => {
      clearSheetTimers();
      document.removeEventListener('click', handleClickOutside, true);
      document.removeEventListener('keydown', handleKeydown, true);
      if (isShow.value) {
        unlockScroll();
      }
    });

    return {
      isShow,
      content,
      targetEl,
      floatingStyles,
      originClass,
      onTriggerClick,
      hide,
      // Sheet drag-to-close: without these the template reads undefined props
      // (a warning on every render) and the drag does nothing.
      sheetDragging,
      sheetDragStyle,
      sheetBackdropStyle,
      onSheetTouchStart,
      onSheetTouchMove,
      onSheetTouchEnd,
      onSheetTouchCancel,
    };
  },
};
</script>
<style>
.ui-popover-enter-active {
  transition: opacity var(--motion-fast) var(--ease-snappy), transform var(--motion-fast) var(--ease-snappy);
}
.ui-popover-leave-active {
  transition: opacity var(--motion-fast) var(--ease-exit), transform var(--motion-fast) var(--ease-exit);
}
.ui-popover-enter-from,
.ui-popover-leave-to {
  opacity: 0;
  transform: translateY(-8px) scale(0.98);
}
/* A sheet slides up from the bottom edge rather than dropping in from above. */
.ui-popover__content--sheet.ui-popover-enter-from,
.ui-popover__content--sheet.ui-popover-leave-to {
  transform: translateY(100%);
}
@media (prefers-reduced-motion: reduce) {
  .ui-popover-enter-active,
  .ui-popover-leave-active {
    transition-duration: 0.01ms;
  }
}
</style>
