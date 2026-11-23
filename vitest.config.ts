import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'unit',
          isolate: false,
          sequence: { groupOrder: 0 },
          include: [
            'packages/*/src/**/*.test.ts',
            'apps/*/src/**/*.test.ts',
            'apps/*/src/**/*.test.tsx',
            'tests/architecture/**/*.test.ts',
            'tests/smoke/**/*.test.ts',
          ],
          exclude: ['**/node_modules/**', '**/dist/**', 'tests/fixtures/**'],
        },
      },
      {
        test: {
          name: 'integration',
          isolate: false,
          fileParallelism: false,
          sequence: { groupOrder: 1 },
          include: ['tests/integration/**/*.test.ts'],
          exclude: ['**/node_modules/**', '**/dist/**'],
        },
      },
    ],
  },
})
