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
        @click="hide"
      ></div>
      <Transition name="ui-popover">
        <div
          v-show="isShow"
          ref="content"
          :style="sheet ? undefined : floatingStyles"
          :class="[
            originClass,
            sheet
              ? 'ui-popover__content--sheet fixed inset-x-0 bottom-0 w-full rounded-t-2xl border-x-0 border-b-0 max-h-[80dvh] overflow-y-auto p-2 pb-[max(env(safe-area-inset-bottom),0.75rem)]'
              : 'rounded-xl p-1',
          ]"
          class="ui-popover__content bg-white dark:bg-neutral-900 shadow-xl border z-50"
        >
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
