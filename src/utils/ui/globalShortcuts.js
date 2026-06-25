function normalizeKey(key) {
  if (!key) return '';

  switch (key.toLowerCase()) {
    case 'arrowleft':
      return 'left';
    case 'arrowright':
      return 'right';
    case 'arrowup':
      return 'up';
    case 'arrowdown':
      return 'down';
    case 'escape':
      return 'esc';
    case ' ':
    case 'spacebar':
      return 'space';
    case 'control':
      return 'ctrl';
    default:
      return key.toLowerCase();
  }
}

export function getShortcutCombo(event) {
  if (!event || event.isComposing) return '';

  const key = normalizeKey(event.key);
  if (!key || ['meta', 'ctrl', 'alt', 'shift'].includes(key)) {
    return '';
  }

  const parts = [];

  if (event.metaKey || event.ctrlKey) parts.push('mod');
  if (event.altKey) parts.push('alt');
  if (event.shiftKey) parts.push('shift');
  parts.push(key);

  return parts.join('+');
}

export function bindGlobalShortcuts(shortcuts, options = {}) {
  const target = options.target || window;
  const capture = options.capture ?? true;

  if (!target?.addEventListener) {
    return () => {};
  }

  const handler = (event) => {
    if (event.defaultPrevented || event.isComposing || event.repeat) return;

    const combo = getShortcutCombo(event);
    if (!combo) return;

    const shortcutHandler = shortcuts[combo];
    if (!shortcutHandler) return;

    const handled = shortcutHandler(event, combo);
    if (handled === false) return;

    event.preventDefault();
  };

  target.addEventListener('keydown', handler, capture);

  return () => {
    target.removeEventListener('keydown', handler, capture);
  };
}
