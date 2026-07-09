import * as NodeChildProcessSpawner from '@effect/platform-node/NodeChildProcessSpawner'
import * as NodeFileSystem from '@effect/platform-node/NodeFileSystem'
import * as NodePath from '@effect/platform-node/NodePath'
import { assert, describe, it, layer } from '@effect/vitest'
import * as Effect from 'effect/Effect'
import * as FileSystem from 'effect/FileSystem'
import * as Layer from 'effect/Layer'
import * as Path from 'effect/Path'
import * as PlatformError from 'effect/PlatformError'
import * as Stream from 'effect/Stream'
import { ChildProcess, ChildProcessSpawner } from 'effect/unstable/process'
import { patchPlanePlugins } from '../../packages/plugins/src/registry'

const nodeServices = NodeChildProcessSpawner.layer.pipe(
  Layer.provideMerge(Layer.mergeAll(
    NodeFileSystem.layer,
    NodePath.layer,
  )),
)

let cliBuilt = false

interface CommandResult {
  readonly exitCode: number
  readonly stdout: string
  readonly stderr: string
}

const decodeByteStream = Effect.fnUntraced(function* (
  stream: Stream.Stream<Uint8Array, PlatformError.PlatformError>,
) {
  const chunks = yield* Stream.runCollect(stream)
  const totalLength = chunks.reduce((acc, chunk) => acc + chunk.length, 0)
  const bytes = new Uint8Array(totalLength)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.length
  }
  return new TextDecoder().decode(bytes)
})

const repoRoot = Effect.gen(function* () {
  const path = yield* Path.Path
  return path.resolve(import.meta.dirname, '../..')
})

const cliDistPath = Effect.gen(function* () {
  const path = yield* Path.Path
  return path.resolve(yield* repoRoot, 'packages/cli/dist/main.js')
})

function runCommand(
  command: string,
  args: readonly string[],
  options?: {
    readonly cwd?: string | undefined
    readonly env?: Record<string, string> | undefined
  },
): Effect.Effect<CommandResult, PlatformError.PlatformError, ChildProcessSpawner.ChildProcessSpawner> {
  return Effect.scoped(Effect.gen(function* () {
    const handle = yield* ChildProcess.make(command, [...args], {
      cwd: options?.cwd,
      env: options?.env,
      extendEnv: true,
    })
    const [stdout, stderr, exitCode] = yield* Effect.all([
      decodeByteStream(handle.stdout),
      decodeByteStream(handle.stderr),
      handle.exitCode,
    ], { concurrency: 'unbounded' })
    return {
      exitCode: exitCode as number,
      stdout,
      stderr,
    }
  }))
}

const ensureCliBuilt = Effect.gen(function* () {
  if (cliBuilt) return
  const root = yield* repoRoot
  const result = yield* runCommand('bun', ['run', '--cwd', 'packages/cli', 'build'], { cwd: root })
  assert.strictEqual(result.exitCode, ChildProcessSpawner.ExitCode(0), result.stderr || result.stdout)
  cliBuilt = true
})

function runPatchPlane(
  args: readonly string[],
  options?: {
    readonly cwd?: string | undefined
    readonly env?: Record<string, string> | undefined
  },
) {
  return Effect.gen(function* () {
    yield* ensureCliBuilt
    const cli = yield* cliDistPath
    return yield* runCommand(process.execPath, [cli, ...args], options)
  })
}

function withTempProject<A, E, R>(
  f: (dir: string) => Effect.Effect<A, E, R>,
): Effect.Effect<A, E | PlatformError.PlatformError, R | FileSystem.FileSystem> {
  return Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const dir = yield* fs.makeTempDirectory({ prefix: 'patchplane-cli-eval-' })
    try {
      return yield* f(dir)
    } finally {
      yield* fs.remove(dir, { recursive: true }).pipe(Effect.ignore)
    }
  })
}

const pathExists = Effect.fnUntraced(function* (filePath: string) {
  const fs = yield* FileSystem.FileSystem
  return yield* fs.exists(filePath)
})

const readText = Effect.fnUntraced(function* (filePath: string) {
  const fs = yield* FileSystem.FileSystem
  return yield* fs.readFileString(filePath)
})

describe('PatchPlane CLI friendliness eval', () => {
  layer(nodeServices)('black-box CLI contract', (it) => {
    it.effect('prints root help to stdout and exits zero', () =>
      Effect.gen(function* () {
        const result = yield* runPatchPlane(['--help'])

        assert.strictEqual(result.exitCode, ChildProcessSpawner.ExitCode(0))
        assert.match(result.stdout, /USAGE\n\s+patchplane <subcommand>/)
        assert.match(result.stdout, /SUBCOMMANDS/)
        assert.match(result.stdout, /init\s+Initialize project/)
        assert.strictEqual(result.stderr, '')
      }))

    it.effect('keeps dry-run init safe by writing no files', () =>
      withTempProject((dir) =>
        Effect.gen(function* () {
          const path = yield* Path.Path
          const result = yield* runPatchPlane(['init', '--profile', 'app', '--dry-run', '--yes'], { cwd: dir })

          assert.strictEqual(result.exitCode, ChildProcessSpawner.ExitCode(0), result.stderr)
          assert.match(result.stdout, /would write patchplane\.config\.json/)
          assert.isFalse(yield* pathExists(path.join(dir, 'patchplane.config.json')))
          assert.isFalse(yield* pathExists(path.join(dir, '.env.local')))
          assert.isFalse(yield* pathExists(path.join(dir, '.patchplane')))
        }),
      ))

    it.effect('preserves stdout\/stderr discipline for failing doctor runs', () =>
      withTempProject((dir) =>
        Effect.gen(function* () {
          const result = yield* runPatchPlane(['doctor', '--surface', 'app'], { cwd: dir })

          assert.isTrue(result.exitCode !== 0)
          assert.match(result.stdout, /missing patchplane\.config\.json/)
          assert.match(result.stdout, /missing CONVEX_URL/)
          assert.match(result.stderr, /Doctor found \d+ issue\(s\)\./)
        }),
      ))

    it.effect('keeps package schema plugin enum consistent with plugin registry', () =>
      Effect.gen(function* () {
        const path = yield* Path.Path
        const schemaPath = path.resolve(yield* repoRoot, 'packages/cli/schema/patchplane.schema.json')
        const schema = JSON.parse(yield* readText(schemaPath)) as {
          $defs?: { pluginId?: { enum?: string[] } }
        }
        const schemaPluginIds = [...(schema.$defs?.pluginId?.enum ?? [])].sort()
        const registryPluginIds = Object.values(patchPlanePlugins).map((plugin) => plugin.id).sort()

        assert.deepStrictEqual(schemaPluginIds, registryPluginIds)
      }))

    it.effect('supports global --cwd for repo-safe mutation from any caller cwd', () =>
      withTempProject((targetDir) =>
        withTempProject((callerDir) =>
          Effect.gen(function* () {
            const path = yield* Path.Path
            const result = yield* runPatchPlane(['--cwd', targetDir, 'init', '--profile', 'app', '--yes'], { cwd: callerDir })

            assert.strictEqual(result.exitCode, ChildProcessSpawner.ExitCode(0), result.stderr)
            assert.isTrue(yield* pathExists(path.join(targetDir, 'patchplane.config.json')))
            assert.isFalse(yield* pathExists(path.join(callerDir, 'patchplane.config.json')))
          }),
        ),
      ))

    it.effect('emits valid JSON-only doctor diagnostics in --json mode', () =>
      withTempProject((dir) =>
        Effect.gen(function* () {
          const result = yield* runPatchPlane(['doctor', '--surface', 'app', '--json'], { cwd: dir })
          const payload = JSON.parse(result.stdout) as {
            ok: boolean
            diagnostics: ReadonlyArray<{
              code: string
              severity: string
              message: string
              source: string
              requiredFor: readonly string[]
              fix: string
            }>
          }

          assert.isTrue(result.exitCode !== 0)
          assert.strictEqual(result.stderr, '')
          assert.strictEqual(payload.ok, false)
          assert.isTrue(payload.diagnostics.length > 0)
          assert.isString(payload.diagnostics[0]?.code)
          assert.isString(payload.diagnostics[0]?.fix)
        }),
      ))

    it.effect('emits stable JSON plugin discovery output', () =>
      Effect.gen(function* () {
        const result = yield* runPatchPlane(['plugins', 'list', '--json'])
        const payload = JSON.parse(result.stdout) as {
          plugins: ReadonlyArray<{ id: string; provides: readonly string[]; surfaces: readonly string[] }>
        }

        assert.strictEqual(result.exitCode, ChildProcessSpawner.ExitCode(0), result.stderr)
        assert.strictEqual(result.stderr, '')
        assert.isTrue(payload.plugins.some((plugin) => plugin.id === 'daytona'))
      }))

    it.effect('emits stable JSON plugin explain output', () =>
      Effect.gen(function* () {
        const result = yield* runPatchPlane(['plugins', 'explain', 'daytona', '--json'])
        const payload = JSON.parse(result.stdout) as {
          plugin: { id: string; provides: readonly string[]; surfaces: readonly string[] }
        }

        assert.strictEqual(result.exitCode, ChildProcessSpawner.ExitCode(0), result.stderr)
        assert.strictEqual(result.stderr, '')
        assert.strictEqual(payload.plugin.id, 'daytona')
        assert.isTrue(payload.plugin.provides.includes('SandboxService'))
      }))

    it.effect('emits valid JSON-only env check output', () =>
      withTempProject((dir) =>
        Effect.gen(function* () {
          const result = yield* runPatchPlane(['env', 'check', '--surface', 'app', '--json'], { cwd: dir })
          const payload = JSON.parse(result.stdout) as {
            ok: boolean
            missingRequired: number
            results: ReadonlyArray<{ status: string; variable: { name: string } }>
          }

          assert.isTrue(result.exitCode !== 0)
          assert.strictEqual(result.stderr, '')
          assert.strictEqual(payload.ok, false)
          assert.isTrue(payload.missingRequired > 0)
          assert.isTrue(payload.results.some((item) => item.variable.name === 'CONVEX_URL'))
        }),
      ))

    it.effect('emits valid JSON dry-run init plan without mutating files', () =>
      withTempProject((dir) =>
        Effect.gen(function* () {
          const path = yield* Path.Path
          const result = yield* runPatchPlane(['init', '--profile', 'app', '--dry-run', '--yes', '--json'], { cwd: dir })
          const payload = JSON.parse(result.stdout) as {
            ok: boolean
            dryRun: boolean
            profile: string
            changes: ReadonlyArray<{ message: string }>
          }

          assert.strictEqual(result.exitCode, ChildProcessSpawner.ExitCode(0), result.stderr)
          assert.strictEqual(result.stderr, '')
          assert.strictEqual(payload.ok, true)
          assert.strictEqual(payload.dryRun, true)
          assert.strictEqual(payload.profile, 'app')
          assert.isTrue(payload.changes.some((change) => change.message.includes('would write')))
          assert.isFalse(yield* pathExists(path.join(dir, 'patchplane.config.json')))
        }),
      ))

    it.effect('reports package version through --version', () =>
      Effect.gen(function* () {
        const result = yield* runPatchPlane(['--version'])
        assert.strictEqual(result.exitCode, ChildProcessSpawner.ExitCode(0), result.stderr)
        assert.match(result.stdout, /patchplane v0\.0\.1/)
        assert.strictEqual(result.stderr, '')
      }))

    it.effect('supports --config and --env-file for explicit automation inputs', () =>
      withTempProject((dir) =>
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem
          const path = yield* Path.Path
          const configPath = path.join(dir, 'custom.patchplane.json')
          const envPath = path.join(dir, 'custom.env')
          yield* fs.writeFileString(configPath, JSON.stringify({
            plugins: { app: ['convex', 'workos'] },
            runtime: { githubWebhookExecution: 'daytona-command' },
          }))
          yield* fs.writeFileString(envPath, [
            'CONVEX_URL=https://example.convex.cloud',
            'PATCHPLANE_SYSTEM_INGESTION_SECRET=secret',
            'VITE_CONVEX_URL=https://example.convex.cloud',
            'WORKOS_API_KEY=sk_test',
            'WORKOS_CLIENT_ID=client',
            'WORKOS_COOKIE_PASSWORD=12345678901234567890123456789012',
            'WORKOS_REDIRECT_URI=http://localhost:3000/callback',
          ].join('\n'))

          const result = yield* runPatchPlane(['--config', configPath, '--env-file', envPath, 'doctor', '--surface', 'app', '--json'], { cwd: dir })
          const payload = JSON.parse(result.stdout) as { ok: boolean; failures: number }

          assert.strictEqual(result.exitCode, ChildProcessSpawner.ExitCode(0), result.stderr)
          assert.strictEqual(result.stderr, '')
          assert.strictEqual(payload.ok, true)
          assert.strictEqual(payload.failures, 0)
        }),
      ))
  })
})
