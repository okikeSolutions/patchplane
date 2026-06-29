import { join, resolve } from 'node:path'
import { defineConfig } from 'vitest/config'

const rootDir = import.meta.dirname
const backendConvexSetup = join(rootDir, 'packages/backend/convex/test-setup.ts')

export default defineConfig({
  resolve: {
    alias: {
      '@': resolve(rootDir, 'apps/client/src'),
      '@patchplane/backend/convex/_generated/api': resolve(rootDir, 'packages/backend/convex/_generated/api.js'),
      '@patchplane/backend/convex/_generated/server': resolve(rootDir, 'packages/backend/convex/_generated/server.js'),
    },
  },
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: 'backend-convex',
          environment: 'edge-runtime',
          include: ['packages/backend/convex/**/*.test.ts', 'convex/**/*.test.ts'],
          setupFiles: [backendConvexSetup],
        },
      },
      {
        extends: true,
        test: {
          name: 'default',
          include: ['**/*.test.ts', '**/*.test.tsx'],
          exclude: [
            '**/node_modules/**',
            '**/vendor/**',
            'packages/backend/convex/**/*.test.ts',
            'convex/**/*.test.ts',
          ],
        },
      },
    ],
  },
})
