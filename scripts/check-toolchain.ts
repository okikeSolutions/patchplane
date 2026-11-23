import { BunRuntime, BunServices } from '@effect/platform-bun'
import { Effect, Path } from 'effect'
import { ChildProcess, ChildProcessSpawner } from 'effect/process'

const EXPECTED_EFFECT_TSGO_VERSION = '0.73.2'
const EXPECTED_TSRS_VERSION = '7.1.0-beta.tsrs3'
const ROOT_URL = new URL('..', import.meta.url)

const program = Effect.gen(function* () {
  const path = yield* Path.Path
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
  const root = path.resolve(yield* path.fromFileUrl(ROOT_URL))
  const effectTsgoBin = path.resolve(root, 'node_modules/.bin/effect-tsgo')

  const output = (yield* spawner.string(
    ChildProcess.make(
      effectTsgoBin,
      [`tsrs@${EXPECTED_TSRS_VERSION}`, '--version'],
      { cwd: root },
    ),
  )).trim()

  const expectedToken = `effect-tsgo.${EXPECTED_EFFECT_TSGO_VERSION}`
  const expectedTsrs = `tsrs ${EXPECTED_TSRS_VERSION}`

  if (!output.includes(expectedToken) || !output.includes(expectedTsrs)) {
    return yield* Effect.fail(
      `Toolchain mismatch: expected "${expectedToken}" and "${expectedTsrs}", got "${output}"`,
    )
  }

  return yield* Effect.sync(() => {
    process.stdout.write(`Verified toolchain: ${output}\n`)
  })
}).pipe(
  // oxlint-disable-next-line effecttsgo/strict-effect-provide -- CLI script entry point
  Effect.provide(BunServices.layer),
)

BunRuntime.runMain(program)
