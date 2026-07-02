/**
 * iOS keyboard avoidance policy - prevents UI shift when keyboard appears
 */
export function setIOSKeyboardAvoidance() {
  if (typeof window !== 'undefined') {
    const viewport = document.querySelector('meta[name="viewport"]');
    if (viewport) {
      viewport.setAttribute('content', 'width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no');
    }

    const textarea = document.querySelector('textarea');
    if (textarea) {
      textarea.style.height = 'auto';
      textarea.style.position = 'fixed';
      textarea.style.bottom = '0';
      textarea.style.left = '0';
      textarea.style.right = '0';
      textarea.style.width = '100%';
      textarea.style.zIndex = '9999';
      textarea.style.background = 'white';
      Object.assign(textarea.style, {
        transform: 'translateZ(0)',
        WebkitTransform: 'translateZ(0)',
        WebkitTouchCallout: 'none',
        WebkitUserSelect: 'none',
        userSelect: 'none',
        touchAction: 'manipulation',
      });
    }
  }
}