import { paraglideVitePlugin } from '@inlang/paraglide-js'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
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

const config = defineConfig({
  build: {
    rolldownOptions: {
      output: {
        manualChunks(id) {
          if (/\/node_modules\/(react|react-dom|scheduler)\//.test(id)) {
            return 'react-vendor'
          }

          return undefined
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
    tanstackStart(
      isLandingBuild
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
        : undefined,
    ),
    viteReact(),
  ],
  resolve: {
    alias:
      process.env.VITEST === undefined
        ? undefined
        : { 'cloudflare:workers': cloudflareWorkersTestStub },
    tsconfigPaths: true,
  },
})

export default config
