'use node'

import { Effect } from 'effect'
import { internal } from './_generated/api'
import type { Id } from './_generated/dataModel'
import { internalAction, type ActionCtx } from './_generated/server'
import { v } from 'convex/values'
import type {
  GitHubAppAuth,
  RuntimeAdapter,
  RuntimeEventInput,
  RuntimeSessionStatus,
  SandboxAdapter,
  WorkflowRunStatus,
} from '@patchplane/domain'
import {
  GitHubAppAuthService,
  RuntimeAdapterService,
  SandboxAdapterService,
} from '@patchplane/domain'
import type { BackendConfigShape } from '../src/config/schema'
import { BackendConfig } from '../src/config/schema'
import { ExecutionBoundaryLive } from '../src/execution/layers'

type WorkflowExecutionResult = {
  readonly status: string
  readonly eventCount: number
}

interface WorkflowExecutionClaim {
  readonly promptRequestId: Id<'promptRequests'>
  readonly runtimeSessionId: Id<'runtimeSessions'>
  readonly startedAt: number
}

interface WorkflowExecutionInput {
  readonly workflowRunId: Id<'workflowRuns'>
  readonly promptRequestId: Id<'promptRequests'>
  readonly prompt: string
  readonly scope: {
    readonly repoUrl: string
    readonly baseBranch: string
    readonly targetBranch: string
    readonly includePaths: readonly string[]
    readonly excludePaths: readonly string[]
    readonly intent: string
  }
  readonly runtimeSession: {
    readonly id: Id<'runtimeSessions'>
    readonly workflowRunId: Id<'workflowRuns'>
    readonly externalSessionId?: string
    readonly sandboxProvider: string
    readonly runtimeProvider: string
    readonly status: RuntimeSessionStatus
    readonly createdAt: number
    readonly updatedAt: number
    readonly startedAt?: number
    readonly endedAt?: number
  }
  readonly githubInstallationExternalId?: number
  readonly workflowStatus: WorkflowRunStatus
  readonly sandboxProvider: string
  readonly runtimeProvider: string
}

interface ExecutionServices {
  readonly config: BackendConfigShape
  readonly auth: GitHubAppAuth
  readonly runtime: RuntimeAdapter
  readonly sandbox: SandboxAdapter
}

function readErrorMessage(error: unknown) {
  return error instanceof Error
    ? error.message
    : 'Unknown workflow execution failure.'
}

function provideExecutionBoundary<A>(
  effect: Effect.Effect<A, unknown, unknown>,
): Effect.Effect<A, unknown, never> {
  return Effect.provide(effect, ExecutionBoundaryLive) as Effect.Effect<
    A,
    unknown,
    never
  >
}

function runExecutionBoundary<A>(effect: Effect.Effect<A, unknown, never>) {
  return Effect.runPromise(effect)
}

async function resolveExecutionServices(): Promise<ExecutionServices> {
  return runExecutionBoundary(
    provideExecutionBoundary(
      Effect.all({
        config: BackendConfig,
        auth: GitHubAppAuthService,
        runtime: RuntimeAdapterService,
        sandbox: SandboxAdapterService,
      }),
    ),
  )
}

function readForwardedEnvironment(
  envKeys: ReadonlyArray<string>,
): Record<string, string> {
  return Object.fromEntries(
    envKeys.flatMap((envKey) => {
      const value = process.env[envKey]
      return value ? [[envKey, value]] : []
    }),
  )
}

function buildRuntimeEvents(
  claim: WorkflowExecutionClaim,
  workflowRunId: Id<'workflowRuns'>,
  externalSessionId: string,
  startedAt: number,
  normalizedEvents: ReadonlyArray<RuntimeEventInput>,
): Array<{
  requestId: Id<'promptRequests'>
  workflowRunId: Id<'workflowRuns'>
  runtimeSessionId: Id<'runtimeSessions'>
  type: RuntimeEventInput['type']
  message: string
  createdAt: number
}> {
  return [
    {
      requestId: claim.promptRequestId,
      workflowRunId,
      runtimeSessionId: claim.runtimeSessionId,
      type: 'session.created',
      message: 'Runtime session created.',
      createdAt: claim.startedAt,
    },
    {
      requestId: claim.promptRequestId,
      workflowRunId,
      runtimeSessionId: claim.runtimeSessionId,
      type: 'session.started',
      message: `Execution started in ${externalSessionId}.`,
      createdAt: startedAt,
    },
    ...normalizedEvents.map((event) => ({
      requestId: claim.promptRequestId,
      workflowRunId,
      runtimeSessionId: claim.runtimeSessionId,
      type: event.type,
      message: event.message,
      createdAt: event.createdAt,
    })),
  ]
}

async function failWorkflowRun(
  ctx: ActionCtx,
  workflowRunId: Id<'workflowRuns'>,
  runtimeSessionId: Id<'runtimeSessions'>,
  errorMessage: string,
) {
  await ctx.runMutation(internal.workflows.failWorkflowRunExecution, {
    workflowRunId,
    runtimeSessionId,
    failedAt: Date.now(),
    errorMessage,
  })
}

async function executeWorkflowRunHandler(
  ctx: ActionCtx,
  workflowRunId: Id<'workflowRuns'>,
): Promise<WorkflowExecutionResult> {
  const services = await resolveExecutionServices()
  const claim = await ctx.runMutation(internal.workflows.beginWorkflowRunExecution, {
    workflowRunId,
  }) as WorkflowExecutionClaim | null

  if (!claim) {
    return {
      status: 'skipped',
      eventCount: 0,
    }
  }

  const input = await ctx.runQuery(internal.workflows.getWorkflowRunExecutionInput, {
    workflowRunId,
    runtimeSessionId: claim.runtimeSessionId,
  }) as WorkflowExecutionInput | null

  if (!input) {
    await failWorkflowRun(
      ctx,
      workflowRunId,
      claim.runtimeSessionId,
      'Missing workflow execution input after claiming the run.',
    )

    return {
      status: 'failed',
      eventCount: 0,
    }
  }

  try {
    const gitCredentials = input.githubInstallationExternalId
      ? await runExecutionBoundary(
          provideExecutionBoundary(
            Effect.map(
              services.auth.getInstallationToken(
                input.githubInstallationExternalId,
              ),
              (token) => ({
                username: 'x-access-token',
                password: token.token,
              }),
            ),
          ),
        )
      : undefined

    const startedAt = Date.now()
    const executionResult = await runExecutionBoundary(
      provideExecutionBoundary(
        services.sandbox.execute(
          {
            promptRequestId: String(claim.promptRequestId),
            session: {
              ...input.runtimeSession,
              id: String(input.runtimeSession.id),
              workflowRunId: String(input.runtimeSession.workflowRunId),
            },
            prompt: input.prompt,
            repoUrl: input.scope.repoUrl,
            baseBranch: input.scope.baseBranch,
            targetBranch: input.scope.targetBranch,
            workingDirectory: `workspace/${String(workflowRunId)}`,
            env: readForwardedEnvironment(services.config.runtime.envForwardKeys),
            gitCredentials,
          },
          services.runtime,
        ),
      ),
    )

    await ctx.runMutation(internal.workflows.markWorkflowRunRunning, {
      workflowRunId,
      runtimeSessionId: claim.runtimeSessionId,
      externalSessionId: executionResult.externalSessionId,
      startedAt,
    })

    const events = buildRuntimeEvents(
      claim,
      workflowRunId,
      executionResult.externalSessionId,
      startedAt,
      executionResult.events,
    )

    if (events.length > 0) {
      await ctx.runMutation(internal.workflows.appendRuntimeEvents, {
        events,
      })
    }

    const lastEvent = executionResult.events.at(-1)
    const failed =
      lastEvent?.type === 'session.failed' || lastEvent?.type === 'turn.failed'

    if (failed) {
      await failWorkflowRun(
        ctx,
        workflowRunId,
        claim.runtimeSessionId,
        lastEvent?.message ?? 'Runtime execution failed.',
      )

      return {
        status: 'failed',
        eventCount: events.length,
      }
    }

    await ctx.runMutation(internal.workflows.completeWorkflowRunExecution, {
      workflowRunId,
      runtimeSessionId: claim.runtimeSessionId,
      completedAt: Date.now(),
    })

    return {
      status: 'completed',
      eventCount: events.length,
    }
  } catch (error) {
    await failWorkflowRun(
      ctx,
      workflowRunId,
      claim.runtimeSessionId,
      readErrorMessage(error),
    )

    return {
      status: 'failed',
      eventCount: 0,
    }
  }
}

export const executeWorkflowRun = internalAction({
  args: {
    workflowRunId: v.id('workflowRuns'),
  },
  returns: v.object({
    status: v.string(),
    eventCount: v.number(),
  }),
  handler: (ctx, args) => executeWorkflowRunHandler(ctx, args.workflowRunId),
})
