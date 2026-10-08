import { paraglideVitePlugin } from '@inlang/paraglide-js'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import { runtimeBoundaries } from './build/runtime-boundaries'
import { devtools } from '@tanstack/devtools-vite'
import { tanstackStart } from '@tanstack/react-start/plugin/vite'
import viteReact from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { prerenderRoutes } from './src/lib/prerender.ts'
import { translatedPathnames } from './src/lib/translated-pathnames.ts'

const configDir = dirname(fileURLToPath(import.meta.url))
const isLandingBuild = process.env.VITE_PATCHPLANE_SURFACE === 'landing'
const cloudflareWorkersTestStub = resolve(
  configDir,
  'src/test/cloudflare-workers.ts',
)
const resolveAliases = [
  {
    find: /^shiki$/,
    replacement: resolve(configDir, 'src/lib/diff-shiki.ts'),
  },
  {
    find: /^shiki\/wasm$/,
    replacement: resolve(configDir, 'src/lib/diff-shiki-wasm.ts'),
  },
  ...(process.env.VITEST === undefined
    ? []
    : [{ find: 'cloudflare:workers', replacement: cloudflareWorkersTestStub }]),
]

const config = defineConfig({
  build: {
    // Vite leaves SSR unminified by default. Workers deploy this output directly.
    minify: true,
    // Browser assets are emitted by the client build; duplicating them in the
    // Worker SSR output wastes bundle budget without serving those copies.
    ssrEmitAssets: false,
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [
            {
              name: 'react-vendor',
              test: /node_modules[\\/](react|react-dom|scheduler)[\\/]/,
              priority: 20,
            },
            {
              name: 'effect-vendor',
              test: /node_modules[\\/](effect|@effect)[\\/]/,
              priority: 20,
            },
            {
              name: 'vendor',
              test: /node_modules[\\/]/,
              minSize: 20_000,
              maxSize: 400_000,
              priority: 10,
            },
          ],
        },
      },
    },
  },
  server: {
    allowedHosts: ['.ngrok-free.app', 'cmux-loopback.localtest.me'],
  },
  plugins: [
    devtools(),
    tailwindcss(),
    paraglideVitePlugin({
      project: resolve(configDir, 'project.inlang'),
      outdir: resolve(configDir, 'src/paraglide'),
      outputStructure: 'message-modules',
      cookieName: 'PARAGLIDE_LOCALE',
      strategy: ['url', 'cookie', 'preferredLanguage', 'baseLocale'],
      urlPatterns: isLandingBuild
        ? translatedPathnames.filter(({ pattern }) => pattern === '')
        : translatedPathnames,
    }),
    tanstackStart({
      importProtection: {
        // Vitest hosts browser tests in its SSR runner; production rules apply to builds/dev.
        enabled: process.env.VITEST === undefined,
        behavior: 'error',
        client: {
          files: [
            '**/*.server.*',
            '**/effect/runtime.ts',
            '**/effect/app-layer.ts',
          ],
          specifiers: [
            '@sentry/cloudflare',
            '@sentry/node',
            '@sentry/effect/server',
          ],
        },
        server: { specifiers: ['@sentry/react', '@sentry/browser'] },
      },
      ...(isLandingBuild
        ? {
            router: {
              entry: 'landing/router',
              routesDirectory: 'landing/routes',
              generatedRouteTree: 'landing/routeTree.gen.ts',
            },
            start: { entry: 'landing/start' },
            prerender: {
              enabled: true,
              autoStaticPathsDiscovery: false,
              crawlLinks: false,
              failOnError: true,
            },
            pages: prerenderRoutes,
            sitemap: { enabled: false },
          }
        : {}),
    }),
    runtimeBoundaries(),
    viteReact(),
  ],
  resolve: {
    alias: resolveAliases,
    tsconfigPaths: true,
  },
})

export default config
