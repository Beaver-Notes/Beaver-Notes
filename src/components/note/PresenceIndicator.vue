<template>
  <div v-if="peerList.length > 0" class="presence-indicator flex items-center gap-2">
    <div class="flex items-center -space-x-2">
      <div
        v-for="(peer, i) in visiblePeers"
        :key="peer.id"
        class="relative w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-semibold text-white ring-2 ring-white dark:ring-neutral-900 shadow-sm transition-transform duration-150 hover:z-10 hover:-translate-y-0.5"
        :style="{
          backgroundColor: peer.color,
          zIndex: visiblePeers.length - i,
        }"
        :title="peer.name"
      >
        {{ getInitials(peer.name) }}
      </div>
      <div
        v-if="overflowCount > 0"
        class="relative w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-semibold text-neutral-600 dark:text-neutral-200 bg-neutral-100 dark:bg-neutral-800 ring-2 ring-white dark:ring-neutral-900 shadow-sm"
        :title="`and ${overflowCount} more`"
      >
        +{{ overflowCount }}
      </div>
    </div>
    <span class="text-xs text-neutral-500 dark:text-neutral-400 whitespace-nowrap">
      {{ peerList.length }} {{ peerList.length === 1 ? 'user' : 'users' }} editing
    </span>
  </div>
</template>

<script>
import { computed, onMounted, onUnmounted, watch } from 'vue';
import { usePresence } from '@/composable/usePresence';

export default {
  props: {
    awareness: { type: Object, default: null },
    userName: { type: String, default: 'Anonymous' },
    maxVisible: { type: Number, default: 3 },
  },
  setup(props) {
    const { peers, init, destroy } = usePresence(
      () => props.awareness,
      props.awareness?.clientID?.toString() || 'local',
      props.userName
    );

    onMounted(() => {
      init();
    });

    // Re-init when awareness becomes available after mount (per-doc guard)
    watch(
      () => props.awareness,
      (aw, old) => {
        if (old) destroy();
        if (aw) init();
      }
    );

    onUnmounted(() => {
      destroy();
    });

    const peerList = computed(() => {
      if (peers.value instanceof Map) return [...peers.value.values()];
      if (peers.value && typeof peers.value === 'object') return Object.values(peers.value);
      return [];
    });

    const visiblePeers = computed(() =>
      peerList.value.slice(0, props.maxVisible)
    );

    const overflowCount = computed(() =>
      Math.max(0, peerList.value.length - props.maxVisible)
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
