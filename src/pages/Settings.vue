<template>
  <div
    class="container py-6 mobile:px-4 mobile:pb-[calc(var(--app-mobile-content-offset)+1.5rem)]"
  >
    <h1 class="text-3xl mb-10 font-bold mobile:hidden">
      {{ pageTitle }}
    </h1>

    <!-- Desktop -->
    <div class="flex mobile:hidden">
      <div class="w-64 shrink-0">
        <div class="sticky top-10 ltr:mr-8 rtl:ml-8 space-y-3">
          <div class="relative">
            <v-remixicon
              name="riSearchLine"
              size="16"
              class="absolute left-2.5 top-1/2 -translate-y-1/2 text-neutral-400 pointer-events-none"
            />
            <input
              v-model="searchQuery"
              type="text"
              :placeholder="translations.settings.search || 'Search settings'"
              class="w-full pl-8 pr-3 py-1.5 text-sm rounded-lg border bg-neutral-50 dark:bg-neutral-900 dark:border-neutral-700 focus:outline-none focus:ring-1 focus:ring-primary placeholder:text-neutral-400"
            />
          </div>
          <ui-list
            class="space-y-1 rounded-lg dark:text-[color:var(--selected-dark-text)] text-gray-600"
          >
            <router-link
              v-for="(item, id) in filteredSettings"
              v-slot="{ isExactActive }"
              :key="id"
              :to="item.path"
              class="block"
            >
              <ui-list-item :active="isExactActive">
                <v-remixicon :name="item.icon" class="ltr:mr-2 rtl:ml-2" />
                {{ item.name }}
              </ui-list-item>
            </router-link>
            <p
              v-if="Object.keys(filteredSettings).length === 0"
              class="px-2 py-3 text-sm text-neutral-400 text-center"
            >
              {{ translations.settings.noResults || 'No matches' }}
            </p>
          </ui-list>
        </div>
      </div>
      <router-view />
    </div>

    <!-- Mobile -->
    <div class="hidden mobile:block">
      <!-- Category menu (drill-down hub) -->
      <div v-if="showMobileMenu">
        <div class="mb-5 space-y-1">
          <h1 class="text-3xl font-bold text-neutral-900 dark:text-neutral-100">
            {{ translations.settings.title || 'Settings' }}
          </h1>
        </div>
        <div class="relative mb-4">
          <v-remixicon
            name="riSearchLine"
            size="16"
            class="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400 pointer-events-none"
          />
          <input
            v-model="searchQuery"
            type="text"
            :placeholder="translations.settings.search || 'Search settings'"
            class="w-full pl-9 pr-3 py-2.5 text-sm rounded-xl border bg-neutral-50 dark:bg-neutral-900 dark:border-neutral-700 focus:outline-none focus:ring-1 focus:ring-primary placeholder:text-neutral-400"
          />
        </div>
        <div
          class="divide-y divide-neutral-200 dark:divide-neutral-800 bg-neutral-50 dark:bg-neutral-900 rounded-xl border overflow-hidden"
        >
          <button
            v-for="(item, id) in filteredMobileSettings"
            :key="id"
            class="w-full flex items-center gap-3 px-4 py-3.5 text-left active:bg-neutral-100 dark:active:bg-neutral-800 transition-colors"
            @click="enterSection(item)"
          >
            <span
              class="shrink-0 w-8 h-8 rounded-lg bg-primary/10 text-primary flex items-center justify-center"
            >
              <v-remixicon :name="item.icon" size="18" />
            </span>
            <span class="flex-1 text-sm font-medium text-neutral-800 dark:text-neutral-200">
              {{ item.name }}
            </span>
            <v-remixicon
              name="riArrowRightSLine"
              size="18"
              class="text-neutral-400 rtl:rotate-180"
            />
          </button>
          <p
            v-if="Object.keys(filteredMobileSettings).length === 0"
            class="px-4 py-6 text-sm text-neutral-400 text-center"
          >
            {{ translations.settings.noResults || 'No matches' }}
          </p>
        </div>
      </div>

      <!-- Section content -->
      <div v-else>
        <div
          ref="mobileHeaderRef"
          class="settings-mobile-header sticky z-[200] -mx-4 mb-6 bg-neutral-50 px-4 py-3 top-0 flex items-center gap-2"
          :style="mobileHeaderStyle"
        >
          <button
            class="shrink-0 -ml-1 w-8 h-8 rounded-full flex items-center justify-center active:bg-neutral-200 dark:active:bg-neutral-800 transition-colors"
            :aria-label="translations.dialog?.back || 'Back to settings'"
            @click="exitSection"
          >
            <v-remixicon name="riArrowLeftSLine" size="20" class="rtl:rotate-180" />
          </button>
          <h1 class="text-lg font-semibold text-neutral-900 dark:text-neutral-100 truncate">
            {{ pageTitle }}
          </h1>
        </div>

        <router-view />
      </div>
    </div>
  </div>
</template>
<script setup>
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useTranslations } from '@/composable/useTranslations';

const { translations } = useTranslations();
const route = useRoute();
const router = useRouter();
const mobileHeaderRef = ref(null);
const isMobileHeaderStuck = ref(false);
const searchQuery = ref('');

// On mobile, the settings root ('/settings') is shared between the
// drill-down category menu and the "General" section's own content.
// This flag tracks whether the user has explicitly entered "General"
// from the menu, since the URL doesn't change between the two states.
const enteredGeneralOnMobile = ref(false);

const settings = computed(() => {
  const t = translations.value;
  return {
    Settings: {
      name: t.settings.general || 'General',
      icon: 'riWindowLine',
      path: '/settings',
      keywords: [t.settings.general?.toLowerCase() || 'general', 'settings'],
    },
    'Settings-Appearance': {
      name: t.settings.appearance || 'Appearance',
      icon: 'riBrush3Fill',
      path: '/settings/appearance',
      keywords: [
        t.settings.appearance?.toLowerCase() || 'appearance',
        'accent color',
        'theme',
        'interface',
        'reduced motion',
        'animation',
        'accessibility',
      ],
    },
    'Settings-Security': {
      name: t.settings.security || 'Security',
      icon: 'riShieldLine',
      path: '/settings/security',
      keywords: [t.settings.security?.toLowerCase() || 'security'],
    },
    'Settings-Account': {
      name: t.settings.account || 'Account',
      icon: 'riUserLine',
      path: '/settings/account',
      keywords: [t.settings.account?.toLowerCase() || 'account'],
    },
    'Settings-Data': {
      name: t.settings.data || 'Data',
      icon: 'riDatabase2Line',
      path: '/settings/data',
      keywords: [t.settings.data?.toLowerCase() || 'data'],
    },
    'Settings-Labels': {
      name: t.labels?.title || 'Labels',
      icon: 'riPriceTag3Line',
      path: '/settings/labels',
      keywords: [t.labels?.title?.toLowerCase() || 'labels'],
    },
    'Settings-Shortcuts': {
      name: t.settings.shortcuts || 'Shortcuts',
      icon: 'riKeyboardLine',
      path: '/settings/shortcuts',
      keywords: [t.settings.shortcuts?.toLowerCase() || 'shortcuts'],
    },
    'Settings-About': {
      name: t.settings.about || 'About',
      icon: 'riInformationLine',
      path: '/settings/about',
      keywords: [t.settings.about?.toLowerCase() || 'about'],
    },
  };
});

const mobileSettings = computed(() =>
  Object.fromEntries(
    Object.entries(settings.value).filter(
      ([key]) => key !== 'Settings-Shortcuts'
    )
  )
);

function matchesQuery(item) {
  if (!searchQuery.value.trim()) return true;
  const query = searchQuery.value.trim().toLowerCase();
  return (
    item.name.toLowerCase().includes(query) ||
    item.icon.toLowerCase().includes(query) ||
    item.path.toLowerCase().includes(query) ||
    (item.keywords && item.keywords.some((k) => k.toLowerCase().includes(query)))
  );
}

const filteredSettings = computed(() =>
  Object.fromEntries(
    Object.entries(settings.value).filter(([, item]) => matchesQuery(item))
  )
);

const filteredMobileSettings = computed(() =>
  Object.fromEntries(
    Object.entries(mobileSettings.value).filter(([, item]) => matchesQuery(item))
  )
);

const showMobileMenu = computed(
  () => route.name === 'index' && !enteredGeneralOnMobile.value
);

const pageTitle = computed(() => {
  if (route.name === 'index') return settings.value.Settings.name;
  return settings.value[route.name]?.name || '-';
});

function enterSection(item) {
  searchQuery.value = '';
  if (item.path === '/settings') {
    enteredGeneralOnMobile.value = true;
    return;
  }
  router.push(item.path);
}

function exitSection() {
  if (route.name === 'index') {
    enteredGeneralOnMobile.value = false;
    return;
  }
  router.push('/settings');
}

// Any navigation away from the settings root means the next time we land
// back on '/settings' (e.g. via the browser back button) it should show
// the category menu again, not stale "General" content.
watch(
  () => route.name,
  (name) => {
    if (name !== 'index') enteredGeneralOnMobile.value = false;
  }
);

const mobileHeaderStyle = computed(() => ({
  paddingTop: isMobileHeaderStuck.value
    ? 'calc(var(--app-safe-area-top))'
    : undefined,
}));

function syncStickyState() {
  if (typeof window === 'undefined' || !mobileHeaderRef.value) return;

  const { top } = mobileHeaderRef.value.getBoundingClientRect();
  isMobileHeaderStuck.value = top <= 0;
}

onMounted(() => {
  syncStickyState();
  window.addEventListener('scroll', syncStickyState, { passive: true });
  window.addEventListener('resize', syncStickyState, { passive: true });
});

onUnmounted(() => {
  window.removeEventListener('scroll', syncStickyState);
  window.removeEventListener('resize', syncStickyState);
});
</script>

<style scoped>
.settings-mobile-header {
  transition: box-shadow 180ms ease, background-color 180ms ease;
  @apply border-y border-neutral-200 shadow-sm dark:border-neutral-800 dark:bg-neutral-900;
}
</style>
