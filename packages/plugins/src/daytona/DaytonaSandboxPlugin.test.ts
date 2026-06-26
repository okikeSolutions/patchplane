import { describe, expect, it } from '@effect/vitest'
import { vi } from 'vitest'
import { Effect, Option, Redacted } from 'effect'
import type { DaytonaConfig } from './DaytonaConfig'
import { toDaytonaCreateSandboxParams, toSandboxPolicy } from './daytona-adapter'
import { executeSandboxCommand } from './daytona-process'
import { buildPiCommand, buildRedactedPiCommand } from './pi-command'
import { piProviderApiKeyEnv } from './pi-provider-env'

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
      const command = buildPiCommand({
        provider: 'openai',
        model: 'gpt-5.5',
        prompt: "review Bob's patch",
        version: '0.79.6',
        thinking: 'low',
      })

      expect(command).toContain('@earendil-works/pi-coding-agent@0.79.6')
      expect(command.split(' ')).toContain('--no-approve')
      expect(command.split(' ')).not.toContain('--approve')
      expect(command).toContain("--provider 'openai'")
      expect(command).toContain("--model 'gpt-5.5'")
      expect(command).toContain("--thinking 'low'")
      expect(command).toContain("'review Bob'\"'\"'s patch'")
    }),
  )

  it.effect('redacts prompts from persisted Pi command', () =>
    Effect.sync(() => {
      const command = buildRedactedPiCommand({
        provider: 'openai',
        model: 'gpt-5.5',
        version: '0.79.6',
        thinking: 'medium',
      })

      expect(command).toContain("--thinking 'medium'")
      expect(command).toContain('<prompt redacted>')
      expect(command).not.toContain('review')
    }),
  )

  it.effect('maps provider API keys to Pi environment variables', () =>
    Effect.sync(() => {
      expect(piProviderApiKeyEnv('anthropic', 'key')).toEqual({
        ANTHROPIC_API_KEY: 'key',
      })
      expect(piProviderApiKeyEnv('github-copilot', 'key')).toEqual({
        COPILOT_GITHUB_TOKEN: 'key',
      })
      expect(piProviderApiKeyEnv('openai', undefined)).toBeUndefined()
    }),
  )
})
