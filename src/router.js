import { createRouter, createWebHashHistory } from 'vue-router';

const Settings = () => import('./pages/Settings.vue');
const Onboarding = () => import('./pages/Onboarding.vue');
const SettingsIndex = () => import('./pages/settings/Index.vue');
const SettingsAppearance = () => import('./pages/settings/Appearance.vue');
const SettingsShortcuts = () => import('./pages/settings/Shortcuts.vue');
const SettingsAbout = () => import('./pages/settings/About.vue');
const SettingsLabels = () => import('./pages/settings/Labels.vue');
const SettingsSecurity = () => import('./pages/settings/Security.vue');

const APP_NAME = 'Beaver Notes';

const routeTitles = {
  Home: APP_NAME,
  Note: 'Note',
  Folder: 'Folder',
  Settings: `Settings — ${APP_NAME}`,
  'Settings-Appearance': `Appearance — ${APP_NAME}`,
  'Settings-Shortcuts': `Shortcuts — ${APP_NAME}`,
  'Settings-About': `About — ${APP_NAME}`,
  'Settings-Labels': `Labels — ${APP_NAME}`,
  'Settings-Security': `Security — ${APP_NAME}`,
  Onboarding: `Welcome — ${APP_NAME}`,
};

const routes = [
  {
    path: '/',
    name: 'Home',
    component: () => import('./pages/Index.vue'),
  },
  {
    path: '/onboarding',
    name: 'Onboarding',
    component: Onboarding,
  },
  {
    path: '/note/:id',
    name: 'Note',
    component: () => import('./pages/note/_id.vue'),
  },
  {
    path: '/folder/:id',
    name: 'Folder',
    component: () => import('./pages/folder/_id.vue'),
  },
  {
    path: '/settings',
    name: 'Settings',
    component: Settings,
    children: [
      {
        name: 'index',
        path: '',
        component: SettingsIndex,
      },
      {
        path: 'appearance',
        name: 'Settings-Appearance',
        component: SettingsAppearance,
      },
      {
        path: 'shortcuts',
        name: 'Settings-Shortcuts',
        component: SettingsShortcuts,
      },
      {
        path: 'about',
        name: 'Settings-About',
        component: SettingsAbout,
      },
      {
        path: 'labels',
        name: 'Settings-Labels',
        component: SettingsLabels,
      },
      {
        path: 'security',
        name: 'Settings-Security',
        component: SettingsSecurity,
      },
    ],
  },
  {
    // Catch-all route for footnote links
    path: '/fn:*',
    name: 'Footnote',
    beforeEnter: (to, from, next) => {
      next(false);
    },
  },
  {
    // Catch-all route for any unmatched paths
    path: '/:pathMatch(.*)*',
    name: 'NotFound',
    beforeEnter: (to, from, next) => {
      next(false); // Prevents Vue Router from processing the route
    },
  },
];

const router = createRouter({
  routes,
  history: createWebHashHistory(),
  scrollBehavior(to, from, savedPosition) {
    if (savedPosition) return savedPosition;

    if (to.path !== from.path || to.fullPath !== from.fullPath) {
      return { top: 0, left: 0 };
    }

    return undefined;
  },
});

router.afterEach((to) => {
  const title = routeTitles[to.name] || APP_NAME;
  document.title = title;

  // Focus main content area after navigation for screen readers
  requestAnimationFrame(() => {
    const main = document.getElementById('app-main');
    if (main && !main.contains(document.activeElement)) {
      main.focus({ preventScroll: true });
    }
  });
});

export default router;
