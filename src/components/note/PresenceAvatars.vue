<template>
  <div v-if="peerList.length > 0" class="peer-avatars flex items-center">
    <ui-popover placement="bottom-start" trigger="click">
      <template #trigger="{ isShow }">
        <div
          class="flex items-center -space-x-2.5 cursor-pointer rounded-full transition-transform duration-200 ease-[cubic-bezier(0.25,0.46,0.45,0.94)]"
          :class="{ 'scale-[1.03]': isShow }"
        >
          <div
            v-for="(peer, i) in visiblePeers"
            :key="peer.id"
            class="peer-avatar relative w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-semibold text-white ring-2 ring-white dark:ring-neutral-900 shadow-sm transition-all duration-200 ease-[cubic-bezier(0.25,0.46,0.45,0.94)] hover:z-10 hover:-translate-y-0.5 hover:shadow-md"
            :style="{
              backgroundColor: peer.color,
              zIndex: visiblePeers.length - i,
            }"
          >
            {{ getInitials(peer.name) }}
          </div>

          <div
            v-if="overflowCount > 0"
            class="relative w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-semibold text-neutral-600 dark:text-neutral-200 bg-neutral-100 dark:bg-neutral-800 ring-2 ring-white dark:ring-neutral-900 shadow-sm transition-all duration-200 ease-[cubic-bezier(0.25,0.46,0.45,0.94)] hover:z-10 hover:-translate-y-0.5 hover:shadow-md"
          >
            +{{ overflowCount }}
          </div>
        </div>
      </template>

      <div class="w-64 max-h-80 overflow-y-auto">
        <div
          class="px-3 pt-2 pb-1.5 text-[11px] font-semibold uppercase tracking-wide text-neutral-400 dark:text-neutral-500"
        >
          {{ peerList.length }}
          {{ peerList.length === 1 ? 'person' : 'people' }} here
        </div>

        <div class="py-1">
          <div
            v-for="peer in peerList"
            :key="peer.id"
            class="flex items-center gap-2.5 px-2.5 py-1.5 rounded-lg mx-1 transition-colors duration-150 hover:bg-neutral-100 dark:hover:bg-neutral-800"
          >
            <div
              class="w-7 h-7 shrink-0 rounded-full flex items-center justify-center text-[11px] font-semibold text-white ring-1 ring-black/5"
              :style="{ backgroundColor: peer.color }"
            >
              {{ getInitials(peer.name) }}
            </div>
            <span
              class="text-[13px] font-medium text-neutral-800 dark:text-neutral-100 truncate"
            >
              {{ peer.name }}
            </span>
          </div>
        </div>
      </div>
    </ui-popover>
  </div>
</template>

<script>
import { computed } from 'vue';

export default {
  props: {
    peers: {
      type: [Map, Object],
      default: () => new Map(),
    },
    maxVisible: {
      type: Number,
      default: 5,
    },
  },
  setup(props) {
    const peerList = computed(() => {
      if (props.peers instanceof Map) return [...props.peers.values()];
      if (props.peers && typeof props.peers === 'object')
        return Object.values(props.peers);
      return [];
    });

    const visiblePeers = computed(() =>
      peerList.value.slice(0, props.maxVisible),
    );

    const overflowCount = computed(() =>
      Math.max(0, peerList.value.length - props.maxVisible),
    );

    function getInitials(name) {
      if (!name) return '?';
      const parts = name.trim().split(/\s+/);
      if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
      return (parts[0][0] + parts[1][0]).toUpperCase();
    }

    return { peerList, visiblePeers, overflowCount, getInitials };
  },
};
</script>
