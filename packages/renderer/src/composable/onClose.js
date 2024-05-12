export const onClose = (fn) => {
  window && window.electron.addCloseFn(fn);
};
