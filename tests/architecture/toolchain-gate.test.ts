import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'
import { describe, expect, it } from '@effect/vitest'
import { REPO_ROOT } from './architecture-files'

const EFFECT_TSGO_BIN = resolve(REPO_ROOT, 'node_modules/.bin/effect-tsgo')

describe('V2 published tsrs3 toolchain and lint gates', () => {
  it('runs exact published @effect/tsgo 0.73.2 with tsrs 7.1.0-beta.tsrs3 and no fallback', () => {
    const result = spawnSync(
      EFFECT_TSGO_BIN,
      ['tsrs@7.1.0-beta.tsrs3', '--version'],
      { cwd: REPO_ROOT, encoding: 'utf8' },
    )
    expect(result.status).toBe(0)
    expect(result.stdout).toContain('effect-tsgo.0.73.2')
    expect(result.stdout).toContain('tsrs 7.1.0-beta.tsrs3')
  })

  it('rejects a discarded Effect with an Effect compiler diagnostic under tsrs3', () => {
    const result = spawnSync(
      EFFECT_TSGO_BIN,
      [
        'tsrs@7.1.0-beta.tsrs3',
        '--noEmit',
        '-p',
        'tests/fixtures/tsconfig.json',
      ],
      { cwd: REPO_ROOT, encoding: 'utf8' },
    )
    const combined = `${result.stdout}\n${result.stderr}`
    expect(result.status).not.toBe(0)
    expect(combined).toContain('TS377001')
  })

  it('rejects floating promises, floating effects, and unregistered Promise boundaries via type-aware Oxlint', () => {
    const result = spawnSync(
      EFFECT_TSGO_BIN,
      [
        '--tsrs-lint=7.1.0-beta.tsrs3',
        'oxlint',
        '--type-aware',
        '--tsconfig',
        'tests/fixtures/tsconfig.json',
        '-c',
        'tests/fixtures/oxlint-fixture-config.json',
        'tests/fixtures/negative-lint.ts',
      ],
      { cwd: REPO_ROOT, encoding: 'utf8' },
    )
    const combined = `${result.stdout}\n${result.stderr}`
    expect(result.status).not.toBe(0)
    expect(combined).toContain('no-floating-promises')
    expect(combined).toContain('effecttsgo(floating-effect)')
    expect(combined).toContain('patchplane(no-unregistered-promise-boundary)')
  })
})
