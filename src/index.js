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

const isMobileRuntime = backend.isMobileRuntime();
document.documentElement.classList.toggle('runtime-mobile', isMobileRuntime);
document.documentElement.dataset.runtime = isMobileRuntime
  ? 'mobile'
  : 'desktop';

if (!isMobileRuntime) {
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
