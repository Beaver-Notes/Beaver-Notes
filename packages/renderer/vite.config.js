/* eslint-env node */
import { chrome } from '../../electron-vendors.config.json';
import { join } from 'path';
import { builtinModules } from 'module';
import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import { loadAndSetEnv } from '../../scripts/loadAndSetEnv.mjs';
// import { visualizer } from 'rollup-plugin-visualizer';

const PACKAGE_ROOT = __dirname;

loadAndSetEnv(process.env.MODE, process.cwd());

export default defineConfig({
  root: PACKAGE_ROOT,
  resolve: {
    alias: {
      '@/': join(PACKAGE_ROOT, 'src') + '/',
      crypto: 'crypto-browserify',
    },
  },
  plugins: [
    vue(),
    //    visualizer({
    //      filename: join(PACKAGE_ROOT, 'stats.html'),
    //      template: 'treemap',
    //     gzipSize: true,
    //      brotliSize: true,
    //      open: true,
    //    }),
  ],
  optimizeDeps: {
    exclude: ['mermaid/dist/*'],
  },
  base: '',
  server: {
    fsServe: {
      root: join(PACKAGE_ROOT, '../../'),
    },
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
    target: `chrome${chrome}`,
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
      external: [...builtinModules],
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
