import { Clock, Crypto, Effect, Exit, Ref, Schema } from 'effect'
import { loadSourceControlRouteConfig, type WorkerEnv } from '../config'
import { convexQuery } from '@patchplane/plugins/convex/http-client'
import { convexMutationWithNativeDeadline } from '@patchplane/plugins/convex/native-deadline-mutation'
import { PublishSandboxResultToSource } from '@patchplane/core/workflows/publish-sandbox-result-to-source'
import {
  ClaimIncomingPullRequestDispatch,
  FreezeIncomingPullRequestCandidate,
} from '@patchplane/core/workflows/freeze-incoming-pull-request-candidate'
import { RunIncomingVerificationPlan } from '@patchplane/core/workflows/run-incoming-verification-plan'
import { RunSandboxAgentForWorkflow } from '@patchplane/core/workflows/run-sandbox-agent-for-workflow'
import { RunSandboxCommandForWorkflow } from '@patchplane/core/workflows/run-sandbox-command-for-workflow'
import { PersistConfiguredVerificationRequirements } from '@patchplane/core/workflows/persist-sandbox-verification-evidence'
import { withTelemetrySpan } from '@patchplane/core/services/telemetry-service'
import { WorkflowStart } from '@patchplane/domain/workflow-start'
import { withCapturedCriticalPathScope } from '../../critical-path-telemetry'
import {
  type SandboxExecutionValue,
  hostedVerificationAggregateLimitSeconds,
  hostedVerificationCommandLimitSeconds,
  noIncomingDispatch,
  loadConfiguredVerificationPolicyLayers,
  SourceControlWorkerRequestError,
  rerunExecutionRequestSchema,
  markWorkflowExecutionFailedMutation,
  getWorkflowExecutionFixtureQuery,
  jsonResponse,
  configuredConvexUrl,
  systemIngestionSecret,
  loadGitHubWebhookRouteConfig,
  randomTraceIdEffect,
  readBoundedJson,
} from './support'

const terminalConfirmationTimeoutMilliseconds = 10_000
const convexOperationTimeoutMilliseconds = 15_000

export function withRerunFixtureDeadline<A, E, R>(
  effect: Effect.Effect<A, E, R>,
) {
  return effect.pipe(
    Effect.timeoutOrElse({
      duration: convexOperationTimeoutMilliseconds,
      orElse: () =>
        Effect.fail(
          new SourceControlWorkerRequestError({
            message: 'Rerun workflow lookup timed out',
          }),
        ),
    }),
  )
}

function hex(bytes: Uint8Array) {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join(
    '',
  )
}

export function withRerunInterruptionFinalizer<A, E, R, E2, R2>(
  effect: Effect.Effect<A, E, R>,
  finalizer: Effect.Effect<unknown, E2, R2>,
) {
  return effect.pipe(Effect.onInterrupt(() => finalizer))
}

export function withPreparedRerunInterruptionFinalizer<
  A,
  E,
  R,
  E1,
  R1,
  E2,
  R2,
>(input: {
  readonly prepare: Effect.Effect<unknown, E1, R1>
  readonly effect: Effect.Effect<A, E, R>
  readonly finalizer: Effect.Effect<unknown, E2, R2>
}) {
  return Effect.uninterruptibleMask((restore) =>
    input.prepare.pipe(
      Effect.andThen(
        restore(input.effect).pipe(Effect.onInterrupt(() => input.finalizer)),
      ),
    ),
  )
}

export function claimWithPublishedDispatchToken<A, E, R>(input: {
  readonly activeToken: Ref.Ref<string | undefined>
  readonly dispatchToken: string
  readonly claim: Effect.Effect<A | undefined, E, R>
}) {
  return Effect.gen(function* () {
    yield* Ref.set(input.activeToken, input.dispatchToken)
    return yield* input.claim
  })
}

const confirmTerminalRerunState = Effect.fnUntraced(function* (input: {
  readonly convexUrl: string
  readonly systemSecret: string
  readonly workflowRunId: string
  readonly incomingDispatchToken?: string | undefined
}) {
  return yield* convexMutationWithNativeDeadline({
    url: input.convexUrl,
    reference: markWorkflowExecutionFailedMutation,
    args: {
      systemSecret: input.systemSecret,
      workflowRunId: input.workflowRunId,
      ...(input.incomingDispatchToken === undefined
        ? {}
        : { incomingDispatchToken: input.incomingDispatchToken }),
      summary: 'Rerun execution failed after dispatch.',
    },
    operationName: 'markWorkflowExecutionFailed.rerun',
    timeoutMilliseconds: terminalConfirmationTimeoutMilliseconds,
    catch: (cause) =>
      new SourceControlWorkerRequestError({
        message: 'Unable to confirm terminal rerun state',
        cause,
      }),
  }).pipe(
    Effect.flatMap(Schema.decodeUnknownEffect(Schema.Boolean)),
    Effect.timeoutOrElse({
      duration: terminalConfirmationTimeoutMilliseconds,
      orElse: () => Effect.succeed(false),
    }),
    Effect.orElseSucceed(() => false),
  )
})

export const executeWorkflowRerun = Effect.fnUntraced(function* (
  request: Request,
  env: WorkerEnv,
) {
  const traceId = yield* randomTraceIdEffect()
  const inputExit = yield* readBoundedJson(request).pipe(
    Effect.flatMap(Schema.decodeUnknownEffect(rerunExecutionRequestSchema)),
    Effect.exit,
  )
  if (Exit.isFailure(inputExit)) {
    return jsonResponse(
      { ok: false, traceId, error: 'Invalid rerun execution request' },
      { status: 400 },
    )
  }

  const configuredExit = yield* loadSourceControlRouteConfig(env).pipe(
    Effect.flatMap((sourceConfig) =>
      loadGitHubWebhookRouteConfig(sourceConfig).pipe(
        Effect.map((routeConfig) => ({ sourceConfig, routeConfig })),
      ),
    ),
    Effect.exit,
  )
  if (Exit.isFailure(configuredExit)) {
    return jsonResponse(
      { ok: false, traceId, error: 'Workflow execution is not configured' },
      { status: 503 },
    )
  }

  const { routeConfig, sourceConfig } = configuredExit.value
  const secret = systemIngestionSecret(sourceConfig)
  if (secret === undefined) {
    return jsonResponse(
      { ok: false, traceId, error: 'Workflow execution is not configured' },
      { status: 503 },
    )
  }

  const input = inputExit.value
  const convexUrl = configuredConvexUrl(sourceConfig)
  const workflowExit = yield* convexQuery({
    url: convexUrl,
    reference: getWorkflowExecutionFixtureQuery,
    args: {
      systemSecret: secret,
      workflowRunId: input.workflowRunId,
    },
    catch: (cause) =>
      new SourceControlWorkerRequestError({
        message: 'Unable to load rerun workflow',
        cause,
      }),
  }).pipe(
    Effect.flatMap(Schema.decodeUnknownEffect(WorkflowStart)),
    withRerunFixtureDeadline,
    Effect.exit,
  )
  if (Exit.isFailure(workflowExit)) {
    return jsonResponse(
      { ok: false, traceId, error: 'Queued rerun workflow unavailable' },
      { status: 409 },
    )
  }

  const workflowStart = workflowExit.value
  const activeIncomingDispatchToken = yield* Ref.make<string | undefined>(
    undefined,
  )
  let preparedIncomingDispatchToken: string | undefined
  const terminalize = Effect.gen(function* () {
    const incomingDispatchToken = yield* Ref.get(activeIncomingDispatchToken)
    return yield* confirmTerminalRerunState({
      convexUrl,
      systemSecret: secret,
      workflowRunId: workflowStart.workflowRun.id,
      incomingDispatchToken,
    })
  })

  const execution = Effect.gen(function* () {
    const trustedPolicyLayers = yield* loadConfiguredVerificationPolicyLayers(
      routeConfig,
      workflowStart,
    )
    const persistedVerification =
      workflowStart.workflowRun.candidateIdentityVersion === 'incoming-pr-v1'
        ? yield* PersistConfiguredVerificationRequirements({
            ...trustedPolicyLayers,
            workflowRunId: workflowStart.workflowRun.id,
            testCommand: routeConfig.execution.evidenceTestReportCommand,
            testPlatform: routeConfig.execution.evidenceTestPlatform,
            browserCommand:
              routeConfig.execution.evidenceBrowserScreenshotCommand,
            timeoutSeconds: Math.min(
              routeConfig.execution.timeoutSeconds,
              hostedVerificationCommandLimitSeconds,
            ),
            createdAt: yield* Clock.currentTimeMillis,
            traceId: workflowStart.workflowRun.traceId,
            operation: 'github.rerun.persistVerificationPlan',
          })
        : undefined
    const incomingDispatch =
      workflowStart.workflowRun.candidateIdentityVersion === 'incoming-pr-v1'
        ? yield* FreezeIncomingPullRequestCandidate({ workflowStart }).pipe(
            Effect.flatMap((candidatePatchSet) =>
              candidatePatchSet === undefined
                ? noIncomingDispatch
                : Effect.gen(function* () {
                    const dispatchToken = preparedIncomingDispatchToken
                    if (dispatchToken === undefined) {
                      return yield* new SourceControlWorkerRequestError({
                        message: 'Incoming dispatch token was not prepared',
                      })
                    }
                    return yield* claimWithPublishedDispatchToken({
                      activeToken: activeIncomingDispatchToken,
                      dispatchToken,
                      claim: ClaimIncomingPullRequestDispatch({
                        workflowStart,
                        candidatePatchSet,
                        dispatchToken,
                      }),
                    })
                  }),
            ),
          )
        : undefined
    if (
      workflowStart.workflowRun.candidateIdentityVersion === 'incoming-pr-v1' &&
      incomingDispatch === undefined
    ) {
      return undefined
    }
    if (incomingDispatch !== undefined && persistedVerification !== undefined) {
      const verificationExecution = yield* Effect.raceFirst(
        RunIncomingVerificationPlan({
          workflowStart,
          incomingDispatch,
          verificationPlan: persistedVerification,
          maxAggregateExecutionSeconds: hostedVerificationAggregateLimitSeconds,
        }),
        Effect.sleep('14 minutes').pipe(
          Effect.andThen(
            Effect.fail(
              new SourceControlWorkerRequestError({
                message: 'Hosted verification exceeded its hard deadline',
              }),
            ),
          ),
        ),
      )
      return verificationExecution.sandboxExecutions.at(-1)
    }
    return yield* routeConfig.execution.mode === 'daytona-pi'
      ? RunSandboxAgentForWorkflow({
          workflowStart,
          ...(incomingDispatch === undefined ? {} : { incomingDispatch }),
          ...(persistedVerification === undefined
            ? {}
            : { verificationPlan: persistedVerification }),
          provider: routeConfig.execution.provider,
          model: routeConfig.execution.model,
          thinking: routeConfig.execution.thinking,
          mode: routeConfig.execution.piMode,
          timeoutSeconds: routeConfig.execution.timeoutSeconds,
          evidenceTestReportCommand:
            routeConfig.execution.evidenceTestReportCommand,
          evidenceTestPlatform: routeConfig.execution.evidenceTestPlatform,
          evidenceBrowserScreenshotCommand:
            routeConfig.execution.evidenceBrowserScreenshotCommand,
        })
      : RunSandboxCommandForWorkflow({
          workflowStart,
          ...(incomingDispatch === undefined ? {} : { incomingDispatch }),
          ...(persistedVerification === undefined
            ? {}
            : { verificationPlan: persistedVerification }),
          command: routeConfig.execution.command,
          timeoutSeconds: routeConfig.execution.timeoutSeconds,
          evidenceTestReportCommand:
            routeConfig.execution.evidenceTestReportCommand,
          evidenceTestPlatform: routeConfig.execution.evidenceTestPlatform,
          evidenceBrowserScreenshotCommand:
            routeConfig.execution.evidenceBrowserScreenshotCommand,
        })
  }).pipe(
    Effect.flatMap((sandboxExecution) =>
      sandboxExecution === undefined
        ? Effect.succeed({
            sandboxExecution: undefined as SandboxExecutionValue | undefined,
          })
        : workflowStart.workflowRun.candidateIdentityVersion ===
            'incoming-pr-v1'
          ? Effect.succeed({ sandboxExecution })
          : PublishSandboxResultToSource({
              workflowStart,
              sandboxExecution,
            }).pipe(Effect.as({ sandboxExecution })),
    ),
    (effect) =>
      withTelemetrySpan(
        {
          traceId: input.traceId,
          workflowRunId: workflowStart.workflowRun.id,
          operation: 'githubWorker.executeWorkflowRerun',
          name: 'githubWorker.executeWorkflowRerun',
        },
        effect,
      ),
    (effect) =>
      withCapturedCriticalPathScope(
        {
          traceId: input.traceId,
          workflowRunId: workflowStart.workflowRun.id,
          operation: 'githubWorker.executeWorkflowRerun',
          message: 'Rerun execution failed',
        },
        effect,
      ),
  )

  const prepareInterruptionFinalizer = Effect.gen(function* () {
    preparedIncomingDispatchToken =
      workflowStart.workflowRun.candidateIdentityVersion === 'incoming-pr-v1'
        ? hex(yield* (yield* Crypto.Crypto).randomBytes(16))
        : undefined
    yield* Ref.set(activeIncomingDispatchToken, preparedIncomingDispatchToken)
  })
  const executionExit = yield* withPreparedRerunInterruptionFinalizer({
    prepare: prepareInterruptionFinalizer,
    effect: execution,
    finalizer: terminalize,
  }).pipe(Effect.exit)
  if (Exit.isFailure(executionExit)) {
    const terminalStateConfirmed = yield* terminalize
    return jsonResponse(
      {
        ok: false,
        traceId: input.traceId,
        workflowRunId: workflowStart.workflowRun.id,
        error: terminalStateConfirmed
          ? 'Rerun execution failed; the child attempt was retained with failed status'
          : 'Rerun execution failed; the child attempt was retained but its terminal state is unconfirmed',
      },
      { status: 500 },
    )
  }

  return jsonResponse(
    {
      ok: true,
      traceId: input.traceId,
      workflowRunId: workflowStart.workflowRun.id,
      sandboxExecutionId: executionExit.value.sandboxExecution?.id,
    },
    { status: 202 },
  )
})
