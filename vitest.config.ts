import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'unit',
          isolate: false,
          sequence: { groupOrder: 0, shuffle: true },
          include: [
            'packages/*/src/**/*.test.ts',
            'apps/*/src/**/*.test.ts',
            'tests/architecture/**/*.test.ts',
            'tests/smoke/**/*.test.ts',
          ],
          exclude: ['**/node_modules/**', '**/dist/**', 'tests/fixtures/**'],
        },
      },
      {
        test: {
          name: 'web-dom',
          environment: 'happy-dom',
          isolate: false,
          sequence: { groupOrder: 0, shuffle: true },
          include: ['apps/web/src/**/*.test.tsx'],
          exclude: ['**/node_modules/**', '**/dist/**', 'tests/fixtures/**'],
        },
      },
      {
        test: {
          name: 'integration',
          isolate: false,
          fileParallelism: false,
          sequence: { groupOrder: 1, shuffle: true },
          include: ['tests/integration/**/*.test.ts'],
          exclude: ['**/node_modules/**', '**/dist/**'],
        },
      },
    ],
  },
})
