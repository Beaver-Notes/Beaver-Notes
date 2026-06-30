import { createApp } from 'vue';
import { createPinia } from 'pinia';
import App from './App.vue';
import router from './router';
import compsUi from './lib/comps-ui';
import { backend } from './lib/tauri-bridge';
import { getStoredZoomLevel, setStoredZoomLevel } from './composable/zoom';
import { getSettingSync } from './composable/settings';
import './assets/css/fonts.css';
import './assets/css/tailwind.css';
import './assets/css/style.css';

const isPhoneRuntime = backend.isPhoneRuntime();

function updateRuntimeClass() {
  const isLarge = window.innerWidth >= 768;
  const isPhone = isPhoneRuntime && !isLarge;
  const isTablet = backend.isIPadRuntime() || (isPhoneRuntime && isLarge);

  document.documentElement.classList.toggle('runtime-mobile', isPhone);
  document.documentElement.classList.toggle('runtime-tablet', isTablet);

  return isPhone;
}

// Run once at startup
let isPhoneDevice = updateRuntimeClass();

// React to viewport changes — only relevant on phone UA
if (isPhoneRuntime) {
  window.matchMedia('(min-width: 768px)').addEventListener('change', () => {
    isPhoneDevice = updateRuntimeClass();
  });
}

if (!navigator.platform.includes('Mac')) {
  document.documentElement.classList.add('custom-scrollbar');
}

if (!isPhoneDevice) {
  const savedZoom = getStoredZoomLevel();
  setStoredZoomLevel(savedZoom).catch(console.error);
}

if (getSettingSync('reducedMotion')) {
  document.documentElement.classList.add('prefers-reduced-motion');
}
if (getSettingSync('highContrast')) {
  document.documentElement.classList.add('high-contrast');
}

const app = createApp(App);

app.config.unwrapInjectedRef = true;

app.use(router).use(createPinia()).use(compsUi).mount('#app');
