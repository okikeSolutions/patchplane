import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { build } from 'vite'
import { describe, expect, it } from 'vitest'
import { runtimeBoundaries } from './runtime-boundaries'

async function buildFixture(
  target: 'client' | 'ssr',
  dependency: string,
) {
  const repository = mkdtempSync(
    join(tmpdir(), 'patchplane-runtime-boundaries-'),
  )
  const root = join(repository, 'apps/client')
  mkdirSync(root, { recursive: true })
  const entry = join(root, 'entry.js')
  const isNodeBuiltin = dependency.startsWith('node:')
  if (dependency === 'oversized-chunk') {
    writeFileSync(entry, `console.log(${JSON.stringify('x'.repeat(500 * 1024))})`)
  } else if (isNodeBuiltin) {
    writeFileSync(
      entry,
      `import('${dependency}').then(value => console.log(value))`,
    )
  } else {
    const dependencyDirectory = join(root, 'node_modules', dependency)
    mkdirSync(dependencyDirectory, { recursive: true })
    writeFileSync(
      join(dependencyDirectory, 'package.json'),
      JSON.stringify({
        name: dependency,
        type: 'module',
        exports: './index.js',
      }),
    )
    writeFileSync(
      join(dependencyDirectory, 'index.js'),
      'export const value = globalThis.crypto.randomUUID()',
    )
    writeFileSync(
      entry,
      `import { value } from '${dependency}'; console.log(value)`,
    )
  }
  try {
    return await build({
      root,
      configFile: false,
      logLevel: 'silent',
      plugins: [runtimeBoundaries()],
      build: {
        write: false,
        ssr: target === 'ssr' ? entry : false,
        rolldownOptions: {
          input: entry,
          external: isNodeBuiltin ? [dependency] : [],
        },
      },
      ssr: { noExternal: true },
    })
  } finally {
    rmSync(repository, { recursive: true, force: true })
  }
}

describe('emitted runtime boundaries', () => {
  it('allows shared Sentry Core in both runtimes', async () => {
    await expect(buildFixture('client', '@sentry/core')).resolves.toBeDefined()
    await expect(buildFixture('ssr', '@sentry/core')).resolves.toBeDefined()
  })

  it('allows Browser Sentry in the browser and rejects it in the Worker', async () => {
    await expect(buildFixture('client', '@sentry/react')).resolves.toBeDefined()
    await expect(buildFixture('ssr', '@sentry/react')).rejects.toThrow()
  })

  it('allows Cloudflare Sentry in the Worker and rejects it in the browser', async () => {
    await expect(
      buildFixture('ssr', '@sentry/cloudflare'),
    ).resolves.toBeDefined()
    await expect(buildFixture('client', '@sentry/cloudflare')).rejects.toThrow()
  })
  it('rejects an external dynamic Node import in the browser while allowing it in the Worker', async () => {
    await expect(buildFixture('ssr', 'node:fs')).resolves.toBeDefined()
    await expect(buildFixture('client', 'node:fs')).rejects.toThrow()
  })

  it('fails a browser build when an emitted chunk crosses Vite’s warning threshold', async () => {
    await expect(buildFixture('client', 'oversized-chunk')).rejects.toThrow(
      /Client chunks exceed Vite's 500 kB warning threshold/,
    )
  })
})
