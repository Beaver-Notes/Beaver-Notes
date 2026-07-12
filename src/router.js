import { createRouter, createWebHashHistory } from 'vue-router';
import Home from './pages/Index.vue';
import Note from './pages/note/_id.vue';
import Folder from './pages/folder/_id.vue';

const Settings = () => import('./pages/Settings.vue');
const Onboarding = () => import('./pages/Onboarding.vue');
const SettingsIndex = () => import('./pages/settings/Index.vue');
const SettingsAppearance = () => import('./pages/settings/Appearance.vue');
const SettingsShortcuts = () => import('./pages/settings/Shortcuts.vue');
const SettingsAbout = () => import('./pages/settings/About.vue');
const SettingsLabels = () => import('./pages/settings/Labels.vue');
const SettingsSecurity = () => import('./pages/settings/Security.vue');

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

export default createRouter({
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
