const PREVENT = (event) => event.preventDefault();

export default {
  mounted(el) {
    el.addEventListener('mousedown', PREVENT, true);
  },
  unmounted(el) {
    el.removeEventListener('mousedown', PREVENT, true);
  },
};
