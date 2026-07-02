/**
 * Utility function to close menus when clicked outside
 */
export function onClickOutside(element, callback) {
  if (typeof document !== 'undefined') {
    const handleClick = (e) => {
      if (element.value && !element.value.contains(e.target)) {
        callback();
      }
    };

    document.addEventListener('click', handleClick, true);
    return () => {
      document.removeEventListener('click', handleClick, true);
    };
  }
  return () => {};
}