import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@shared': fileURLToPath(new URL('../template', import.meta.url)),
      '@admin': fileURLToPath(new URL('../admin', import.meta.url)),
      '@org': fileURLToPath(new URL('../org', import.meta.url)),
      '@mobile': fileURLToPath(new URL('../mobile', import.meta.url)),
    },
  },
  optimizeDeps: {
    // maplibre-gl loads its vector-tile decoding logic in a web worker
    // (a separate bundle, maplibre-gl-worker.mjs) — Vite's default dev-time
    // dependency pre-bundling mishandles that worker file (a known
    // Vite+maplibre-gl integration issue), so the worker 404s at runtime
    // and tiles silently never render past the base style/sprite. Excluding
    // it from pre-bundling lets Vite serve the package's own files as-is
    // instead.
    exclude: ['maplibre-gl'],
  },
})
