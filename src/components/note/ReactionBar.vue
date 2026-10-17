<template>
  <div class="relative flex items-center gap-1 flex-wrap">
    <button
      v-for="r in visibleReactions"
      :key="r.emoji"
      type="button"
      class="inline-flex items-center gap-1 h-7 px-2 rounded-full text-xs font-medium border transition motion-press focus-visible:ring-2 focus-visible:ring-secondary focus-visible:ring-offset-1 focus-visible:ring-offset-white dark:focus-visible:ring-offset-neutral-900"
      :class="hasReacted(r)
        ? 'bg-primary/10 text-primary border-primary/30'
        : 'bg-neutral-50 dark:bg-neutral-800 border-neutral-200 dark:border-neutral-700 text-neutral-600 dark:text-neutral-300 hover:border-neutral-300 dark:hover:border-neutral-600'"
      :aria-pressed="hasReacted(r) ? 'true' : 'false'"
      @click="$emit('toggle', r.emoji)"
    >
      <span class="text-sm leading-none">{{ r.emoji }}</span>
      <span class="tabular-nums">{{ r.userIds.length }}</span>
    </button>
    <button
      type="button"
      class="inline-flex items-center justify-center h-7 w-7 rounded-full border border-dashed border-neutral-300 dark:border-neutral-600 text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200 transition opacity-100 md:opacity-0 md:group-hover:opacity-100 md:focus-visible:opacity-100 mobile:h-11 mobile:w-11 focus-visible:ring-2 focus-visible:ring-secondary focus-visible:outline-none"
      :aria-label="ariaLabel"
      :aria-expanded="open ? 'true' : 'false'"
      @click="open = !open"
    >
      <v-remixicon name="riEmotionLine" size="14" />
    </button>
    <template v-if="open">
      <button
        type="button"
        class="fixed inset-0 z-10 cursor-default"
        tabindex="-1"
        aria-hidden="true"
        @click="open = false"
      />
      <div
        class="absolute bottom-full mb-1 ltr:right-0 rtl:left-0 z-20 flex gap-0.5 p-1 rounded-full bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 shadow-lg motion-spring-enter"
        role="menu"
        :aria-label="ariaLabel"
      >
        <button
          v-for="e in EMOJIS"
          :key="e"
          type="button"
          role="menuitem"
          class="w-9 h-9 mobile:w-11 mobile:h-11 grid place-items-center rounded-full hover:bg-neutral-100 dark:hover:bg-neutral-800 text-base hover:-translate-y-0.5 hover:scale-110 transition-[background-color,transform] duration-200 motion-reduce:transition-none motion-reduce:hover:transform-none focus-visible:ring-2 focus-visible:ring-secondary focus-visible:outline-none"
          @click="pick(e)"
        >
          {{ e }}
        </button>
      </div>
    </template>
  </div>
</template>

<script>
import { ref, computed } from 'vue';

const EMOJIS = ['👍', '✅', '👀', '❤️', '😄', '🎉'];

export default {
  props: {
    reactions: { type: Array, default: () => [] },
    myId: { type: String, default: null },
    ariaLabel: { type: String, default: 'Add reaction' },
  },
  emits: ['toggle'],
  setup(props, { emit }) {
    const open = ref(false);
    // Whitelist at render: the server cannot check ciphertext, so unknown
    // emoji (from a misbehaving client) never renders.
    const visibleReactions = computed(() =>
      (props.reactions || []).filter(
        (r) =>
          EMOJIS.includes(r.emoji) &&
          Array.isArray(r.userIds) &&
          r.userIds.length > 0,
      )
    );
    function hasReacted(r) {
      return !!props.myId && r.userIds.includes(props.myId);
    }
    function pick(emoji) {
      open.value = false;
      emit('toggle', emoji);
    }
    return { open, EMOJIS, visibleReactions, hasReacted, pick };
  },
};
</script>
