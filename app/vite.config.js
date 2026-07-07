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
})
