import { loadEnv } from 'vite';

/**
 * Load variables from `.env.[mode]` files in cwd
 * and set it to `process.env`
 *
 * @param {string} mode
 * @param {string} cwd
 *
 * @return {void}
 */
export function loadAndSetEnv(mode, cwd) {
  const env = loadEnv(mode || 'production', cwd);
  for (const envKey in env) {
    // eslint-disable-next-line no-prototype-builtins
    if (process.env[envKey] === undefined && env.hasOwnProperty(envKey)) {
      process.env[envKey] = env[envKey];
    }
  }
}
