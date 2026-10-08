import { NodeServices } from '@effect/platform-node'
import { Effect, Exit, FileSystem, Path } from 'effect'
import type { PlatformError } from 'effect/PlatformError'
import { TestConsole } from 'effect/testing'
import { makeCliLayer } from './runtime'
import { afterEach, describe, expect, it, layer } from '@effect/vitest'
import { Command } from 'effect/cli'
import { doctorCommand } from './commands/doctor'
import { envCommand } from './commands/env'
import { initCommand } from './commands/init'
import { pluginsCommand } from './commands/plugins'
import { patchPlaneRootCommand } from './command'
import { cliCommand } from './main'
import { isRuntimeSurface, parsePluginIds } from './services/env-file'
import {
  CliConfigFlag,
  CliCwdFlag,
  CliDotenvFlag,
} from './services/global-options'
import { patchPlaneDefaultSurfaces } from '@patchplane/plugins/registry'

function runPatchPlane(args: readonly string[]) {
  return Command.runWith(cliCommand, { version: '0.0.0' })(args)
}

function runPatchPlaneIn(cwd: string, args: readonly string[]) {
  const cliLayer = makeCliLayer({ cwd, envFiles: [] })
  return Command.runWith(
    patchPlaneRootCommand.pipe(
      Command.withSubcommands([
        initCommand.pipe(Command.provide(cliLayer)),
        doctorCommand.pipe(Command.provide(cliLayer)),
        envCommand.pipe(Command.provide(cliLayer)),
        pluginsCommand.pipe(Command.provide(cliLayer)),
      ]),
      Command.withGlobalFlags([CliCwdFlag, CliConfigFlag, CliDotenvFlag]),
    ),
    { version: '0.0.0' },
  )(args)
}

function captureConsole<A, E, R>(effect: Effect.Effect<A, E, R>) {
  return Effect.gen(function* () {
    const stdoutStart = (yield* TestConsole.logLines).length
    const stderrStart = (yield* TestConsole.errorLines).length

    const exit = yield* Effect.exit(effect)

    const stdout = yield* TestConsole.logLines
    const stderr = yield* TestConsole.errorLines
    return {
      stdout: stdout.slice(stdoutStart).join('\n'),
      stderr: stderr.slice(stderrStart).join('\n'),
      failed: Exit.isFailure(exit),
    }
  })
}

function projectPath(dir: string, file: string) {
  return Effect.map(Path.Path, (path) => path.join(dir, file))
}

function readProjectFile(dir: string, file: string) {
  return Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const path = yield* projectPath(dir, file)
    return yield* fs.readFileString(path)
  })
}

function parseEnvFile(contents: string) {
  const values = new Map<string, string>()
  for (const line of contents
    .split(/\r?\n/)
    .filter((entry) => entry.length > 0 && !entry.startsWith('#'))) {
    const separator = line.indexOf('=')
    const key = line.slice(0, separator)
    if (values.has(key)) throw new Error(`Duplicate environment key: ${key}`)
    values.set(key, line.slice(separator + 1))
  }
  return values
}

function parseEnvTemplate(contents: string) {
  return parseEnvFile(
    contents
      .split('\n')
      .filter((line) => line.includes('='))
      .join('\n'),
  )
}

function writeProjectFile(dir: string, file: string, content: string) {
  return Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const path = yield* projectPath(dir, file)
    yield* fs.writeFileString(path, content)
  })
}

function projectPathExists(dir: string, file: string) {
  return Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const path = yield* projectPath(dir, file)
    return yield* fs.exists(path)
  })
}

function projectPathIsDirectory(dir: string, file: string) {
  return Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const path = yield* projectPath(dir, file)
    const stat = yield* fs.stat(path)
    return stat.type === 'Directory'
  })
}

function inTempProject<A, E, R>(
  fn: (dir: string) => Effect.Effect<A, E, R>,
): Effect.Effect<A, E | PlatformError, R | FileSystem.FileSystem | Path.Path> {
  return Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const dir = yield* fs.makeTempDirectory({ prefix: 'patchplane-cli-' })
    try {
      return yield* fn(dir)
    } finally {
      yield* fs.remove(dir, { recursive: true }).pipe(Effect.ignore)
    }
  })
}

afterEach(() => {
  process.exitCode = undefined
})

describe('patchplane cli parsing', () => {
  it.effect('importing the executable module does not run the command', () =>
    Effect.gen(function* () {
      process.exitCode = undefined
      yield* Effect.promise(() => import('./main'))
      expect(process.exitCode).toBeUndefined()
    }),
  )

  it('resolves default plugin ids for a runtime surface', () => {
    expect(parsePluginIds({ surface: 'githubWebhook' })).toEqual([
      'github',
      'convex',
      'daytona',
      'observability',
      'sentry',
    ])
  })

  it('rejects unknown runtime surfaces before plugin selection', () => {
    expect(isRuntimeSurface('desktop')).toBe(false)
  })
})

layer(NodeServices.layer)('patchplane cli integration', (effectIt) => {
  effectIt.effect('runs plugins explain through the Effect command tree', () =>
    Effect.gen(function* () {
      const output = yield* captureConsole(
        runPatchPlane(['plugins', 'explain', 'daytona']),
      )

      expect(output.stdout).toContain('daytona - Daytona sandbox')
      expect(output.stdout).toContain('DAYTONA_API_KEY')
      expect(output.stderr).toBe('')
    }),
  )

  effectIt.effect(
    'prints selected env template through the Effect command tree',
    () =>
      Effect.gen(function* () {
        const output = yield* captureConsole(
          runPatchPlane(['env', 'template', '--plugins', 'github,convex']),
        )

        const template = parseEnvTemplate(output.stdout)
        expect(template.has('GITHUB_APP_ID')).toBe(true)
        expect(template.has('GITHUB_PRIVATE_KEY')).toBe(true)
        expect(template.has('PATCHPLANE_SYSTEM_INGESTION_SECRET')).toBe(true)
        expect(template.has('DAYTONA_API_KEY')).toBe(false)
      }),
  )

  effectIt.effect('applies --cwd through Effect global settings', () =>
    inTempProject((dir) =>
      Effect.gen(function* () {
        yield* captureConsole(
          runPatchPlane(['--cwd', dir, 'init', '--profile', 'app', '--yes']),
        )

        expect(yield* projectPathExists(dir, 'patchplane.config.json')).toBe(
          true,
        )
        expect(yield* projectPathExists(dir, '.env.local')).toBe(true)
      }),
    ),
  )

  effectIt.effect(
    'explicit --dotenv values override blank auto-loaded placeholders',
    () =>
      inTempProject((dir) =>
        Effect.gen(function* () {
          yield* writeProjectFile(
            dir,
            '.env.local',
            [
              'CONVEX_URL=',
              'PATCHPLANE_SYSTEM_INGESTION_SECRET=',
              'VITE_CONVEX_URL=',
              'WORKOS_API_KEY=',
              'WORKOS_CLIENT_ID=',
              'WORKOS_COOKIE_PASSWORD=',
              'WORKOS_REDIRECT_URI=',
              '',
            ].join('\n'),
          )
          yield* writeProjectFile(
            dir,
            'secrets.env',
            [
              'CONVEX_URL=x',
              'PATCHPLANE_SYSTEM_INGESTION_SECRET=x',
              'VITE_CONVEX_URL=x',
              'WORKOS_API_KEY=x',
              'WORKOS_CLIENT_ID=x',
              'WORKOS_COOKIE_PASSWORD=x',
              'WORKOS_REDIRECT_URI=x',
              '',
            ].join('\n'),
          )

          const output = yield* captureConsole(
            runPatchPlane([
              '--cwd',
              dir,
              '--dotenv',
              'secrets.env',
              'env',
              'check',
              '--surface',
              'app',
              '--json',
            ]),
          )

          expect(output.failed).toBe(false)
          expect(JSON.parse(output.stdout).missingRequired).toBe(0)
        }),
      ),
  )

  effectIt.effect(
    'initializes a real project with root config, env file, and generated state dirs',
    () =>
      inTempProject((dir) =>
        Effect.gen(function* () {
          const output = yield* captureConsole(
            runPatchPlaneIn(dir, ['init', '--profile', 'app', '--yes']),
          )

          const config = JSON.parse(
            yield* readProjectFile(dir, 'patchplane.config.json'),
          )
          expect(config.plugins).toEqual({ app: patchPlaneDefaultSurfaces.app })
          expect(config.runtime.githubWebhookExecution).toBe('daytona-command')

          const env = yield* readProjectFile(dir, '.env.local')
          expect(env).toContain('CONVEX_URL=')
          expect(env).toContain('WORKOS_API_KEY=')
          expect(yield* projectPathIsDirectory(dir, '.patchplane/logs')).toBe(
            true,
          )
          expect(yield* projectPathIsDirectory(dir, '.patchplane/cache')).toBe(
            true,
          )
          expect(yield* projectPathIsDirectory(dir, '.patchplane/state')).toBe(
            true,
          )
          expect(output.stdout).toContain('created patchplane.config.json')
          expect(output.stdout).toContain('Next: patchplane doctor')
        }),
      ),
  )

  effectIt.effect('init --profile app --yes writes only app env vars', () =>
    inTempProject((dir) =>
      Effect.gen(function* () {
        yield* captureConsole(
          runPatchPlaneIn(dir, ['init', '--profile', 'app', '--yes']),
        )
        const env = parseEnvFile(yield* readProjectFile(dir, '.env.local'))
        expect(env.has('CONVEX_URL')).toBe(true)
        expect(env.has('WORKOS_API_KEY')).toBe(true)
        expect(env.has('GITHUB_APP_ID')).toBe(false)
        expect(env.has('DAYTONA_API_KEY')).toBe(false)
      }),
    ),
  )

  effectIt.effect(
    'init --profile githubWebhook --yes writes webhook env vars, not WorkOS vars',
    () =>
      inTempProject((dir) =>
        Effect.gen(function* () {
          yield* captureConsole(
            runPatchPlaneIn(dir, [
              'init',
              '--profile',
              'githubWebhook',
              '--yes',
            ]),
          )
          const env = parseEnvFile(yield* readProjectFile(dir, '.env.local'))
          expect(env.has('GITHUB_APP_ID')).toBe(true)
          expect(env.has('GITHUB_PRIVATE_KEY')).toBe(true)
          expect(env.has('DAYTONA_API_KEY')).toBe(true)
          expect(env.has('CONVEX_URL')).toBe(true)
          expect(env.has('WORKOS_API_KEY')).toBe(false)
        }),
      ),
  )

  effectIt.effect(
    'init --profile githubWebhook --with-pi --yes enables Daytona Pi mode without loading the in-process pi plugin',
    () =>
      inTempProject((dir) =>
        Effect.gen(function* () {
          yield* captureConsole(
            runPatchPlaneIn(dir, [
              'init',
              '--profile',
              'githubWebhook',
              '--with-pi',
              '--yes',
            ]),
          )
          const config = JSON.parse(
            yield* readProjectFile(dir, 'patchplane.config.json'),
          )
          expect(config.plugins.githubWebhook).toEqual(
            patchPlaneDefaultSurfaces.githubWebhook,
          )
          expect(config.plugins.githubWebhook).not.toContain('pi')
          expect(config.runtime.githubWebhookExecution).toBe('daytona-pi')
        }),
      ),
  )

  effectIt.effect('preserves existing .env.local values', () =>
    inTempProject((dir) =>
      Effect.gen(function* () {
        yield* writeProjectFile(dir, '.env.local', 'WORKOS_API_KEY=keep-me\n')
        yield* captureConsole(
          runPatchPlaneIn(dir, ['init', '--profile', 'app', '--yes']),
        )
        const env = yield* readProjectFile(dir, '.env.local')
        expect(parseEnvFile(env).get('WORKOS_API_KEY')).toBe('keep-me')
        expect(parseEnvFile(env).has('CONVEX_URL')).toBe(true)
      }),
    ),
  )

  effectIt.effect('--dry-run writes nothing', () =>
    inTempProject((dir) =>
      Effect.gen(function* () {
        const output = yield* captureConsole(
          runPatchPlaneIn(dir, [
            'init',
            '--profile',
            'app',
            '--dry-run',
            '--yes',
          ]),
        )
        expect(output.failed).toBe(false)
        expect(yield* projectPathExists(dir, 'patchplane.config.json')).toBe(
          false,
        )
        expect(yield* projectPathExists(dir, '.env.local')).toBe(false)
        expect(yield* projectPathExists(dir, '.patchplane')).toBe(false)
      }),
    ),
  )

  effectIt.effect(
    '--force overwrites config but does not erase non-empty secrets',
    () =>
      inTempProject((dir) =>
        Effect.gen(function* () {
          yield* writeProjectFile(
            dir,
            'patchplane.config.json',
            '{"old":true}\n',
          )
          yield* writeProjectFile(dir, '.env.local', 'WORKOS_API_KEY=keep-me\n')
          yield* captureConsole(
            runPatchPlaneIn(dir, [
              'init',
              '--profile',
              'app',
              '--force',
              '--yes',
            ]),
          )
          const config = JSON.parse(
            yield* readProjectFile(dir, 'patchplane.config.json'),
          )
          const env = yield* readProjectFile(dir, '.env.local')
          expect(config.plugins).toEqual({ app: patchPlaneDefaultSurfaces.app })
          expect(env).toContain('WORKOS_API_KEY=keep-me')
        }),
      ),
  )

  effectIt.effect(
    'non-interactive init without explicit flags fails clearly',
    () =>
      inTempProject((dir) =>
        Effect.gen(function* () {
          const output = yield* captureConsole(
            runPatchPlaneIn(dir, ['init', '--non-interactive']),
          )
          expect(output.stderr).toContain(
            'patchplane init needs an interactive terminal or explicit flags',
          )
          expect(output.failed).toBe(true)
        }),
      ),
  )

  effectIt.effect(
    'rejects --with-pi for app profile as structured CLI validation',
    () =>
      inTempProject((dir) =>
        Effect.gen(function* () {
          const output = yield* captureConsole(
            runPatchPlaneIn(dir, [
              'init',
              '--profile',
              'app',
              '--with-pi',
              '--yes',
            ]),
          )
          expect(output.failed).toBe(true)
        }),
      ),
  )

  effectIt.effect(
    'rejects unknown plugin ids as structured CLI validation',
    () =>
      Effect.gen(function* () {
        const output = yield* captureConsole(
          runPatchPlane(['env', 'check', '--plugins', 'nope']),
        )
        expect(output.failed).toBe(true)
      }),
  )

  effectIt.effect('root command without subcommand shows help and fails', () =>
    Effect.gen(function* () {
      const output = yield* captureConsole(runPatchPlane([]))
      expect(output.failed).toBe(true)
    }),
  )

  effectIt.effect(
    'doctor checks real config and env files and exits non-zero on missing required env',
    () =>
      inTempProject((dir) =>
        Effect.gen(function* () {
          yield* captureConsole(
            runPatchPlaneIn(dir, ['init', '--profile', 'app', '--yes']),
          )
          const output = yield* captureConsole(
            runPatchPlaneIn(dir, ['doctor', '--surface', 'app']),
          )

          expect(output.stdout).toContain('ok      patchplane.config.json')
          expect(output.stdout).toContain('missing CONVEX_URL')
          expect(output.stderr).toContain('Doctor found')
          expect(output.failed).toBe(true)
        }),
      ),
  )
})
