const closeFnList = [];

export function addCloseHandler(fn) {
  if (!closeFnList.includes(fn)) {
    closeFnList.push(fn);
  }
  // Unsubscribe: page-scoped handlers (one per note visit) must remove
  // themselves on unmount or every quit replays one stale persist per
  // note visited this session.
  return () => {
    const index = closeFnList.indexOf(fn);
    if (index !== -1) closeFnList.splice(index, 1);
  };
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
