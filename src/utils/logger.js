const enabled = typeof console !== 'undefined';

export const logger = {
  // eslint-disable-next-line no-console
  debug: (...args) => { if (enabled) console.debug(...args); },
  // eslint-disable-next-line no-console
  info: (...args) => { if (enabled) console.info(...args); },
  warn: (...args) => { if (enabled) console.warn(...args); },
  error: (...args) => { if (enabled) console.error(...args); },
};
