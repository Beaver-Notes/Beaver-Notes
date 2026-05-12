<!-- eslint-disable vue/multi-word-component-names -->
<template>
  <div class="ui-popover inline-block" :class="{ hidden: to }">
    <div ref="targetEl" class="ui-popover__trigger h-full inline-block" @click="onTriggerClick">
      <slot name="trigger" v-bind="{ isShow }"></slot>
    </div>
    <Teleport to="body">
      <div
        v-if="isShow"
        ref="content"
        :style="floatingStyles"
        class="ui-popover__content bg-white dark:bg-neutral-800 rounded-xl shadow-xl border z-50"
        :class="[padding]"
      >
        <slot v-bind="{ isShow }"></slot>
      </div>
    </Teleport>
  </div>
</template>
<script>
import { ref, computed, watch, onMounted, onUnmounted } from 'vue';
import { useFloating, offset, flip, shift, autoUpdate } from '@floating-ui/vue';

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
    padding: {
      type: String,
      default: 'p-3',
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
  emits: ['show', 'trigger', 'close'],
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
    const middleware = computed(() => [offset(0), flip(), shift({ padding: 8 })]);

    const { floatingStyles } = useFloating(reference, content, {
      placement,
      middleware,
      whileElementsMounted: autoUpdate,
    });

    const show = () => {
      if (props.disabled) return;
      isShow.value = true;
      emit('show');
      emit('trigger');
    };

    const hide = () => {
      isShow.value = false;
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
        }
      }
    );

    const handleClickOutside = (e) => {
      if (!isShow.value) return;
      const target = reference.value;
      const floating = content.value;
      if (target && !target.contains(e.target) && floating && !floating.contains(e.target)) {
        hide();
      }
    };

    onMounted(() => {
      document.addEventListener('click', handleClickOutside, true);
    });

    onUnmounted(() => {
      document.removeEventListener('click', handleClickOutside, true);
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
