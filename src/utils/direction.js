import { getSettingSync } from '@/lib/settings';

const directionPreference = getSettingSync('directionPreference');
const selectedLanguage = getSettingSync('selectedLanguage');

if (directionPreference === 'rtl') {
  document.documentElement.setAttribute('dir', 'rtl');
} else {
  document.documentElement.setAttribute('dir', 'ltr');
}
if (selectedLanguage) {
  document.documentElement.setAttribute('lang', String(selectedLanguage));
}
