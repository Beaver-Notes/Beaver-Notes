import { createApp } from 'vue';
import { createPinia } from 'pinia';
import App from './App.vue';
import router from './router';
import compsUi from './lib/comps-ui';
import { backend } from './lib/tauri-bridge';
import { getStoredZoomLevel, setStoredZoomLevel } from '@/utils/ui/zoom';
import { isMacOSRuntime } from '@/lib/tauri/runtime';
import { getSettingSync } from '@/lib/settings';
import { initializeThemeHandling } from './utils/themeHandler';
import './assets/css/fonts.css';
import './assets/css/tailwind.css';
import './assets/css/style.css';

performance.mark('app:init');

initializeThemeHandling();

// ponytail: iOS WKWebView shows black if JS throws before mount — log and keep bg white
window.addEventListener('error', (e) => console.error('[app] global error:', e.message, e.error));
window.addEventListener('unhandledrejection', (e) => console.error('[app] unhandled rejection:', e.reason));

const isPhoneRuntime = backend.isPhoneRuntime();

function updateRuntimeClass() {
  const isLarge = window.innerWidth >= 768;
  const isIPad = backend.isIPadRuntime();
  const isFoldable = backend.isFoldablePhoneRuntime?.() ?? false;
  // ponytail: candybar phones stay mobile even when rotated; only foldables can promote to tablet
  const isTablet = isIPad || (isFoldable && isLarge);
  const isPhone = isPhoneRuntime && !isTablet;

  document.documentElement.classList.toggle('runtime-mobile', isPhone);
  document.documentElement.classList.toggle('runtime-tablet', isTablet);

  // best-effort OS lock for candybar phones (native Android already portrait; this covers web/browser)
  if (isPhone && !isFoldable && !isIPad) {
    try { window.screen?.orientation?.lock?.('portrait')?.catch?.(() => {}); } catch {}
  } else if (isFoldable || isIPad) {
    try { window.screen?.orientation?.unlock?.(); } catch {}
  }

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

if (!isMacOSRuntime()) {
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

const selectedLanguage = getSettingSync('selectedLanguage') || 'en';
document.documentElement.setAttribute('lang', selectedLanguage);

const app = createApp(App);

app.config.unwrapInjectedRef = true;
app.config.errorHandler = (err, instance, info) => {
  console.error('[app] Vue error:', err, info);
};

try {
  app.use(router).use(createPinia()).use(compsUi).mount('#app');
} catch (err) {
  console.error('[app] mount failed:', err);
  document.getElementById('app').innerHTML =
    '<div style="display:flex;align-items:center;justify-content:center;min-height:100dvh;padding:24px;text-align:center;font-family:system-ui;color:#171717;background:#fafafa"><div><p style="font-weight:600;margin-bottom:8px">Beaver Notes failed to start</p><p style="font-size:14px;color:#737373">' + String(err?.message || err) + '</p><button onclick="location.reload()" style="margin-top:16px;padding:8px 16px;border-radius:8px;background:#171717;color:#fff;border:0">Reload</button></div></div>';
}

performance.mark('app:mounted');
