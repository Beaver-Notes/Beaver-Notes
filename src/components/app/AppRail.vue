<template>
  <div
    v-show="railVisible"
    data-testid="app-rail"
    class="fixed inset-y-0 right-0 z-40 w-[var(--app-rail-width)] flex-col justify-between no-print hidden foldable:flex"
    :style="railStyle"
  >
    <div
      id="app-rail-top"
      class="flex min-h-0 flex-1 flex-col items-center gap-1 overflow-y-auto px-2"
      :class="{ 'justify-end': !navVisible }"
    ></div>
    <!-- Notes pages route their own controls through the top slot, so the nav
         cluster would duplicate chrome; hide it there like Onboarding, and let
         the note controls take its place at the bottom of the rail. -->
    <div
      v-if="navVisible"
      id="app-rail-bottom"
      class="flex shrink-0 flex-col items-center gap-2 px-2 pb-2"
    >
      <workspace-switcher v-if="foldState.isFoldable" />
      <app-navbar v-if="foldState.isFoldable" />
    </div>
  </div>
</template>

<script>
import { computed } from 'vue';
import { useRoute } from 'vue-router';
import { foldState } from '@/lib/foldable';
import AppNavbar from '@/components/app/AppNavbar.vue';
import WorkspaceSwitcher from '@/components/app/WorkspaceSwitcher.vue';

export default {
  components: { AppNavbar, WorkspaceSwitcher },
  setup() {
    const route = useRoute();
    const railVisible = computed(
      () => foldState.isFoldable && route.name !== 'Onboarding'
    );
    // Note pages own the rail via NoteActions; keep global nav out of the way.
    const navVisible = computed(
      () => foldState.isFoldable && route.name !== 'Note'
    );
    const railStyle = {
      paddingTop: 'var(--app-rail-safe-top)',
      paddingBottom: 'var(--app-safe-area-bottom)',
    };

    return { foldState, railStyle, railVisible, navVisible };
  },
};
</script>
