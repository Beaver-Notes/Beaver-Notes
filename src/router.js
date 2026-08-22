import { createRouter, createWebHashHistory } from 'vue-router';
import { getSettingSync } from '@/lib/settings';
import Settings from './pages/Settings.vue';
import Onboarding from './pages/Onboarding.vue';
import SettingsIndex from './pages/settings/Index.vue';
import SettingsAppearance from './pages/settings/Appearance.vue';
import SettingsShortcuts from './pages/settings/Shortcuts.vue';
import SettingsAbout from './pages/settings/About.vue';
import SettingsLabels from './pages/settings/Labels.vue';
import SettingsSecurity from './pages/settings/Security.vue';
import SettingsAccount from './pages/settings/Account.vue';
import SettingsTeamAdmin from './pages/settings/TeamAdmin.vue';
import SettingsSSO from './pages/settings/SSO.vue';
import SettingsData from './pages/settings/Data.vue';
import JoinNote from './pages/join/[token].vue';
import Home from './pages/Index.vue';
import Note from './pages/note/_id.vue';
import Folder from './pages/folder/_id.vue';

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
  'Settings-Data': `Data — ${APP_NAME}`,
  'Settings-Team': `Team — ${APP_NAME}`,
  'Settings-SSO': `SSO — ${APP_NAME}`,
  Onboarding: `Welcome — ${APP_NAME}`,
};

const routes = [
  {
    path: '/',
    name: 'Home',
    component: Home,
  },
  {
    path: '/onboarding',
    name: 'Onboarding',
    component: Onboarding,
  },
  {
    path: '/note/:id',
    name: 'Note',
    component: Note,
  },
  {
    path: '/folder/:id',
    name: 'Folder',
    component: Folder,
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
        path: 'account',
        name: 'Settings-Account',
        component: SettingsAccount,
      },
      {
        path: 'workspace',
        name: 'Settings-Team',
        component: SettingsTeamAdmin,
      },
      {
        path: 'sso',
        name: 'Settings-SSO',
        component: SettingsSSO,
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
      {
        path: 'data',
        name: 'Settings-Data',
        component: SettingsData,
      },
    ],
  },
  {
    path: '/join/:token',
    name: 'JoinNote',
    component: JoinNote,
    meta: { guest: true },
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

router.beforeEach((to) => {
  // Synchronous check: if onboarding hasn't completed and we're not
  // already on the onboarding route, redirect there immediately.
  // This prevents the sidebar from rendering before onboarding is shown.
  const onboardingCompleted = getSettingSync('onboardingCompleted');
  if (!onboardingCompleted && to.name !== 'Onboarding') {
    return { name: 'Onboarding' };
  }
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
