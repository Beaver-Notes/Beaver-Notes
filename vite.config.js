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
    host: process.env.TAURI_DEV_HOST || '127.0.0.1',
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
  esbuild: {
    pure: ['console.log', 'console.debug', 'console.info'],
    drop: ['debugger'],
  },
  build: {
    sourcemap: false,
    target: ['es2021', 'chrome100', 'safari13'],
    outDir: 'dist',
    chunkSizeWarningLimit: 1600,
    assetsDir: '.',
    rollupOptions: {
      output: {
        // Object form was removed in Vite 8 (Rolldown requires a function)
        manualChunks(id) {
          if (!id.includes('node_modules')) return;
          if (/[\\/]node_modules[\\/](vue|vue-router|pinia)[\\/]/.test(id))
            return 'vue';
          if (/[\\/]node_modules[\\/](yjs|y-prosemirror|lib0)[\\/]/.test(id))
            return 'yjs';
          if (
            /[\\/]node_modules[\\/](@tiptap[\\/]core|prosemirror-model|prosemirror-view)[\\/]/.test(
              id,
            )
          )
            return 'editor';
          if (/[\\/]node_modules[\\/]beautiful-mermaid[\\/]/.test(id))
            return 'beautiful-mermaid';
          if (/[\\/]node_modules[\\/]katex[\\/]/.test(id)) return 'katex';
        },
      },
    },
    emptyOutDir: true,
  },
});
