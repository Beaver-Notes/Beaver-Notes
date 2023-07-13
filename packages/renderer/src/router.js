import { createRouter, createWebHashHistory } from 'vue-router';
import Home from './pages/Index.vue';
import Note from './pages/note/_id.vue';
import Settings from './pages/Settings.vue';
import SettingsIndex from './pages/settings/Index.vue';
import SettingsShortcuts from './pages/settings/Shortcuts.vue';
import SettingsAbout from './pages/settings/About.vue';

const routes = [
  {
    path: '/',
    name: 'Home',
    component: Home,
  },
  {
    path: '/note/:id',
    name: 'Note',
    component: Note,
  },
  {
    path: '/settings',
    name: 'Settings',
    component: Settings,
    children: [
      {
        path: '',
        component: SettingsIndex,
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
    ],
  },
];

export default createRouter({
  routes,
  history: createWebHashHistory(),
});
