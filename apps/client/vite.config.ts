import { paraglideVitePlugin } from '@inlang/paraglide-js'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import { devtools } from '@tanstack/devtools-vite'
import { tanstackStart } from '@tanstack/react-start/plugin/vite'
import viteReact from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { translatedPathnames } from './src/lib/translated-pathnames.ts'

const configDir = dirname(fileURLToPath(import.meta.url))
const cloudflareWorkersTestStub = resolve(
  configDir,
  'src/test/cloudflare-workers.ts',
)

const config = defineConfig({
  server: {
    allowedHosts: ['.ngrok-free.app'],
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
      urlPatterns: translatedPathnames,
    }),
    tanstackStart(),
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
