import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // Only run TypeScript sources; ignore compiled output in lib/ (stale .test.js
    // artifacts otherwise fail under the CommonJS default).
    include: ['test/**/*.test.ts'],
    environment: 'node',
  },
})