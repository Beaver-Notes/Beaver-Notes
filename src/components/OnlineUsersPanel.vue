<template>
  <div
    class="fixed top-0 right-0 w-72 h-full bg-white dark:bg-neutral-800 border-l border-neutral-200 dark:border-neutral-700 z-50 flex flex-col"
  >
    <div
      class="flex items-center justify-between p-4 border-b border-neutral-200 dark:border-neutral-700"
    >
      <h3 class="text-sm font-semibold text-neutral-900 dark:text-neutral-100">
        Online ({{ peerList.length + 1 }})
      </h3>
      <button
        class="text-neutral-500 hover:text-neutral-700 dark:hover:text-neutral-300"
        @click="$emit('close')"
      >
        &#x2715;
      </button>
    </div>
    <div class="flex-1 overflow-auto">
      <div
        class="flex items-center gap-3 p-4 border-b border-neutral-200 dark:border-neutral-700"
      >
        <div
          class="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold text-white"
          :style="{ backgroundColor: localColor }"
        >
          {{ getInitials(localName) }}
        </div>
        <div>
          <p class="text-sm font-medium text-neutral-900 dark:text-neutral-100">
            {{ localName }} (you)
          </p>
        </div>
      </div>
      <div
        v-for="peer in peerList"
        :key="peer.id"
        class="flex items-center gap-3 p-4 border-b border-neutral-200 dark:border-neutral-700"
      >
        <div
          class="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold text-white"
          :style="{ backgroundColor: peer.color }"
        >
          {{ getInitials(peer.name) }}
        </div>
        <div>
          <p class="text-sm font-medium text-neutral-900 dark:text-neutral-100">
            {{ peer.name }}
          </p>
        </div>
      </div>
      <div
        v-if="peerList.length === 0"
        class="p-4 text-center text-neutral-500"
      >
        No other users online
      </div>
    </div>
  </div>
</template>

<script>
import { computed } from 'vue';

export default {
  props: {
    peers: { type: [Map, Object], default: () => ({}) },
    localColor: { type: String, default: '#3B82F6' },
    localName: { type: String, default: 'Anonymous' },
  },
  emits: ['close'],
  setup(props) {
    const peerList = computed(() => {
      if (props.peers instanceof Map) return [...props.peers.values()];
      return Object.values(props.peers);
    });

    function getInitials(name) {
      if (!name) return '?';
      return name.slice(0, 2).toUpperCase();
    }

    return { peerList, getInitials };
  },
};
</script>
