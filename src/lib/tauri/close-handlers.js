const closeFnList = [];

export function addCloseHandler(fn) {
  if (!closeFnList.includes(fn)) {
    closeFnList.push(fn);
  }
}

export function bindCloseHandlers() {
  if (typeof window === 'undefined' || window.__beaverCloseFnsBound) return;

  window.__beaverCloseFnsBound = true;
  window.addEventListener('beforeunload', () => {
    closeFnList.forEach((fn) => {
      try {
        fn();
      } catch (error) {
        console.error(error);
      }
    });
  });
}
