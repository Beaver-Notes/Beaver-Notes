<template>
  <div v-if="peerList.length > 0" class="flex items-center -space-x-2">
    <div
      v-for="peer in visiblePeers"
      :key="peer.id"
      v-tooltip:top="peer.name"
      class="w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-bold text-white border-2 border-white dark:border-neutral-900 transition-all duration-200 ease-out"
      :style="{ backgroundColor: peer.color }"
    >
      {{ getInitials(peer.name) }}
    </div>
    <div
      v-if="overflowCount > 0"
      v-tooltip:top="overflowNames"
      class="w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-medium text-neutral-600 dark:text-neutral-300 bg-neutral-200 dark:bg-neutral-700 border-2 border-white dark:border-neutral-900"
    >
      +{{ overflowCount }}
    </div>
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
      if (props.peers && typeof props.peers === 'object') return Object.values(props.peers);
      return [];
    });

    const visiblePeers = computed(() =>
      peerList.value.slice(0, props.maxVisible)
    );

    const overflowCount = computed(() =>
      Math.max(0, peerList.value.length - props.maxVisible)
    );

    const overflowNames = computed(() =>
      peerList.value
        .slice(props.maxVisible)
        .map((p) => p.name)
        .join(', ')
    );

    function getInitials(name) {
      if (!name) return '?';
      return name.slice(0, 2).toUpperCase();
    }

    return { peerList, visiblePeers, overflowCount, overflowNames, getInitials };
  },
};
</script>
