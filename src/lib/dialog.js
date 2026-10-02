import emitter from 'tiny-emitter/instance';

export function useDialog() {
  function alert(options) {
    emitter.emit('show-dialog', 'alert', options);
  }

  function confirm(options) {
    emitter.emit('show-dialog', 'confirm', options);
  }

  function prompt(options) {
    emitter.emit('show-dialog', 'prompt', options);
  }

  function auth(options) {
    emitter.emit('show-dialog', 'auth', options);
  }

  // Checkbox list; `onConfirm` receives the array of selected `choices` values.
  function select(options) {
    emitter.emit('show-dialog', 'select', options);
  }

  return {
    alert,
    prompt,
    confirm,
    auth,
    select,
  };
}
