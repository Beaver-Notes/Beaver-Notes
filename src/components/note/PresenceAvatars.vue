<template>
  <div
    v-if="peerList.length > 0"
    data-testid="presence-indicator"
    class="peer-avatars flex items-center"
  >
    <ui-popover placement="bottom-start" trigger="click" @hide="resetQuery">
      <template #trigger="{ isShow }">
        <button
          type="button"
          class="flex items-center -space-x-2 rounded-full p-0.5 cursor-pointer transition-transform duration-200 ease-[var(--ease-standard)] motion-reduce:transition-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-neutral-900"
          :class="{ 'scale-[1.03]': isShow }"
          :aria-label="triggerLabel"
          aria-haspopup="true"
          :aria-expanded="isShow ? 'true' : 'false'"
        >
          <span
            v-for="(peer, i) in visiblePeers"
            :key="peer.key"
            data-testid="presence-avatar"
            :data-peer-id="peer.key"
            :title="peer.label"
            class="peer-avatar relative w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-semibold select-none z-[var(--z)] ring-2 ring-white dark:ring-neutral-900 shadow-sm transition-[transform,box-shadow] duration-200 ease-[var(--ease-standard)] motion-reduce:transition-none"
            :style="{
              '--z': visiblePeers.length - i,
              backgroundColor: peer.color,
              color: getTextColor(peer.color),
            }"
          >
            {{ getInitials(peer.name) }}
          </span>

          <span
            v-if="overflowCount > 0"
            data-testid="presence-overflow"
            :title="overflowNames"
            class="relative w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-medium tabular-nums select-none text-neutral-500 dark:text-neutral-300 bg-neutral-100 dark:bg-neutral-800 ring-2 ring-white dark:ring-neutral-900 transition-[transform,box-shadow] duration-200 ease-[var(--ease-standard)] motion-reduce:transition-none hover:z-20 hover:-translate-y-0.5"
            :class="{ 'peer-pulse': isPulsing }"
          >
            +{{ overflowCount }}
          </span>
        </button>
      </template>

      <div class="w-64 flex flex-col max-h-80">
        <div
          class="px-3 pt-2.5 pb-2 border-b border-neutral-100 dark:border-neutral-800"
        >
          <h3
            class="text-xs font-semibold text-neutral-500 dark:text-neutral-400"
          >
            {{ peerList.length }}
            {{ peerList.length === 1 ? 'person' : 'people' }} here
          </h3>

          <input
            v-if="showSearch"
            v-model="query"
            type="search"
            placeholder="Search people"
            aria-label="Search people"
            class="mt-2 w-full h-8 px-2.5 text-[13px] rounded-md outline-none bg-neutral-100 dark:bg-neutral-800 text-neutral-800 dark:text-neutral-100 placeholder:text-neutral-400 focus-visible:ring-2 focus-visible:ring-primary-500"
          />
        </div>

        <div class="overflow-y-auto py-1" role="list">
          <div
            v-for="peer in filteredPeers"
            :key="peer.key"
            role="listitem"
            class="flex items-center gap-2.5 px-2.5 py-1 mx-1 rounded-lg transition-colors duration-150 motion-reduce:transition-none hover:bg-neutral-100 dark:hover:bg-neutral-800"
          >
            <span
              class="w-7 h-7 shrink-0 rounded-full flex items-center justify-center text-[11px] font-semibold ring-1 ring-black/5 dark:ring-white/10"
              :style="{
                backgroundColor: peer.color,
                color: getTextColor(peer.color),
              }"
              aria-hidden="true"
            >
              {{ getInitials(peer.name) }}
            </span>

            <span
              data-testid="presence-peer-name"
              class="text-[13px] font-medium text-neutral-800 dark:text-neutral-100 truncate"
            >
              {{ peer.label }}
            </span>

            <span
              v-if="peer.isSelf"
              class="ml-auto shrink-0 text-xs text-neutral-400 dark:text-neutral-500"
            >
              You
            </span>
          </div>

          <p
            v-if="filteredPeers.length === 0"
            class="px-3 py-4 text-center text-xs text-neutral-400 dark:text-neutral-500"
          >
            No one matches "{{ query }}"
          </p>
        </div>
      </div>
    </ui-popover>

    <!-- Announces joins/leaves to screen readers without moving focus -->
    <span class="sr-only" role="status" aria-live="polite">
      {{ announcement }}
    </span>
  </div>
</template>

<script>
import { computed, ref, watch, onBeforeUnmount } from 'vue';
import { displayName, getInitials } from '@/utils/displayName';

const PULSE_MS = 700;
const SEARCH_THRESHOLD = 8;

export default {
  props: {
    peers: {
      type: [Map, Object],
      default: () => new Map(),
    },
    // Max avatars before collapsing into a "+N" chip.
    maxVisible: {
      type: Number,
      default: 4,
    },
    // Id (or accountId) of the current user. Pinned first and labelled "You".
    selfId: {
      type: [String, Number],
      default: null,
    },
  },
  setup(props) {
    const query = ref('');
    const isPulsing = ref(false);
    const announcement = ref('');
    let pulseTimer = null;
    let announceTimer = null;

    /* ---------- Normalised peers ---------- */

    const peerList = computed(() => {
      let raw = [];
      if (props.peers instanceof Map) raw = [...props.peers.values()];
      else if (props.peers && typeof props.peers === 'object')
        raw = Object.values(props.peers);

      return raw.map((peer, i) => {
        const key = peer.id ?? peer.accountId ?? `peer-${i}`;
        const isSelf =
          props.selfId != null && String(key) === String(props.selfId);
        const name = peer.name || '';
        return {
          ...peer,
          key,
          isSelf,
          name,
          label: name || displayName({ id: peer.id }),
        };
      });
    });

    // Stack: you first, everyone else in join order so avatars don't reshuffle.
    const stackPeers = computed(() => {
      const list = peerList.value;
      return [
        ...list.filter((p) => p.isSelf),
        ...list.filter((p) => !p.isSelf),
      ];
    });

    // Popover: you first, then alphabetical.
    const sortedPeers = computed(() =>
      [...peerList.value].sort((a, b) => {
        if (a.isSelf !== b.isSelf) return a.isSelf ? -1 : 1;
        return a.label.localeCompare(b.label, undefined, {
          sensitivity: 'base',
        });
      }),
    );

    /* ---------- Stack and overflow ---------- */

    // Never render a "+1" chip: show the extra person instead.
    const effectiveMax = computed(() =>
      stackPeers.value.length === props.maxVisible + 1
        ? props.maxVisible + 1
        : props.maxVisible,
    );

    const visiblePeers = computed(() =>
      stackPeers.value.slice(0, effectiveMax.value),
    );

    const overflowCount = computed(() =>
      Math.max(0, stackPeers.value.length - effectiveMax.value),
    );

    const overflowNames = computed(() =>
      stackPeers.value
        .slice(effectiveMax.value)
        .map((p) => p.label)
        .join(', '),
    );

    const triggerLabel = computed(() => {
      const n = peerList.value.length;
      return `${n} ${n === 1 ? 'person' : 'people'} here. Show list`;
    });

    /* ---------- Search ---------- */

    const showSearch = computed(() => peerList.value.length > SEARCH_THRESHOLD);

    const filteredPeers = computed(() => {
      const q = query.value.trim().toLowerCase();
      if (!q) return sortedPeers.value;
      return sortedPeers.value.filter((p) => p.label.toLowerCase().includes(q));
    });

    function resetQuery() {
      query.value = '';
    }

    // If the list shrinks enough to hide the search box, drop any stale query.
    watch(showSearch, (visible) => {
      if (!visible) resetQuery();
    });

    /* ---------- Join pulse and live announcements ---------- */

    watch(
      () => peerList.value.map((p) => p.key),
      (next, prev) => {
        const prevSet = new Set(prev);
        const nextSet = new Set(next);
        const joined = peerList.value.filter(
          (p) => !prevSet.has(p.key) && !p.isSelf,
        );
        const left = prev.filter((k) => !nextSet.has(k));

        if (!joined.length && !left.length) return;

        if (overflowCount.value > 0) {
          isPulsing.value = false;
          // Next frame, so the animation restarts on rapid changes.
          requestAnimationFrame(() => {
            isPulsing.value = true;
            clearTimeout(pulseTimer);
            pulseTimer = setTimeout(() => (isPulsing.value = false), PULSE_MS);
          });
        }

        if (joined.length) {
          announcement.value =
            joined.length === 1
              ? `${joined[0].label} joined`
              : `${joined.length} people joined`;
        } else {
          announcement.value = `${left.length} ${
            left.length === 1 ? 'person' : 'people'
          } left`;
        }

        clearTimeout(announceTimer);
        announceTimer = setTimeout(() => (announcement.value = ''), 2000);
      },
    );

    onBeforeUnmount(() => {
      clearTimeout(pulseTimer);
      clearTimeout(announceTimer);
    });

    /* ---------- Helpers ---------- */

    // Choose white or near-black text for contrast against the avatar colour.
    // Handles #rgb and #rrggbb; anything else falls back to white.
    function getTextColor(color) {
      let hex = (color || '').trim().replace(/^#/, '');
      if (/^[\da-f]{3}$/i.test(hex)) hex = hex.replace(/(.)/g, '$1$1');
      const m = /^([\da-f]{2})([\da-f]{2})([\da-f]{2})$/i.exec(hex);
      if (!m) return '#fff';
      const [r, g, b] = m.slice(1).map((h) => parseInt(h, 16) / 255);
      const lin = (c) =>
        c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
      const L = 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
      return L > 0.5 ? '#171717' : '#fff';
    }

    return {
      query,
      isPulsing,
      announcement,
      peerList,
      visiblePeers,
      overflowCount,
      overflowNames,
      triggerLabel,
      showSearch,
      filteredPeers,
      resetQuery,
      getInitials,
      getTextColor,
    };
  },
};
</script>

<style scoped>
.peer-pulse {
  animation: peer-pulse 0.7s var(--ease-standard, ease-out);
}

@keyframes peer-pulse {
  0% {
    transform: scale(1);
    box-shadow: 0 0 0 0 rgb(99 102 241 / 0.45);
  }
  40% {
    transform: scale(1.12);
  }
  100% {
    transform: scale(1);
    box-shadow: 0 0 0 8px rgb(99 102 241 / 0);
  }
}

@media (prefers-reduced-motion: reduce) {
  .peer-pulse {
    animation: none;
  }
}
</style>
