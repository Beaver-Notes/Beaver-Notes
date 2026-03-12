import { getSettingSync } from '@/composable/settings';

const directionPreference = getSettingSync('directionPreference');

// Set the direction of the document element
if (directionPreference === 'rtl') {
  document.documentElement.setAttribute('dir', 'rtl');
} else {
  document.documentElement.setAttribute('dir', 'ltr');
}
