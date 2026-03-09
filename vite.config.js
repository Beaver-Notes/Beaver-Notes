/* eslint-env node */
import { join } from 'path';
import { fileURLToPath } from 'url';
import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import { loadAndSetEnv } from './scripts/loadAndSetEnv.mjs';

const PACKAGE_ROOT = fileURLToPath(new URL('.', import.meta.url));

loadAndSetEnv(process.env.MODE, process.cwd());

export default defineConfig({
  root: PACKAGE_ROOT,
  resolve: {
    alias: {
      '@/': join(PACKAGE_ROOT, 'src') + '/',
    },
  },
  plugins: [vue()],
  base: '',
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
  },
  css: {
    preprocessorOptions: {
      scss: {
        api: 'modern-compiler',
      },
    },
  },
  build: {
    sourcemap: false,
    minify: 'terser',
    target: ['es2021', 'chrome100', 'safari13'],
    outDir: 'dist',
    chunkSizeWarningLimit: 1600,
    assetsDir: '.',
    terserOptions: {
      ecma: 2020,
      compress: {
        passes: 2,
        drop_console: true,
        drop_debugger: true,
        pure_getters: true,
        module: true,
      },
      format: { comments: false },
      safari10: false,
    },
    rollupOptions: {
      output: {
        manualChunks: {
          editor: ['@tiptap/core', 'prosemirror-model', 'prosemirror-view'],
          mermaid: ['mermaid'],
          katex: ['katex'],
        },
      },
    },
    emptyOutDir: true,
  },
});
