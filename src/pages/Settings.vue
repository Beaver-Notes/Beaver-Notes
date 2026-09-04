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
            <ui-input
              v-model="searchQuery"
              prepend-icon="riSearchLine"
              :placeholder="translations.settings.search || 'Search settings'"
            />
          </div>
          <ui-list
            class="space-y-1 rounded-xl dark:text-[color:var(--selected-dark-text)] text-gray-600"
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
        <ui-input
          v-model="searchQuery"
          prepend-icon="riSearchLine"
          :placeholder="translations.settings.search || 'Search settings'"
          clearable
          class="mb-4"
        />
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
            <span
              class="flex-1 text-sm font-medium text-neutral-800 dark:text-neutral-200"
            >
              {{ item.name }}
            </span>
            <v-remixicon
              name="riArrowRightLine"
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

      <div v-else>
        <div class="mb-5 flex items-center gap-1">
          <button
            class="-ml-2 flex h-9 w-9 items-center justify-center text-neutral-500 dark:text-neutral-400 active:opacity-60 transition-opacity"
            :aria-label="translations.dialog?.back || 'Back to settings'"
            @click="exitSection"
          >
            <v-remixicon
              name="riArrowLeftLine"
              size="26"
              class="rtl:rotate-180"
            />
          </button>
          <h1
            class="text-3xl font-bold text-neutral-900 dark:text-neutral-100"
          >
            {{ pageTitle }}
          </h1>
        </div>

        <router-view />
      </div>
    </div>
  </div>
</template>
<script setup>
import { computed, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useTranslations } from '@/composable/useTranslations';

const { translations } = useTranslations();
const route = useRoute();
const router = useRouter();
const searchQuery = ref('');

// On mobile '/settings' is shared between the category menu and the "General"
// section; this flag tracks explicit entry into General since the URL doesn't change.
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
    'Settings-Account': {
      name: t.settings.account || 'Account',
      icon: 'riUserLine',
      path: '/settings/account',
      keywords: [t.settings.account?.toLowerCase() || 'account'],
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
      ([key]) => key !== 'Settings-Shortcuts',
    ),
  ),
);

function matchesQuery(item) {
  if (!searchQuery.value.trim()) return true;
  const query = searchQuery.value.trim().toLowerCase();
  return (
    item.name.toLowerCase().includes(query) ||
    item.icon.toLowerCase().includes(query) ||
    item.path.toLowerCase().includes(query) ||
    (item.keywords &&
      item.keywords.some((k) => k.toLowerCase().includes(query)))
  );
}

const filteredSettings = computed(() =>
  Object.fromEntries(
    Object.entries(settings.value).filter(([, item]) => matchesQuery(item)),
  ),
);

const filteredMobileSettings = computed(() =>
  Object.fromEntries(
    Object.entries(mobileSettings.value).filter(([, item]) =>
      matchesQuery(item),
    ),
  ),
);

const showMobileMenu = computed(
  () => route.name === 'index' && !enteredGeneralOnMobile.value,
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

// Navigation away from the settings root means the next landing on '/settings'
// (e.g. via back) should show the category menu again, not stale "General" content.
watch(
  () => route.name,
  (name) => {
    if (name !== 'index') enteredGeneralOnMobile.value = false;
  },
);

</script>
