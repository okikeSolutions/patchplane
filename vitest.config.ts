import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: [
      'packages/*/src/**/*.test.ts',
      'apps/*/src/**/*.test.ts',
      'apps/*/src/**/*.test.tsx',
      'tests/**/*.test.ts',
    ],
    exclude: ['**/node_modules/**', '**/dist/**', 'tests/fixtures/**'],
  },
})
