// direction.js
// Read direction preference from localStorage
const directionPreference = localStorage.getItem('directionPreference');

// Set the direction of the document element
if (directionPreference === 'rtl') {
  document.documentElement.setAttribute('dir', 'rtl');
} else {
  document.documentElement.setAttribute('dir', 'ltr');
}
