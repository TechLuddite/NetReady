import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const rootDir = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  // Relative base so the static build works from a GitHub Pages subpath.
  base: './',
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(rootDir, 'src'),
    },
  },
  server: {
    // HMR is disabled in AI Studio via the DISABLE_HMR env var; file watching is
    // disabled alongside it to prevent flickering during agent edits.
    hmr: process.env.DISABLE_HMR !== 'true',
    watch: process.env.DISABLE_HMR === 'true' ? null : {},
  },
  build: {
    rollupOptions: {
      output: {
        // Leaflet, Recharts and JSZip are each needed by a minority of tabs.
        // Splitting them keeps them out of the critical path.
        manualChunks: {
          'vendor-map': ['leaflet'],
          'vendor-charts': ['recharts'],
          'vendor-zip': ['jszip'],
        },
      },
    },
  },
});
