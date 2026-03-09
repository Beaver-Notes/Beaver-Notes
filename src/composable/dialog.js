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

  return {
    alert,
    prompt,
    confirm,
    auth,
  };
}
