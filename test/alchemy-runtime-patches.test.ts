import { describe, expect, test } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const repoRoot = process.cwd()

const readText = (path: string) => readFileSync(join(repoRoot, path), 'utf8')

describe('Alchemy runtime patch coverage', () => {
  test('uses Alchemy Vite defaults for TanStack Start asset routing', () => {
    const alchemyRun = readText('alchemy.run.ts')

    expect(alchemyRun).not.toContain("mode: 'external'")
    expect(alchemyRun).not.toContain('mode: "external"')
    expect(alchemyRun).not.toContain('http://localhost:3000')
    expect(alchemyRun).not.toContain('runWorkerFirst')
  })

  test('fails closed and retries incomplete Alchemy asset upload sessions', () => {
    const pkg = JSON.parse(readText('package.json')) as {
      patchedDependencies?: Record<string, string>
    }
    const patchPath = 'patches/alchemy@2.0.0-beta.63.patch'
    const patch = readText(patchPath)

    expect(pkg.patchedDependencies?.['alchemy@2.0.0-beta.63']).toBe(patchPath)
    expect(patch).toContain('AssetUploadSessionError')
    expect(patch).toContain('returned no completion token')
    expect(patch).toContain('Schedule.exponential("1 second")')
  })

  test('keeps the local Cloudflare runtime patch registered', () => {
    const pkg = JSON.parse(readText('package.json')) as {
      patchedDependencies?: Record<string, string>
    }

    expect(pkg.patchedDependencies).toMatchObject({
      '@distilled.cloud/cloudflare-runtime@0.11.3':
        'patches/@distilled.cloud%2Fcloudflare-runtime@0.11.3.patch',
    })
  })

  test('routes the local dev socket directly to the user worker', () => {
    const patch = readText('patches/@distilled.cloud%2Fcloudflare-runtime@0.11.3.patch')

    expect(patch).toContain('service: { name: SERVICE_USER_WORKER }')
    expect(patch).toContain('service: { name: "user-worker" }')
    expect(patch).toContain('-                service: { name: config.entry ?? SERVICE_USER_WORKER },')
    expect(patch).toMatch(/-\s+service: \{ name: config\.entry \?\? "user-worker" \}/)
  })
})
