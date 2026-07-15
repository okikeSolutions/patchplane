import { describe, expect, it } from '@effect/vitest'
import { vi } from 'vitest'
import { ConfigProvider, Effect, Exit, Fiber, Layer, Option, Redacted, Stream } from 'effect'
import { SandboxService } from '@patchplane/core/services/sandbox-service'
import type { DaytonaConfig } from './DaytonaConfig'
import { makeDaytonaSandboxLayer, type DaytonaClientLike, type DaytonaSandboxLike } from './DaytonaSandboxPlugin'
import { toDaytonaCreateSandboxParams, toSandboxPolicy } from './daytona-adapter'
import { executeSandboxCommand, startSandboxSessionCommand, streamSandboxSessionCommandLogs, type DaytonaCommandSandbox } from './daytona-process'
import { buildPiCommandSpec, buildRedactedPiCommandSpec, renderShellCommand } from '../sandbox-runtime/pi/command'
import { piRuntimeEnvironment } from '../sandbox-runtime/pi/config'
import { parsePiJsonRuntimeEventsEffect } from '../sandbox-runtime/pi/events'

const repositoryBaseSha = 'a'.repeat(40)

function config(overrides: Partial<DaytonaConfig> = {}): DaytonaConfig {
  return {
    apiKey: Redacted.make('daytona-key'),
    apiUrl: Option.none(),
    target: Option.none(),
    networkBlockAll: Option.none(),
    networkAllowList: Option.none(),
    resourceCpu: Option.none(),
    resourceMemory: Option.none(),
    resourceDisk: Option.none(),
    retainSandboxes: Option.none(),
    ...overrides,
  }
}

function fakeSandbox(overrides: Partial<DaytonaSandboxLike> = {}) {
  const sandbox: DaytonaSandboxLike = {
    id: 'sandbox-1',
    name: 'patchplane-test',
    target: 'test-target',
    state: 'started',
    git: {
      clone: vi.fn(async () => undefined),
    },
    process: {
      createSession: vi.fn(async () => undefined),
      executeSessionCommand: vi.fn(async (_sessionId: string, request: { readonly command: string }) =>
        request.command.includes('git rev-parse HEAD')
          ? { exitCode: 0, stdout: repositoryBaseSha, stderr: '' }
          : { exitCode: 0, stdout: 'ok', stderr: '' }),
      deleteSession: vi.fn(async () => undefined),
    },
    waitUntilStarted: vi.fn(async () => undefined),
    delete: vi.fn(async () => undefined),
    ...overrides,
  }
  return sandbox
}

function fakeClient(sandbox: DaytonaSandboxLike, overrides: Partial<DaytonaClientLike> = {}) {
  const client: DaytonaClientLike = {
    create: vi.fn(async () => sandbox),
    delete: vi.fn(async () => undefined),
    [Symbol.asyncDispose]: vi.fn(async () => undefined),
    ...overrides,
  }
  return client
}

function testLayer(client: DaytonaClientLike, env: Record<string, string> = {}) {
  const configProvider = ConfigProvider.layer(ConfigProvider.fromEnv({
    env: { DAYTONA_API_KEY: 'daytona-key', ...env },
  }))
  return Layer.merge(
    makeDaytonaSandboxLayer(() => client).pipe(Layer.provide(configProvider)),
    configProvider,
  )
}

function streamingLogsFixture(sessionId: string, commandId: string): Promise<{ readonly stdout: string; readonly stderr: string }>
function streamingLogsFixture(sessionId: string, commandId: string, onStdout: (chunk: string) => void, onStderr: (chunk: string) => void): Promise<void>
async function streamingLogsFixture(
  _sessionId: string,
  _commandId: string,
  onStdout?: (chunk: string) => void,
  onStderr?: (chunk: string) => void,
): Promise<void | { readonly stdout: string; readonly stderr: string }> {
  if (onStdout !== undefined && onStderr !== undefined) {
    onStdout('{"type":"agent_')
    onStderr('warning')
    onStdout('start"}\n')
    return
  }
  return { stdout: '', stderr: '' }
}

const commandInput = {
  traceId: 'trace-1',
  repositoryUrl: 'https://github.com/okikeSolutions/guerillaglass.git',
  repositoryFullName: 'okikeSolutions/guerillaglass',
  command: 'bun test',
}

describe('Daytona sandbox boundary adapters', () => {
  it.effect('maps stable Daytona create defaults', () =>
    Effect.sync(() => {
      const params = toDaytonaCreateSandboxParams(
        config(),
        { traceId: 'trace-1', repositoryFullName: 'owner/repo' },
      )

      expect(params).toMatchObject({
        language: 'typescript',
        ephemeral: true,
        autoStopInterval: 5,
        autoArchiveInterval: 0,
        labels: {
          app: 'patchplane',
          traceId: 'trace-1',
          repository: 'owner/repo',
        },
      })
    }),
  )

  it.effect('maps Daytona network and resource options', () =>
    Effect.sync(() => {
      const params = toDaytonaCreateSandboxParams(
        config({
          networkBlockAll: Option.some(false),
          networkAllowList: Option.some('0.0.0.0/0'),
          resourceCpu: Option.some(2),
          resourceMemory: Option.some(4),
          resourceDisk: Option.some(8),
        }),
        { traceId: 'trace-1', repositoryFullName: 'owner/repo' },
      )

      expect(params).toMatchObject({
        networkBlockAll: false,
        networkAllowList: '0.0.0.0/0',
        resources: { cpu: 2, memory: 4, disk: 8 },
      })
    }),
  )

  it.effect('can retain Daytona sandboxes for dashboard inspection', () =>
    Effect.sync(() => {
      const params = toDaytonaCreateSandboxParams(
        config({ retainSandboxes: Option.some(true) }),
        { traceId: 'trace-1', repositoryFullName: 'owner/repo' },
      )

      expect(params).toMatchObject({
        ephemeral: false,
        autoDeleteInterval: -1,
      })
    }),
  )

  it.effect('normalizes Daytona config into PatchPlane sandbox policy metadata', () =>
    Effect.sync(() => {
      const policy = toSandboxPolicy(
        config({
          networkBlockAll: Option.some(false),
          networkAllowList: Option.some('0.0.0.0/0'),
          resourceCpu: Option.some(2),
          resourceMemory: Option.some(4),
          resourceDisk: Option.some(8),
        }),
        { timeoutSeconds: 42 },
      )

      expect(policy).toEqual({
        lifecycle: {
          ephemeral: true,
          retainAfterRun: false,
          autoStopMinutes: 5,
          autoArchiveMinutes: 0,
          autoDeleteMinutes: 0,
        },
        network: { blockAll: false, allowList: '0.0.0.0/0' },
        resources: { cpu: 2, memoryGb: 4, diskGb: 8 },
        timeoutSeconds: 42,
      })
    }),
  )

  it.effect('deletes sandbox and disposes the client when startup fails', () => {
    const sandbox = fakeSandbox({
      waitUntilStarted: vi.fn(async () => { throw new Error('start failed') }),
    })
    const client = fakeClient(sandbox)

    return Effect.gen(function* () {
      const service = yield* SandboxService
      const exit = yield* service.runRepositoryCommand(commandInput).pipe(Effect.exit)

      expect(Exit.isFailure(exit)).toBe(true)
      expect(client.delete).toHaveBeenCalledWith(sandbox, 120)
      expect(client[Symbol.asyncDispose]).toHaveBeenCalled()
    }).pipe(Effect.provide(testLayer(client)))
  })

  it.effect('deletes sandbox when repository clone fails', () => {
    const sandbox = fakeSandbox({
      git: { clone: vi.fn(async () => { throw new Error('clone failed') }) },
    })
    const client = fakeClient(sandbox)

    return Effect.gen(function* () {
      const service = yield* SandboxService
      const exit = yield* service.runRepositoryCommand(commandInput).pipe(Effect.exit)

      expect(Exit.isFailure(exit)).toBe(true)
      expect(sandbox.git.clone).toHaveBeenCalledWith(
        commandInput.repositoryUrl,
        'workspace/repo',
        undefined,
        undefined,
        undefined,
        undefined,
      )
      expect(client.delete).toHaveBeenCalledWith(sandbox, 120)
      expect(client[Symbol.asyncDispose]).toHaveBeenCalled()
    }).pipe(Effect.provide(testLayer(client)))
  })

  it.effect('deletes an automatically retained RPC sandbox when setup fails', () => {
    const sandbox = fakeSandbox({
      git: { clone: vi.fn(async () => { throw new Error('clone failed') }) },
    })
    const client = fakeClient(sandbox)

    return Effect.gen(function* () {
      const service = yield* SandboxService
      const exit = yield* service.runRepositoryAgent({
        traceId: 'trace-rpc-failure',
        repositoryUrl: commandInput.repositoryUrl,
        repositoryFullName: commandInput.repositoryFullName,
        prompt: 'Inspect the repository.',
        provider: 'openai',
        model: 'gpt-5.5',
        mode: 'rpc',
      }).pipe(Effect.exit)

      expect(Exit.isFailure(exit)).toBe(true)
      expect(client.delete).toHaveBeenCalledWith(sandbox, 120)
      expect(client[Symbol.asyncDispose]).toHaveBeenCalled()
    }).pipe(Effect.provide(testLayer(client, { OPENAI_API_KEY: 'test-key' })))
  })

  it.effect('preserves an RPC sandbox on failure when inspection retention is explicit', () => {
    const sandbox = fakeSandbox({
      git: { clone: vi.fn(async () => { throw new Error('clone failed') }) },
    })
    const client = fakeClient(sandbox)

    return Effect.gen(function* () {
      const service = yield* SandboxService
      yield* service.runRepositoryAgent({
        traceId: 'trace-rpc-retained-failure',
        repositoryUrl: commandInput.repositoryUrl,
        repositoryFullName: commandInput.repositoryFullName,
        prompt: 'Inspect the repository.',
        provider: 'openai',
        model: 'gpt-5.5',
        mode: 'rpc',
      }).pipe(Effect.exit)

      expect(client.delete).not.toHaveBeenCalled()
      expect(client[Symbol.asyncDispose]).toHaveBeenCalled()
    }).pipe(Effect.provide(testLayer(client, {
      DAYTONA_RETAIN_SANDBOXES: 'true',
      OPENAI_API_KEY: 'test-key',
    })))
  })

  it.effect('deletes sandbox and command session when command execution throws', () => {
    const sandbox = fakeSandbox({
      process: {
        createSession: vi.fn(async () => undefined),
        executeSessionCommand: vi.fn(async (_sessionId: string, request: { readonly command: string }) => {
          if (request.command.includes('git rev-parse HEAD')) {
            return { exitCode: 0, stdout: repositoryBaseSha, stderr: '' }
          }
          throw new Error('command failed')
        }),
        deleteSession: vi.fn(async () => undefined),
      },
    })
    const client = fakeClient(sandbox)

    return Effect.gen(function* () {
      const service = yield* SandboxService
      const exit = yield* service.runRepositoryCommand(commandInput).pipe(Effect.exit)

      expect(Exit.isFailure(exit)).toBe(true)
      expect(sandbox.process.deleteSession).toHaveBeenCalledWith('patchplane-trace-1')
      expect(client.delete).toHaveBeenCalledWith(sandbox, 120)
    }).pipe(Effect.provide(testLayer(client)))
  })

  it.effect('records non-zero command exits and still deletes sandbox', () => {
    const sandbox = fakeSandbox({
      process: {
        createSession: vi.fn(async () => undefined),
        executeSessionCommand: vi.fn(async (_sessionId: string, request: { readonly command: string }) =>
          request.command.includes('git rev-parse HEAD')
            ? { exitCode: 0, stdout: repositoryBaseSha, stderr: '' }
            : { exitCode: 42, stdout: 'out', stderr: 'err' }),
        deleteSession: vi.fn(async () => undefined),
      },
    })
    const client = fakeClient(sandbox)

    return Effect.gen(function* () {
      const service = yield* SandboxService
      const result = yield* service.runRepositoryCommand(commandInput)

      expect(result.exitCode).toBe(42)
      expect(result.stdout).toBe('out')
      expect(result.stderr).toBe('err')
      expect(client.delete).toHaveBeenCalledWith(sandbox, 120)
    }).pipe(Effect.provide(testLayer(client)))
  })

  it.effect('collects diff, test report, and screenshot evidence before deleting the sandbox', () => {
    const executeSessionCommand = vi.fn(async (_sessionId: string, request: { readonly command: string }) => {
      if (request.command.includes('git rev-parse HEAD')) {
        return { exitCode: 0, stdout: repositoryBaseSha, stderr: '' }
      }
      if (request.command.includes('bun test')) {
        return { exitCode: 0, stdout: 'ok', stderr: '' }
      }
      if (request.command.includes('git diff --binary')) {
        return { exitCode: 0, stdout: 'diff --git a/file.ts b/file.ts\n+changed\n', stderr: '' }
      }
      if (request.command.includes('make-report')) {
        return { exitCode: 0, stdout: '', stderr: '' }
      }
      if (request.command.includes('PATCHPLANE_ARTIFACT_BODY') && request.command.includes('test-report.json')) {
        return { exitCode: 0, stdout: '.patchplane/test-report.json\n---PATCHPLANE_ARTIFACT_BODY---\n{"ok":true}', stderr: '' }
      }
      if (request.command.includes('make-screenshot')) {
        return { exitCode: 0, stdout: '', stderr: '' }
      }
      if (request.command.includes('PATCHPLANE_ARTIFACT_BODY_BASE64')) {
        return { exitCode: 0, stdout: '.patchplane/browser-screenshot.png\n---PATCHPLANE_ARTIFACT_BODY_BASE64---\nAQID', stderr: '' }
      }
      return { exitCode: 0, stdout: '', stderr: '' }
    })
    const sandbox = fakeSandbox({
      process: {
        createSession: vi.fn(async () => undefined),
        executeSessionCommand,
        deleteSession: vi.fn(async () => undefined),
      },
    })
    const client = fakeClient(sandbox)

    return Effect.gen(function* () {
      const service = yield* SandboxService
      const result = yield* service.runRepositoryCommand({
        ...commandInput,
        evidenceTestReportCommand: 'make-report',
        evidenceBrowserScreenshotCommand: 'make-screenshot',
      })

      expect(result.evidenceArtifacts).toEqual([
        expect.objectContaining({
          kind: 'diff',
          label: 'Candidate patch diff',
          contentType: 'text/x-diff',
          body: expect.stringContaining('diff --git'),
        }),
        expect.objectContaining({
          kind: 'test-report',
          label: 'Test report',
          contentType: 'application/json',
          body: '{"ok":true}',
        }),
        expect.objectContaining({
          kind: 'screenshot',
          label: 'Browser verification screenshot',
          contentType: 'image/png',
          body: Uint8Array.from([1, 2, 3]),
        }),
      ])
      expect(result.baseSha).toBe(repositoryBaseSha)
      expect(result.verificationResults).toEqual([
        expect.objectContaining({ kind: 'test', status: 'succeeded', exitCode: 0 }),
        expect.objectContaining({ kind: 'browser', status: 'succeeded', exitCode: 0 }),
      ])
      expect(executeSessionCommand).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ command: expect.stringContaining(`git diff --binary --no-ext-diff '${repositoryBaseSha}' -- .`) }),
        expect.any(Number),
      )
      expect(client.delete).toHaveBeenCalledWith(sandbox, 120)
    }).pipe(Effect.provide(testLayer(client)))
  })

  it.effect('reports failed configured verification commands', () => {
    const sandbox = fakeSandbox({
      process: {
        createSession: vi.fn(async () => undefined),
        executeSessionCommand: vi.fn(async (_sessionId: string, request: { readonly command: string }) => {
          if (request.command.includes('git rev-parse HEAD')) {
            return { exitCode: 0, stdout: repositoryBaseSha, stderr: '' }
          }
          if (request.command.includes('make-report')) {
            return { exitCode: 2, stdout: '', stderr: 'tests failed' }
          }
          return { exitCode: 0, stdout: '', stderr: '' }
        }),
        deleteSession: vi.fn(async () => undefined),
      },
    })
    const client = fakeClient(sandbox)

    return Effect.gen(function* () {
      const service = yield* SandboxService
      const result = yield* service.runRepositoryCommand({
        ...commandInput,
        evidenceTestReportCommand: 'make-report',
      })

      expect(result.verificationResults).toEqual([
        expect.objectContaining({
          kind: 'test',
          status: 'failed',
          exitCode: 2,
          message: 'Test verification command failed with exit 2.',
        }),
      ])
    }).pipe(Effect.provide(testLayer(client)))
  })

  it.effect('runs Pi in JSON mode and returns normalized runtime events', () => {
    const stdout = [
      JSON.stringify({ type: 'agent_start' }),
      JSON.stringify({ type: 'tool_execution_start', toolName: 'bash' }),
    ].join('\n')
    const sandbox = fakeSandbox({
      process: {
        createSession: vi.fn(async () => undefined),
        executeSessionCommand: vi.fn(async (_sessionId: string, request: { readonly command: string }) =>
          request.command.includes('git rev-parse HEAD')
            ? { exitCode: 0, stdout: repositoryBaseSha, stderr: '' }
            : { exitCode: 0, stdout, stderr: '' }),
        deleteSession: vi.fn(async () => undefined),
      },
    })
    const client = fakeClient(sandbox)

    return Effect.gen(function* () {
      const service = yield* SandboxService
      const result = yield* service.runRepositoryAgent({
        traceId: 'trace-1',
        repositoryUrl: 'https://github.com/okikeSolutions/guerillaglass.git',
        repositoryFullName: 'okikeSolutions/guerillaglass',
        prompt: 'review patch',
        provider: 'openai',
        model: 'gpt-5.5',
      })

      expect(result.command).toContain("'--mode' 'json'")
      expect(result.command).toContain('<prompt redacted>')
      expect(result.runtimeEvents).toEqual([
        expect.objectContaining({ provider: 'pi', type: 'pi.agent_start', summary: 'Pi agent started' }),
        expect.objectContaining({ provider: 'pi', type: 'pi.tool_execution_start', summary: 'Pi tool started: bash' }),
      ])
      expect(client.create).toHaveBeenCalledWith(
        expect.objectContaining({ envVars: { OPENAI_API_KEY: 'openai-key' } }),
        expect.anything(),
      )
    }).pipe(Effect.provide(
      Layer.merge(
        testLayer(client),
        ConfigProvider.layer(ConfigProvider.fromEnv({
          env: { DAYTONA_API_KEY: 'daytona-key', OPENAI_API_KEY: 'openai-key' },
        })),
      ),
    ))
  })

  it.effect('deletes sandbox when repository command is interrupted', () =>
    Effect.promise(async () => {
      const sandbox = fakeSandbox({
        process: {
          createSession: vi.fn(async () => undefined),
          executeSessionCommand: vi.fn((): Promise<{ exitCode: number; stdout: string; stderr: string }> =>
            new Promise((resolve) => {
              setTimeout(() => resolve({ exitCode: 0, stdout: 'late', stderr: '' }), 50)
            })
          ),
          deleteSession: vi.fn(async () => undefined),
        },
      })
      const client = fakeClient(sandbox)
      const program = Effect.gen(function* () {
        const service = yield* SandboxService
        return yield* service.runRepositoryCommand(commandInput)
      }).pipe(Effect.provide(testLayer(client)))
      const fiber = Effect.runFork(program)

      await Effect.runPromise(Fiber.interrupt(fiber))

      expect(client.delete).toHaveBeenCalledWith(sandbox, 120)
    }),
  )

  it.effect('retains sandbox instead of deleting when retain mode is enabled', () => {
    const sandbox = fakeSandbox()
    const client = fakeClient(sandbox)

    return Effect.gen(function* () {
      const service = yield* SandboxService
      yield* service.runRepositoryCommand(commandInput)

      expect(client.delete).not.toHaveBeenCalled()
      expect(client[Symbol.asyncDispose]).toHaveBeenCalled()
    }).pipe(Effect.provide(testLayer(client, { DAYTONA_RETAIN_SANDBOXES: 'true' })))
  })

  it.effect('retries Daytona sandbox deletion before giving up', () => {
    const sandbox = fakeSandbox()
    const deleteSandbox = vi.fn()
      .mockRejectedValueOnce(new Error('delete failed 1'))
      .mockRejectedValueOnce(new Error('delete failed 2'))
      .mockResolvedValueOnce(undefined)
    const client = fakeClient(sandbox, { delete: deleteSandbox })

    return Effect.gen(function* () {
      const service = yield* SandboxService
      yield* service.runRepositoryCommand(commandInput)

      expect(deleteSandbox).toHaveBeenCalledTimes(3)
    }).pipe(Effect.provide(testLayer(client)))
  })

  it.effect('uses Daytona session execution so stdout and stderr are captured', () =>
    Effect.promise(async () => {
      const createSession = vi.fn(async () => undefined)
      const executeSessionCommand = vi.fn(async () => ({
        exitCode: 1,
        stdout: 'out',
        stderr: 'err',
      }))
      const deleteSession = vi.fn(async () => undefined)
      const sandbox = { process: { createSession, executeSessionCommand, deleteSession } }

      const result = await Effect.runPromise(executeSandboxCommand(sandbox, {
        command: 'bun test',
        env: { NODE_ENV: 'test' },
        timeoutSeconds: 7,
        traceId: 'trace-1',
      }))

      expect(createSession).toHaveBeenCalledWith('patchplane-trace-1')
      expect(executeSessionCommand).toHaveBeenCalledWith(
        'patchplane-trace-1',
        {
          command: "cd 'workspace/repo' && NODE_ENV='test' bun test",
          runAsync: false,
          suppressInputEcho: true,
        },
        7,
      )
      expect(deleteSession).toHaveBeenCalledWith('patchplane-trace-1')
      expect(result).toEqual({ exitCode: 1, stdout: 'out', stderr: 'err' })
    }),
  )

  it.effect('rejects unsafe Daytona command environment variable names', () =>
    Effect.promise(async () => {
      const createSession = vi.fn(async () => undefined)
      const executeSessionCommand = vi.fn(async () => ({ exitCode: 0, stdout: '', stderr: '' }))
      const deleteSession = vi.fn(async () => undefined)
      const sandbox = { process: { createSession, executeSessionCommand, deleteSession } }

      await expect(Effect.runPromise(executeSandboxCommand(sandbox, {
        command: 'bun test',
        env: { 'BAD; echo pwned': 'value' },
        timeoutSeconds: 7,
        traceId: 'trace-1',
      }))).rejects.toThrow('Daytona command could not be formatted safely')

      expect(executeSessionCommand).not.toHaveBeenCalled()
      expect(deleteSession).toHaveBeenCalledWith('patchplane-trace-1')
    }),
  )

  it.effect('constructs a quoted untrusted Pi-in-Daytona command', () =>
    Effect.sync(() => {
      const command = renderShellCommand(buildPiCommandSpec({
        provider: 'openai',
        model: 'gpt-5.5',
        prompt: "review Bob's patch",
        version: '0.79.6',
        thinking: 'low',
      }))

      expect(command).toContain('@earendil-works/pi-coding-agent@0.79.6')
      expect(command).toContain("'--mode' 'json'")
      expect(command.split(' ')).toContain("'--no-approve'")
      expect(command.split(' ')).not.toContain("'--approve'")
      expect(command).toContain("'--provider' 'openai'")
      expect(command).toContain("'--model' 'gpt-5.5'")
      expect(command).toContain("'--thinking' 'low'")
      expect(command).toContain("'review Bob'\"'\"'s patch'")
    }),
  )

  it.effect('redacts prompts from persisted Pi command', () =>
    Effect.sync(() => {
      const command = renderShellCommand(buildRedactedPiCommandSpec({
        provider: 'openai',
        model: 'gpt-5.5',
        version: '0.79.6',
        thinking: 'medium',
      }))

      expect(command).toContain("'--thinking' 'medium'")
      expect(command).toContain('<prompt redacted>')
      expect(command).not.toContain('review')
    }),
  )

  it.effect('parses Pi JSON output into normalized runtime events', () =>
    Effect.gen(function* () {
      const output = [
        JSON.stringify({ type: 'session', id: 'session-1', timestamp: '2026-06-28T00:00:00.000Z' }),
        JSON.stringify({ type: 'tool_execution_start', toolName: 'bash' }),
        JSON.stringify({ type: 'message_end', message: { content: [{ text: 'All checks passed.' }] } }),
        'not-json',
      ].join('\n')
      const parsed = yield* parsePiJsonRuntimeEventsEffect(output, { now: () => 123 })

      expect(parsed.events).toEqual([
        expect.objectContaining({
          provider: 'pi',
          type: 'pi.session',
          occurredAt: 1782604800000,
          summary: 'Pi session session-1',
        }),
        expect.objectContaining({
          provider: 'pi',
          type: 'pi.tool_execution_start',
          occurredAt: 123,
          summary: 'Pi tool started: bash',
        }),
        expect.objectContaining({
          provider: 'pi',
          type: 'pi.message_end',
          occurredAt: 123,
          summary: 'Pi message: All checks passed.',
        }),
      ])
      expect(parsed.parseErrors).toHaveLength(1)
    }),
  )

  it.effect('treats missing runtime session during hard terminate as already terminated', () => {
    const sandbox = fakeSandbox({
      process: {
        createSession: vi.fn(async () => undefined),
        executeSessionCommand: vi.fn(async () => ({ exitCode: 0, stdout: '', stderr: '' })),
        deleteSession: vi.fn(async () => { throw new Error('404 not found') }),
      },
    })
    const client = fakeClient(sandbox, { get: vi.fn(async () => sandbox) })

    return Effect.gen(function* () {
      const service = yield* SandboxService
      const result = yield* service.terminateRuntimeSession({
        sandboxId: 'sandbox-1',
        sessionId: 'session-1',
        commandId: 'cmd-1',
        traceId: 'trace-1',
      })

      expect(result.status).toBe('terminated')
      expect(sandbox.process.deleteSession).toHaveBeenCalledWith('session-1')
      expect(client[Symbol.asyncDispose]).toHaveBeenCalled()
    }).pipe(Effect.provide(testLayer(client)))
  })

  it.effect('wraps Daytona streaming log callbacks as an Effect stream', () =>
    Effect.gen(function* () {
      const sandbox: DaytonaCommandSandbox = {
        process: {
          createSession: vi.fn(async () => undefined),
          executeSessionCommand: vi.fn(async () => ({ cmdId: 'cmd-1' })),
          getSessionCommandLogs: streamingLogsFixture,
          deleteSession: vi.fn(async () => undefined),
        },
      }

      const chunks = yield* streamSandboxSessionCommandLogs(sandbox, 'session-1', 'cmd-1').pipe(Stream.runCollect)
      expect(Array.from(chunks)).toEqual([
        { stream: 'stdout', chunk: '{"type":"agent_' },
        { stream: 'stderr', chunk: 'warning' },
        { stream: 'stdout', chunk: 'start"}\n' },
      ])
    }),
  )

  it.effect('starts an async Daytona session command handle', () =>
    Effect.gen(function* () {
      const createSession = vi.fn(async () => undefined)
      const executeSessionCommand = vi.fn(async () => ({ cmdId: 'cmd-1' }))
      const sendSessionCommandInput = vi.fn(async () => undefined)
      const getSessionCommand = vi.fn(async () => ({ exitCode: undefined }))
      const getSessionCommandLogsSpy = vi.fn(async (_sessionId: string, _commandId: string) => ({ stdout: '{"type":"agent_start"}\n', stderr: '' }))
      function getSessionCommandLogs(sessionId: string, commandId: string): Promise<{ readonly stdout: string; readonly stderr: string }>
      function getSessionCommandLogs(sessionId: string, commandId: string, onStdout: (chunk: string) => void, onStderr: (chunk: string) => void): Promise<void>
      function getSessionCommandLogs(sessionId: string, commandId: string, onStdout?: (chunk: string) => void, onStderr?: (chunk: string) => void) {
        if (onStdout !== undefined && onStderr !== undefined) return Promise.resolve()
        return getSessionCommandLogsSpy(sessionId, commandId)
      }
      const deleteSession = vi.fn(async () => undefined)
      const sandbox: DaytonaCommandSandbox = { process: { createSession, executeSessionCommand, sendSessionCommandInput, getSessionCommand, getSessionCommandLogs, deleteSession } }

      const handle = yield* startSandboxSessionCommand(sandbox, {
        command: 'pi --mode rpc',
        timeoutSeconds: 9,
        traceId: 'trace-1',
      })
      yield* handle.sendInput('{"type":"get_state"}\n')
      const command = yield* handle.getCommand()
      const logs = yield* handle.getLogs()
      yield* handle.deleteSession()

      expect(handle.sessionId).toBe('patchplane-trace-1')
      expect(handle.commandId).toBe('cmd-1')
      expect(executeSessionCommand).toHaveBeenCalledWith(
        'patchplane-trace-1',
        {
          command: "cd 'workspace/repo' && pi --mode rpc",
          runAsync: true,
          suppressInputEcho: true,
        },
        9,
      )
      expect(sendSessionCommandInput).toHaveBeenCalledWith('patchplane-trace-1', 'cmd-1', '{"type":"get_state"}\n')
      expect(command).toEqual({ exitCode: undefined })
      expect(logs).toEqual({ stdout: '{"type":"agent_start"}\n', stderr: '' })
      expect(deleteSession).toHaveBeenCalledWith('patchplane-trace-1')
    }),
  )

  it.effect('fails async Daytona session startup when command id is missing', () =>
    Effect.gen(function* () {
      const sandbox = {
        process: {
          createSession: vi.fn(async () => undefined),
          executeSessionCommand: vi.fn(async () => ({})),
          deleteSession: vi.fn(async () => undefined),
        },
      }

      const exit = yield* startSandboxSessionCommand(sandbox, {
        command: 'pi --mode rpc',
        timeoutSeconds: 9,
        traceId: 'trace-1',
      }).pipe(Effect.exit)

      expect(Exit.isFailure(exit)).toBe(true)
    }),
  )

  it.effect('maps provider API keys from Effect Config to Pi environment variables', () =>
    Effect.gen(function* () {
      const anthropic = yield* piRuntimeEnvironment({ provider: 'anthropic' }).pipe(
        Effect.provide(ConfigProvider.layer(ConfigProvider.fromEnv({ env: { ANTHROPIC_API_KEY: 'key' } }))),
      )
      expect(anthropic).toEqual({ ANTHROPIC_API_KEY: 'key' })

      const copilot = yield* piRuntimeEnvironment({ provider: 'github-copilot' }).pipe(
        Effect.provide(ConfigProvider.layer(ConfigProvider.fromEnv({ env: { COPILOT_GITHUB_TOKEN: 'key' } }))),
      )
      expect(copilot).toEqual({ COPILOT_GITHUB_TOKEN: 'key' })

      const cloudflare = yield* piRuntimeEnvironment({ provider: 'cloudflare-ai-gateway' }).pipe(
        Effect.provide(ConfigProvider.layer(ConfigProvider.fromEnv({
          env: {
            CLOUDFLARE_API_KEY: 'key',
            CLOUDFLARE_ACCOUNT_ID: 'acct',
            CLOUDFLARE_GATEWAY_ID: 'gateway',
          },
        }))),
      )
      expect(cloudflare).toEqual({
        CLOUDFLARE_API_KEY: 'key',
        CLOUDFLARE_ACCOUNT_ID: 'acct',
        CLOUDFLARE_GATEWAY_ID: 'gateway',
      })

      const missingOpenAi = yield* piRuntimeEnvironment({ provider: 'openai' }).pipe(
        Effect.provide(ConfigProvider.layer(ConfigProvider.fromEnv({ env: {} }))),
        Effect.exit,
      )
      expect(Exit.isFailure(missingOpenAi)).toBe(true)
    }),
  )
})
