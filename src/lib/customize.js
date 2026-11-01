/**
 * Shared customize palette + quick-icon sets for the folder and workspace
 * customize dialogs. One palette everywhere so both dialogs render the same
 * 7-color row (see CustomizeEditor.vue).
 *
 * Name-based emoji suggestions under the color row run a live search of the
 * folder/workspace name against the same emoji.json dataset the picker uses
 * (see @/lib/emojis); the picker's search box stays user-driven.
 */

export const CUSTOMIZE_PALETTE = Object.freeze([
  { label: 'Red', hex: '#ef4444' },
  { label: 'Amber', hex: '#fbbf24' },
  { label: 'Green', hex: '#10b981' },
  { label: 'Blue', hex: '#3b82f6' },
  { label: 'Purple', hex: '#8b5cf6' },
  { label: 'Pink', hex: '#ec4899' },
  { label: 'Neutral', hex: '#a3a3a3' },
]);

export const CUSTOMIZE_DEFAULT_COLOR = CUSTOMIZE_PALETTE[0].hex;

export const FOLDER_QUICK_ICONS = Object.freeze([
  '📁',
  '📂',
  '📋',
  '📝',
  '📦',
  '💼',
  '🎯',
  '⭐',
]);

export const WORKSPACE_QUICK_ICONS = Object.freeze([
  '💼',
  '🏝️',
  '🚀',
  '🎨',
  '📚',
  '🧩',
  '🔥',
  '🌍',
]);

export const WORKSPACE_DEFAULT_EMOJI = '📁';

function hexToRgb(hex) {
  const normalized = hex.replace('#', '').trim();
  const fullHex =
    normalized.length === 3
      ? normalized
          .split('')
          .map((char) => char + char)
          .join('')
      : normalized;
  if (!/^[0-9a-fA-F]{6}$/.test(fullHex)) return null;
  return {
    r: parseInt(fullHex.slice(0, 2), 16),
    g: parseInt(fullHex.slice(2, 4), 16),
    b: parseInt(fullHex.slice(4, 6), 16),
  };
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

/** Lighten a hex color toward white (folder-card gradient top stop). */
export function lightenHex(hex, amount = 0.18) {
  const rgb = hexToRgb(hex);
  if (!rgb) return '#818cf8';
  const toHex = (value) =>
    clamp(Math.round(value + (255 - value) * amount), 0, 255)
      .toString(16)
      .padStart(2, '0');
  return `#${toHex(rgb.r)}${toHex(rgb.g)}${toHex(rgb.b)}`;
}
