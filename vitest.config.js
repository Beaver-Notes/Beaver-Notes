/* eslint-env node */
import { mergeConfig, defineConfig } from 'vitest/config';
import viteConfig from './vite.config.js';

export default mergeConfig(
  viteConfig,
  defineConfig({
    test: {
      environment: 'happy-dom',
      globals: true,
      setupFiles: ['src/test-setup.js'],
      include: ['src/**/*.spec.js'],
      fileParallelism: false,
    },
  })
);
