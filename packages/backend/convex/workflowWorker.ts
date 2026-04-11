'use node'

import { Clock, Effect } from 'effect'
import { internal } from './_generated/api'
import type { Id } from './_generated/dataModel'
import { internalAction, type ActionCtx } from './_generated/server'
import { v } from 'convex/values'
import {
  type BoundaryFailure,
  type PolicyBundle,
  type RuntimeEventInput,
  type RuntimeProviderEventInput,
  type RuntimeSessionStatus,
  type WorkflowRunStatus,
} from '@patchplane/domain'
import {
  GitHubAppAuthService,
  PromptRequestId,
  RuntimeAdapterService,
  SandboxAdapterService,
  RuntimeSessionId,
  WorkflowRunId,
} from '@patchplane/domain'
import { BackendConfig } from '../src/config/schema'
import { tryConvexPromise } from '../src/effect/convex'
import {
  readErrorMessage,
  type BackendConfigFailure,
  type ConvexInteropFailure,
} from '../src/errors'
import { ExecutionBoundaryRuntime } from '../src/execution/runtime'
import { reviewRuntimeExecution } from '../src/policy/runtimeReview'

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
  readonly policyBundle: Pick<
    PolicyBundle,
    'id' | 'requiredReviewers' | 'minimumScore'
  >
  readonly githubInstallationExternalId?: number
  readonly workflowStatus: WorkflowRunStatus
  readonly sandboxProvider: string
  readonly runtimeProvider: string
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

function buildRuntimeProviderEvents(
  claim: WorkflowExecutionClaim,
  workflowRunId: Id<'workflowRuns'>,
  providerEvents: ReadonlyArray<RuntimeProviderEventInput>,
): Array<{
  requestId: Id<'promptRequests'>
  workflowRunId: Id<'workflowRuns'>
  runtimeSessionId: Id<'runtimeSessions'>
  provider: string
  eventType: string
  stream: RuntimeProviderEventInput['stream']
  sequence: number
  rawPayload: string
  providerTimestamp?: string
  createdAt: number
}> {
  return providerEvents.map((event) => ({
    requestId: claim.promptRequestId,
    workflowRunId,
    runtimeSessionId: claim.runtimeSessionId,
    provider: event.provider,
    eventType: event.eventType,
    stream: event.stream,
    sequence: event.sequence,
    rawPayload: event.rawPayload,
    providerTimestamp: event.providerTimestamp,
    createdAt: event.createdAt,
  }))
}

function failWorkflowRun(
  ctx: ActionCtx,
  workflowRunId: Id<'workflowRuns'>,
  runtimeSessionId: Id<'runtimeSessions'>,
  errorMessage: string,
): Effect.Effect<void, ConvexInteropFailure> {
  return Effect.gen(function* () {
    const failedAt = yield* Clock.currentTimeMillis

    yield* tryConvexPromise('mutation workflows.failWorkflowRunExecution', () =>
      ctx.runMutation(internal.workflows.failWorkflowRunExecution, {
        workflowRunId,
        runtimeSessionId,
        failedAt,
        errorMessage,
      }),
    )
  })
}

function executeWorkflowRunProgram(
  ctx: ActionCtx,
  workflowRunId: Id<'workflowRuns'>,
): Effect.Effect<
  WorkflowExecutionResult,
  BoundaryFailure | BackendConfigFailure | ConvexInteropFailure,
  | BackendConfig
  | GitHubAppAuthService
  | RuntimeAdapterService
  | SandboxAdapterService
> {
  return Effect.gen(function* () {
    const config = yield* BackendConfig
    const auth = yield* GitHubAppAuthService
    const runtime = yield* RuntimeAdapterService
    const sandbox = yield* SandboxAdapterService
    const claim = (yield* tryConvexPromise(
      'mutation workflows.beginWorkflowRunExecution',
      () =>
        ctx.runMutation(internal.workflows.beginWorkflowRunExecution, {
          workflowRunId,
        }),
    )) as WorkflowExecutionClaim | null

    if (!claim) {
      return {
        status: 'skipped',
        eventCount: 0,
      }
    }

    return yield* Effect.gen(function* () {
      const input = (yield* tryConvexPromise(
        'mutation workflows.getWorkflowRunExecutionInput',
        () =>
          ctx.runMutation(internal.workflows.getWorkflowRunExecutionInput, {
            workflowRunId,
            runtimeSessionId: claim.runtimeSessionId,
          }),
      )) as WorkflowExecutionInput | null

      if (!input) {
        yield* failWorkflowRun(
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

      const gitCredentials = input.githubInstallationExternalId
        ? yield* auth
            .getInstallationToken(input.githubInstallationExternalId)
            .pipe(
              Effect.map((token) => ({
                username: 'x-access-token',
                password: token.token,
              })),
            )
        : undefined

      const startedAt = yield* Clock.currentTimeMillis
      const executionResult = yield* sandbox.execute(
        {
          promptRequestId: PromptRequestId(String(claim.promptRequestId)),
          session: {
            ...input.runtimeSession,
            id: RuntimeSessionId(String(input.runtimeSession.id)),
            workflowRunId: WorkflowRunId(
              String(input.runtimeSession.workflowRunId),
            ),
          },
          prompt: input.prompt,
          repoUrl: input.scope.repoUrl,
          baseBranch: input.scope.baseBranch,
          targetBranch: input.scope.targetBranch,
          workingDirectory: `workspace/${String(workflowRunId)}`,
          env: readForwardedEnvironment(config.runtime.envForwardKeys),
          gitCredentials,
        },
        runtime,
      )

      yield* tryConvexPromise('mutation workflows.markWorkflowRunRunning', () =>
        ctx.runMutation(internal.workflows.markWorkflowRunRunning, {
          workflowRunId,
          runtimeSessionId: claim.runtimeSessionId,
          externalSessionId: executionResult.externalSessionId,
          startedAt,
        }),
      )

      const events = buildRuntimeEvents(
        claim,
        workflowRunId,
        executionResult.externalSessionId,
        startedAt,
        executionResult.events,
      )
      const providerEvents = buildRuntimeProviderEvents(
        claim,
        workflowRunId,
        executionResult.providerEvents,
      )

      if (providerEvents.length > 0 || events.length > 0) {
        yield* tryConvexPromise(
          'mutation workflows.appendRuntimeEventBatch',
          () =>
            ctx.runMutation(internal.workflows.appendRuntimeEventBatch, {
              providerEvents,
              events,
            }),
        )
      }

      const lastEvent = executionResult.events.at(-1)
      const failed =
        lastEvent?.type === 'session.failed' ||
        lastEvent?.type === 'turn.failed'

      const reviewedAt = yield* Clock.currentTimeMillis
      const reviewOutcome = yield* reviewRuntimeExecution({
        requestId: PromptRequestId(String(claim.promptRequestId)),
        policy: input.policyBundle,
        normalizedEvents: executionResult.events,
        providerEvents: executionResult.providerEvents,
      })

      if (failed) {
        yield* failWorkflowRun(
          ctx,
          workflowRunId,
          claim.runtimeSessionId,
          lastEvent?.message ?? 'Runtime execution failed.',
        )
      } else {
        yield* tryConvexPromise(
          'mutation workflows.completeWorkflowRunExecution',
          () =>
            ctx.runMutation(internal.workflows.completeWorkflowRunExecution, {
              workflowRunId,
              runtimeSessionId: claim.runtimeSessionId,
              completedAt: reviewedAt,
            }),
        )
      }

      yield* tryConvexPromise(
        'mutation workflows.recordWorkflowReviewOutcome',
        () =>
          ctx.runMutation(internal.workflows.recordWorkflowReviewOutcome, {
            workflowRunId,
            promptRequestId: claim.promptRequestId,
            runtimeSessionId: claim.runtimeSessionId,
            reviewRuns: reviewOutcome.reviewRuns.map((reviewRun) => ({
              reviewer: reviewRun.reviewer,
              score: reviewRun.score,
              passed: reviewRun.passed,
              summary: reviewRun.summary,
            })),
            pendingApproval: reviewOutcome.pendingApproval
              ? {
                  kind: reviewOutcome.pendingApproval.kind,
                  title: reviewOutcome.pendingApproval.title,
                  body: reviewOutcome.pendingApproval.body,
                  requestedByUserId:
                    reviewOutcome.pendingApproval.requestedByUserId,
                }
              : undefined,
            pendingInputs: reviewOutcome.pendingInputs.map((pendingInput) => ({
              kind: pendingInput.kind,
              prompt: pendingInput.prompt,
              requestedByUserId: pendingInput.requestedByUserId,
            })),
            mergeDecision: {
              status: reviewOutcome.mergeDecision.status,
              reasons: [...reviewOutcome.mergeDecision.reasons],
              decidedByUserId: reviewOutcome.mergeDecision.decidedByUserId,
            },
            reviewedAt,
            markWorkflowReviewed: !failed,
          }),
      )

      return {
        status: failed ? 'failed' : reviewOutcome.mergeDecision.status,
        eventCount: events.length,
      }
    }).pipe(
      Effect.catchAll((error) =>
        failWorkflowRun(
          ctx,
          workflowRunId,
          claim.runtimeSessionId,
          readErrorMessage(error, 'Unknown workflow execution failure.'),
        ).pipe(
          Effect.as({
            status: 'failed',
            eventCount: 0,
          }),
        ),
      ),
    )
  })
}

export const executeWorkflowRun = internalAction({
  args: {
    workflowRunId: v.id('workflowRuns'),
  },
  returns: v.object({
    status: v.string(),
    eventCount: v.number(),
  }),
  handler: (ctx, args) =>
    ExecutionBoundaryRuntime.runPromise(
      executeWorkflowRunProgram(ctx, args.workflowRunId),
    ),
})
