import { getSettingSync } from '@/lib/settings';

const directionPreference = getSettingSync('directionPreference');

if (directionPreference === 'rtl') {
  document.documentElement.setAttribute('dir', 'rtl');
} else {
  document.documentElement.setAttribute('dir', 'ltr');
}
