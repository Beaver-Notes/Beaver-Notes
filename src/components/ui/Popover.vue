<template>
  <div class="ui-popover inline-block" :class="{ hidden: to }">
    <div
      ref="targetEl"
      class="ui-popover__trigger h-full inline-block"
      @click="onTriggerClick"
    >
      <slot name="trigger" v-bind="{ isShow }"></slot>
    </div>
    <Teleport to="body">
      <Transition name="ui-popover">
        <div
          v-show="isShow"
          ref="content"
          :style="floatingStyles"
          class="ui-popover__content bg-white dark:bg-neutral-900 rounded-xl shadow-xl border z-50 p-1.5"
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

    const placement = computed(() => props.placement);
    const middleware = computed(() => [
      offset(15),
      flip(),
      shift({ padding: 15 }),
    ]);

    const { floatingStyles } = useFloating(reference, content, {
      placement,
      middleware,
      whileElementsMounted: autoUpdate,
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
      onTriggerClick,
    };
  },
};
</script>
<style>
.ui-popover-enter-active {
  transition: opacity var(--motion-fast) var(--ease-snappy),
    transform var(--motion-fast) var(--ease-snappy);
}
.ui-popover-leave-active {
  transition: opacity var(--motion-fast) var(--ease-exit),
    transform var(--motion-fast) var(--ease-exit);
}
.ui-popover-enter-from,
.ui-popover-leave-to {
  opacity: 0;
  transform: scale(0.97);
}
.ui-popover-enter-to,
.ui-popover-leave-from {
  opacity: 1;
  transform: scale(1);
}
@media (prefers-reduced-motion: reduce) {
  .ui-popover-enter-active,
  .ui-popover-leave-active {
    transition-duration: 0.01ms;
  }
}
</style>
