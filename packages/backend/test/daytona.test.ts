import { describe, expect, test } from 'bun:test'
import { Effect } from 'effect'
import {
  BoundaryFailure,
  type RuntimeAdapter,
  type SandboxExecutionRequest,
} from '@patchplane/domain'
import { DaytonaSandboxAdapter } from '../src/sandbox/daytona'

function createSandboxExecutionRequest(): SandboxExecutionRequest {
  return {
    promptRequestId: 'request-1',
    session: {
      id: 'session-1',
      workflowRunId: 'workflow-1',
      sandboxProvider: 'daytona',
      runtimeProvider: 'pi-mono',
      status: 'queued',
      createdAt: 1,
      updatedAt: 1,
    },
    prompt: 'Run the workflow',
    repoUrl: 'https://github.com/acme/repo.git',
    baseBranch: 'main',
    targetBranch: 'patchplane/test',
    workingDirectory: 'workspace/workflow-1',
    env: {
      OPENAI_API_KEY: 'test-key',
    },
  }
}

describe('DaytonaSandboxAdapter', () => {
  test('preserves runtime planning failures without creating a sandbox', async () => {
    let createCalls = 0
    const adapter = new DaytonaSandboxAdapter(
      {
        timeoutMs: 30_000,
        autoStopIntervalMinutes: 15,
        ephemeral: true,
      },
      () => ({
        create: async () => {
          createCalls += 1
          throw new Error('sandbox should not be created')
        },
      }),
    )
    const runtime: RuntimeAdapter = {
      name: 'failing-runtime',
      createExecutionPlan: () =>
        Effect.fail(
          new BoundaryFailure({
            boundary: 'runtime.pi-mono',
            message: 'Failed to build execution plan.',
            retryable: false,
          }),
        ),
      normalizeOutput: () => Effect.succeed([]),
    }

    const result = await Effect.runPromise(
      Effect.either(adapter.execute(createSandboxExecutionRequest(), runtime)),
    )

    expect(result._tag).toBe('Left')
    if (result._tag !== 'Left') {
      throw new Error('Expected runtime planning failure.')
    }

    expect(result.left.boundary).toBe('runtime.pi-mono')
    expect(createCalls).toBe(0)
  })

  test('preserves runtime normalization failures and still cleans up the sandbox', async () => {
    const cleanup = {
      deletedSession: 0,
      deletedSandbox: 0,
      stoppedSandbox: 0,
    }
    const adapter = new DaytonaSandboxAdapter(
      {
        timeoutMs: 30_000,
        autoStopIntervalMinutes: 15,
        ephemeral: true,
      },
      () => ({
        create: async () => ({
          id: 'sandbox-1',
          git: {
            clone: async () => undefined,
          },
          process: {
            executeCommand: async () => undefined,
            createSession: async () => undefined,
            executeSessionCommand: async () => ({
              exitCode: 0,
              stdout: 'ok',
              stderr: '',
            }),
            deleteSession: async () => {
              cleanup.deletedSession += 1
            },
          },
          delete: async () => {
            cleanup.deletedSandbox += 1
          },
          stop: async () => {
            cleanup.stoppedSandbox += 1
          },
        }),
      }),
    )
    const runtime: RuntimeAdapter = {
      name: 'failing-runtime',
      createExecutionPlan: () =>
        Effect.succeed({
          command: 'echo ok',
          workingDirectory: 'workspace/workflow-1',
          env: {},
        }),
      normalizeOutput: () =>
        Effect.fail(
          new BoundaryFailure({
            boundary: 'runtime.pi-mono',
            message: 'Failed to normalize runtime output.',
            retryable: false,
          }),
        ),
    }

    const result = await Effect.runPromise(
      Effect.either(adapter.execute(createSandboxExecutionRequest(), runtime)),
    )

    expect(result._tag).toBe('Left')
    if (result._tag !== 'Left') {
      throw new Error('Expected runtime normalization failure.')
    }

    expect(result.left.boundary).toBe('runtime.pi-mono')
    expect(cleanup.deletedSession).toBe(1)
    expect(cleanup.deletedSandbox).toBe(1)
    expect(cleanup.stoppedSandbox).toBe(0)
  })
})
