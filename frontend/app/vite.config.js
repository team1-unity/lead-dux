import { fileURLToPath, URL } from 'node:url'
import { createRequire } from 'node:module'
import { dirname } from 'node:path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { viteStaticCopy } from 'vite-plugin-static-copy'

// Resolved via Node's own module resolution rather than a hardcoded
// "node_modules/maplibre-gl/..." relative path — this workspace hoists
// maplibre-gl up to the repo root's node_modules, not this package's own,
// so a path relative to frontend/app never resolves.
const maplibreGlDir = dirname(createRequire(import.meta.url).resolve('maplibre-gl/package.json'))

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    // maplibre-gl loads its vector-tile decoding logic from a separate
    // worker file (maplibre-gl-worker.mjs) via a dynamic `new URL(...)`
    // construction it can't statically analyze — the optimizeDeps.exclude
    // below fixes that for `vite dev` (which can serve node_modules files
    // on demand), but a production `vite build` never sees a static import
    // to bundle, so the worker file is silently missing from dist/assets
    // entirely. maplibre-gl itself resolves the worker relative to its own
    // bundled JS chunk's URL at runtime (.../assets/maplibre-gl-worker.mjs),
    // so it has to land at that exact unhashed path for the reference to
    // resolve — copying it here instead of committing a manual copy under
    // public/ keeps it in lockstep with whatever maplibre-gl version is
    // actually installed.
    //
    // maplibre-gl-shared.mjs is a second, separate pre-built chunk the
    // worker file itself dynamically imports (code shared between the main
    // thread and worker bundles, so it isn't duplicated in both) — same
    // "Vite never sees a static import" problem, same fix. Missing this one
    // is what actually caused the blank map in production: the main-thread
    // map instance itself created fine, but this failed import happens
    // outside maplibre-gl's own error handling, so neither the map's
    // 'load' nor 'error' event ever fired — just silent, permanent nothing.
    viteStaticCopy({
      targets: [
        {
          src: `${maplibreGlDir}/dist/maplibre-gl-worker.mjs`,
          dest: 'assets',
          rename: { stripBase: true },
        },
        {
          src: `${maplibreGlDir}/dist/maplibre-gl-shared.mjs`,
          dest: 'assets',
          rename: { stripBase: true },
        },
      ],
    }),
  ],
  resolve: {
    alias: {
      '@shared': fileURLToPath(new URL('../template', import.meta.url)),
      '@admin': fileURLToPath(new URL('../admin', import.meta.url)),
      '@org': fileURLToPath(new URL('../org', import.meta.url)),
      '@mobile': fileURLToPath(new URL('../mobile', import.meta.url)),
    },
  },
  optimizeDeps: {
    // See the viteStaticCopy plugin above for the production-build half of
    // this same underlying issue. Excluding it from dev-time pre-bundling
    // lets Vite serve the package's own files as-is instead, so the
    // worker resolves correctly during `vite dev` too.
    exclude: ['maplibre-gl'],
  },
})
