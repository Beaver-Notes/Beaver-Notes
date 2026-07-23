<script>
import { h, Transition, TransitionGroup } from 'vue';

export default {
  props: {
    group: Boolean,
  },
  setup(props, { slots, attrs }) {
    function enter(element) {
      const { width } = getComputedStyle(element);

      element.style.width = width;
      element.style.position = 'absolute';
      element.style.visibility = 'hidden';
      element.style.height = 'auto';

      const { height } = getComputedStyle(element);

      element.style.width = null;
      element.style.position = null;
      element.style.visibility = null;
      element.style.height = '0px';
      element.style.transition = 'height var(--motion-base) var(--ease-standard)';

      void element.offsetHeight;

      element.style.height = height;
    }
    function afterEnter(element) {
      element.style.height = 'auto';
      element.style.transition = '';
    }
    function leave(element) {
      const { height } = getComputedStyle(element);
      element.style.height = height;
      element.style.transition = 'height var(--motion-base) var(--ease-standard)';

      void element.offsetHeight;

      element.style.height = '0px';
    }
    function afterLeave(element) {
      element.style.height = '';
      element.style.transition = '';
    }

    return () =>
      h(
        props.group ? TransitionGroup : Transition,
        {
          ...attrs,
          name: 'expand',
          onEnter: enter,
          onAfterEnter: afterEnter,
          onLeave: leave,
          onAfterLeave: afterLeave,
        },
        slots.default
      );
  },
};
</script>
<style>
.expand-enter-active,
.expand-leave-active {
  overflow: hidden;
}

.expand-enter,
.expand-leave-to {
  height: 0;
}

@media (prefers-reduced-motion: reduce) {
  .expand-enter-active,
  .expand-leave-active {
    transition-duration: 0.01ms;
  }
}
</style>
