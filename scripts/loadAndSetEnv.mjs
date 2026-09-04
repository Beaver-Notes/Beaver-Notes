import { loadEnv } from 'vite';

/** Load .env.[mode] files in cwd into process.env. */
export function loadAndSetEnv(mode, cwd) {
  const env = loadEnv(mode || 'production', cwd);
  for (const envKey in env) {
    // eslint-disable-next-line no-prototype-builtins
    if (process.env[envKey] === undefined && env.hasOwnProperty(envKey)) {
      process.env[envKey] = env[envKey];
    }
  }
}
