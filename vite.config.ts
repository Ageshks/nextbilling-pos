import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
  },
  build: {
    outDir: 'dist',
    target: 'es2023',
  },
  test: {
    environment: 'node',
    // The Cloud Functions workspace has its own vitest setup (run via
    // `npm --prefix functions test`). Its compiled lib/ output is CommonJS and
    // cannot import vitest, so keep it out of the root test run.
    exclude: ['**/node_modules/**', 'functions/**', 'dist/**'],
  },
})