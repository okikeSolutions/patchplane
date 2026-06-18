import { describe, expect, it } from '@effect/vitest'
import { vi } from 'vitest'
import { Effect, Option, Redacted } from 'effect'
import type { DaytonaConfig } from './DaytonaConfig'
import { toDaytonaCreateSandboxParams } from './daytona-adapter'
import { executeSandboxCommand } from './daytona-process'
import { buildPiCommand, buildRedactedPiCommand } from './pi-command'
import { piProviderApiKeyEnv } from './pi-provider-env'

function config(overrides: Partial<DaytonaConfig> = {}): DaytonaConfig {
  return {
    apiKey: Redacted.make('daytona-key'),
    apiUrl: Option.none(),
    target: Option.none(),
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

  it.effect('uses Daytona process execution with the command timeout in the request body', () =>
    Effect.promise(async () => {
      const executeCommand = vi.fn(async () => ({
        exitCode: 0,
        result: 'ok',
        artifacts: { stdout: 'ok' },
      }))
      const sandbox = { process: { executeCommand } }

      const result = await executeSandboxCommand(sandbox, {
        command: 'bun test',
        env: { NODE_ENV: 'test' },
        timeoutSeconds: 7,
        traceId: 'trace-1',
      })

      expect(executeCommand).toHaveBeenCalledWith(
        'bun test',
        'workspace/repo',
        { NODE_ENV: 'test' },
        7,
      )
      expect(result).toEqual({ exitCode: 0, stdout: 'ok', stderr: undefined })
    }),
  )

  it.effect('constructs a quoted untrusted Pi-in-Daytona command', () =>
    Effect.sync(() => {
      const command = buildPiCommand({
        provider: 'openai',
        model: 'gpt-5.5',
        prompt: "review Bob's patch",
        version: '0.79.6',
      })

      expect(command).toContain('@earendil-works/pi-coding-agent@0.79.6')
      expect(command.split(' ')).toContain('--no-approve')
      expect(command.split(' ')).not.toContain('--approve')
      expect(command).toContain("--provider 'openai'")
      expect(command).toContain("--model 'gpt-5.5'")
      expect(command).toContain("'review Bob'\"'\"'s patch'")
    }),
  )

  it.effect('redacts prompts from persisted Pi command', () =>
    Effect.sync(() => {
      const command = buildRedactedPiCommand({
        provider: 'openai',
        model: 'gpt-5.5',
        version: '0.79.6',
      })

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
