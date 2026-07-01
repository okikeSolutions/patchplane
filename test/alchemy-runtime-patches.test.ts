import { describe, expect, test } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const repoRoot = process.cwd()

const readText = (path: string) => readFileSync(join(repoRoot, path), 'utf8')

describe('Alchemy runtime patch coverage', () => {
  test('does not use an external client dev server override', () => {
    const alchemyRun = readText('alchemy.run.ts')

    expect(alchemyRun).not.toContain("mode: 'external'")
    expect(alchemyRun).not.toContain('mode: "external"')
    expect(alchemyRun).not.toContain('http://localhost:3000')
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
