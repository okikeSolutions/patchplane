import { BunServices } from '@effect/platform-bun'
import { describe, expect, it } from '@effect/vitest'
import { Effect, Path, Stream } from 'effect'
import { ChildProcess, ChildProcessSpawner } from 'effect/process'
import { getRepoRoot } from './architecture-files'

const runEffectTsgo = (args: ReadonlyArray<string>) =>
  Effect.gen(function* () {
    const path = yield* Path.Path
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
    const root = yield* getRepoRoot
    const bin = path.resolve(root, 'node_modules/.bin/effect-tsgo')
    const command = ChildProcess.make(bin, args, { cwd: root })

    return yield* Effect.scoped(
      Effect.gen(function* () {
        const handle = yield* spawner.spawn(command)
        const [outputChunks, exitCode] = yield* Effect.all(
          [
            handle.all.pipe(Stream.decodeText(), Stream.runCollect),
            handle.exitCode,
          ],
          { concurrency: 'unbounded' },
        )
        return {
          status: Number(exitCode),
          output: outputChunks.join(''),
        }
      }),
    )
  })

describe('V2 published tsrs3 toolchain and lint gates', () => {
  it.live(
    'rejects a discarded Effect with an Effect compiler diagnostic under tsrs3',
    () =>
      Effect.gen(function* () {
        const result = yield* runEffectTsgo([
          'tsrs@7.1.0-beta.tsrs3',
          '--noEmit',
          '-p',
          'tests/fixtures/tsconfig.json',
        ])
        expect(result.status).not.toBe(0)
        expect(result.output).toContain('TS377001')
      }).pipe(Effect.provide(BunServices.layer)),
  )

  it.live(
    'rejects floating promises, floating effects, and unregistered Promise boundaries via type-aware Oxlint',
    () =>
      Effect.gen(function* () {
        const result = yield* runEffectTsgo([
          '--tsrs-lint=7.1.0-beta.tsrs3',
          'oxlint',
          '--type-aware',
          '--tsconfig',
          'tests/fixtures/tsconfig.json',
          '-c',
          'tests/fixtures/oxlint-fixture-config.json',
          'tests/fixtures/negative-lint.ts',
        ])
        expect(result.status).not.toBe(0)
        expect(result.output).toContain('no-floating-promises')
        expect(result.output).toContain('effecttsgo(floating-effect)')
        expect(result.output).toContain(
          'patchplane(no-unregistered-promise-boundary)',
        )
      }).pipe(Effect.provide(BunServices.layer)),
  )
})
