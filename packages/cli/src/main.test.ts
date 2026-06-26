import { Effect, Exit, FileSystem, Path } from 'effect'
import type { PlatformError } from 'effect/PlatformError'
import { TestConsole } from 'effect/testing'
import { CliLayer } from './runtime'
import { afterEach, describe, expect, it, layer } from '@effect/vitest'
import { Command } from 'effect/unstable/cli'
import { patchPlaneCommand } from './main'
import { parsePluginIds } from './services/env-file'

function runPatchPlane(args: readonly string[]) {
  return Command.runWith(patchPlaneCommand, { version: '0.0.0' })(args)
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

function inTempProject<A, E, R>(fn: (dir: string) => Effect.Effect<A, E, R>): Effect.Effect<A, E | PlatformError, R | FileSystem.FileSystem | Path.Path> {
  return Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const previousCwd = process.cwd()
    const dir = yield* fs.makeTempDirectory({ prefix: 'patchplane-cli-' })
    process.chdir(dir)
    try {
      return yield* fn(dir)
    } finally {
      process.chdir(previousCwd)
      yield* fs.remove(dir, { recursive: true }).pipe(Effect.ignore)
    }
  })
}

afterEach(() => {
  process.exitCode = undefined
})

describe('patchplane cli parsing', () => {
  it('resolves default plugin ids for a runtime surface', () => {
    expect(parsePluginIds({ surface: 'githubWebhook' })).toEqual([
      'github',
      'convex',
      'daytona',
      'observability',
    ])
  })

  it('rejects unknown runtime surfaces', () => {
    expect(() => parsePluginIds({ surface: 'desktop' })).toThrow(
      'Unknown surface: desktop',
    )
  })
})

layer(CliLayer)('patchplane cli integration', (effectIt) => {
  effectIt.effect('runs plugins explain through the Effect command tree', () =>
    Effect.gen(function* () {
      const output = yield* captureConsole(
        runPatchPlane(['plugins', 'explain', 'daytona']),
      )

      expect(output.stdout).toContain('daytona - Daytona sandbox')
      expect(output.stdout).toContain('DAYTONA_API_KEY')
      expect(output.stderr).toBe('')
    }))

  effectIt.effect('prints selected env template through the Effect command tree', () =>
    Effect.gen(function* () {
      const output = yield* captureConsole(
        runPatchPlane(['env', 'template', '--plugins', 'github,convex']),
      )

      expect(output.stdout).toContain('GITHUB_APP_ID=')
      expect(output.stdout).toContain('GITHUB_PRIVATE_KEY=')
      expect(output.stdout).toContain('PATCHPLANE_SYSTEM_INGESTION_SECRET=')
      expect(output.stdout).not.toContain('DAYTONA_API_KEY=')
    }))

  effectIt.effect('initializes a real project with root config, env file, and generated state dirs', () =>
    inTempProject((dir) =>
      Effect.gen(function* () {
        const output = yield* captureConsole(
          runPatchPlane(['init', '--profile', 'app', '--yes']),
        )

        const config = JSON.parse(yield* readProjectFile(dir, 'patchplane.config.json'))
        expect(config.plugins).toEqual({ app: ['convex', 'workos'] })
        expect(config.runtime.githubWebhookExecution).toBe('daytona-command')

        const env = yield* readProjectFile(dir, '.env.local')
        expect(env).toContain('CONVEX_URL=')
        expect(env).toContain('WORKOS_API_KEY=')
        expect(yield* projectPathIsDirectory(dir, '.patchplane/logs')).toBe(true)
        expect(yield* projectPathIsDirectory(dir, '.patchplane/cache')).toBe(true)
        expect(yield* projectPathIsDirectory(dir, '.patchplane/state')).toBe(true)
        expect(output.stdout).toContain('created patchplane.config.json')
        expect(output.stdout).toContain('Next: patchplane doctor')
      }),
    ))

  effectIt.effect('init --profile app --yes writes only app env vars', () =>
    inTempProject((dir) =>
      Effect.gen(function* () {
        yield* captureConsole(runPatchPlane(['init', '--profile', 'app', '--yes']))
        const env = yield* readProjectFile(dir, '.env.local')
        expect(env).toContain('CONVEX_URL=')
        expect(env).toContain('WORKOS_API_KEY=')
        expect(env).not.toContain('GITHUB_APP_ID=')
        expect(env).not.toContain('DAYTONA_API_KEY=')
      }),
    ))

  effectIt.effect('init --profile githubWebhook --yes writes webhook env vars, not WorkOS vars', () =>
    inTempProject((dir) =>
      Effect.gen(function* () {
        yield* captureConsole(runPatchPlane(['init', '--profile', 'githubWebhook', '--yes']))
        const env = yield* readProjectFile(dir, '.env.local')
        expect(env).toContain('GITHUB_APP_ID=')
        expect(env).toContain('GITHUB_PRIVATE_KEY=')
        expect(env).toContain('DAYTONA_API_KEY=')
        expect(env).toContain('CONVEX_URL=')
        expect(env).not.toContain('WORKOS_API_KEY=')
      }),
    ))

  effectIt.effect('init --profile githubWebhook --with-pi --yes includes pi and daytona-pi runtime', () =>
    inTempProject((dir) =>
      Effect.gen(function* () {
        yield* captureConsole(runPatchPlane(['init', '--profile', 'githubWebhook', '--with-pi', '--yes']))
        const config = JSON.parse(yield* readProjectFile(dir, 'patchplane.config.json'))
        expect(config.plugins.githubWebhook).toContain('pi')
        expect(config.runtime.githubWebhookExecution).toBe('daytona-pi')
      }),
    ))

  effectIt.effect('preserves existing .env.local values', () =>
    inTempProject((dir) =>
      Effect.gen(function* () {
        yield* writeProjectFile(dir, '.env.local', 'WORKOS_API_KEY=keep-me\n')
        yield* captureConsole(runPatchPlane(['init', '--profile', 'app', '--yes']))
        const env = yield* readProjectFile(dir, '.env.local')
        expect(env).toContain('WORKOS_API_KEY=keep-me')
        expect((env.match(/WORKOS_API_KEY=/g) ?? []).length).toBe(1)
      }),
    ))

  effectIt.effect('--dry-run writes nothing', () =>
    inTempProject((dir) =>
      Effect.gen(function* () {
        const output = yield* captureConsole(runPatchPlane(['init', '--profile', 'app', '--dry-run', '--yes']))
        expect(output.stdout).toContain('would write patchplane.config.json')
        expect(yield* projectPathExists(dir, 'patchplane.config.json')).toBe(false)
        expect(yield* projectPathExists(dir, '.env.local')).toBe(false)
        expect(yield* projectPathExists(dir, '.patchplane')).toBe(false)
      }),
    ))

  effectIt.effect('--force overwrites config but does not erase non-empty secrets', () =>
    inTempProject((dir) =>
      Effect.gen(function* () {
        yield* writeProjectFile(dir, 'patchplane.config.json', '{"old":true}\n')
        yield* writeProjectFile(dir, '.env.local', 'WORKOS_API_KEY=keep-me\n')
        yield* captureConsole(runPatchPlane(['init', '--profile', 'app', '--force', '--yes']))
        const config = JSON.parse(yield* readProjectFile(dir, 'patchplane.config.json'))
        const env = yield* readProjectFile(dir, '.env.local')
        expect(config.plugins).toEqual({ app: ['convex', 'workos'] })
        expect(env).toContain('WORKOS_API_KEY=keep-me')
      }),
    ))

  effectIt.effect('non-interactive init without explicit flags fails clearly', () =>
    inTempProject(() =>
      Effect.gen(function* () {
        const output = yield* captureConsole(runPatchPlane(['init', '--non-interactive']))
        expect(output.stderr).toContain('patchplane init needs an interactive terminal or explicit flags')
        expect(output.failed).toBe(true)
      }),
    ))

  effectIt.effect('rejects --with-pi for app profile as structured CLI validation', () =>
    inTempProject(() =>
      Effect.gen(function* () {
        const output = yield* captureConsole(runPatchPlane(['init', '--profile', 'app', '--with-pi', '--yes']))
        expect(output.stdout).toContain('USAGE')
        expect(output.stderr).toContain('Invalid value for flag --with-pi')
        expect(output.failed).toBe(true)
      }),
    ))

  effectIt.effect('rejects unknown plugin ids as structured CLI validation', () =>
    Effect.gen(function* () {
      const output = yield* captureConsole(runPatchPlane(['env', 'check', '--plugins', 'nope']))
      expect(output.stdout).toContain('USAGE')
      expect(output.stderr).toContain('Invalid value for flag --plugins')
      expect(output.failed).toBe(true)
    }))

  effectIt.effect('root command without subcommand shows help and fails', () =>
    Effect.gen(function* () {
      const output = yield* captureConsole(runPatchPlane([]))
      expect(output.stdout).toContain('SUBCOMMANDS')
      expect(output.stderr).toContain('Missing required argument: subcommand')
      expect(output.failed).toBe(true)
    }))

  effectIt.effect('doctor checks real config and env files and exits non-zero on missing required env', () =>
    inTempProject(() =>
      Effect.gen(function* () {
        yield* captureConsole(runPatchPlane(['init', '--profile', 'app', '--yes']))
        const output = yield* captureConsole(
          runPatchPlane(['doctor', '--surface', 'app']),
        )

        expect(output.stdout).toContain('ok      patchplane.config.json')
        expect(output.stdout).toContain('missing CONVEX_URL')
        expect(output.stderr).toContain('Doctor found')
        expect(output.failed).toBe(true)
      }),
    ))
})
