import { ConvexHttpClient } from 'convex/browser'
import { Effect, Exit, Schema } from 'effect'
import { loadSourceControlRouteConfig, type WorkerEnv } from '../config'
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
  type SourceControlRuntime,
  SourceControlWorkerRequestError,
  rerunExecutionRequestSchema,
  markWorkflowExecutionFailedMutation,
  getWorkflowExecutionFixtureQuery,
  jsonResponse,
  configuredConvexUrl,
  systemIngestionSecret,
  loadGitHubWebhookRouteConfig,
  randomTraceId,
} from './support'

export async function executeWorkflowRerun(
  request: Request,
  env: WorkerEnv,
  runtime: SourceControlRuntime,
) {
  const traceId = await randomTraceId(runtime)
  const inputExit = await runtime.runPromiseExit(
    Effect.tryPromise({
      try: () => request.json(),
      catch: (cause) =>
        new SourceControlWorkerRequestError({
          message: `Invalid JSON body: ${String(cause)}`,
        }),
    }).pipe(
      Effect.flatMap(Schema.decodeUnknownEffect(rerunExecutionRequestSchema)),
    ),
  )
  if (Exit.isFailure(inputExit)) {
    return jsonResponse(
      { ok: false, traceId, error: 'Invalid rerun execution request' },
      { status: 400 },
    )
  }

  const sourceConfigExit = await runtime.runPromiseExit(
    loadSourceControlRouteConfig(env),
  )
  if (Exit.isFailure(sourceConfigExit)) {
    return jsonResponse(
      { ok: false, traceId, error: 'Workflow execution is not configured' },
      { status: 503 },
    )
  }
  const sourceConfig = sourceConfigExit.value
  const routeConfigExit = await runtime.runPromiseExit(
    loadGitHubWebhookRouteConfig(sourceConfig),
  )
  if (Exit.isFailure(routeConfigExit)) {
    return jsonResponse(
      { ok: false, traceId, error: 'Workflow execution is not configured' },
      { status: 503 },
    )
  }
  const routeConfig = routeConfigExit.value
  const secret = systemIngestionSecret(sourceConfig)
  if (secret === undefined) {
    return jsonResponse(
      { ok: false, traceId, error: 'Workflow execution is not configured' },
      { status: 503 },
    )
  }
  const input = inputExit.value
  const workflowExit = await runtime.runPromiseExit(
    Effect.tryPromise({
      try: () =>
        new ConvexHttpClient(configuredConvexUrl(sourceConfig)).query(
          getWorkflowExecutionFixtureQuery,
          {
            systemSecret: secret,
            workflowRunId: input.workflowRunId,
          },
        ),
      catch: (cause) =>
        new SourceControlWorkerRequestError({
          message: `Unable to load rerun workflow: ${String(cause)}`,
        }),
    }).pipe(Effect.flatMap(Schema.decodeUnknownEffect(WorkflowStart))),
  )
  if (Exit.isFailure(workflowExit)) {
    return jsonResponse(
      { ok: false, traceId, error: 'Queued rerun workflow unavailable' },
      { status: 409 },
    )
  }

  const workflowStart = workflowExit.value
  let activeIncomingDispatchToken: string | undefined
  const executionExit = await runtime.runPromiseExit(
    Effect.gen(function* () {
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
              createdAt: Date.now(),
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
                  : ClaimIncomingPullRequestDispatch({
                      workflowStart,
                      candidatePatchSet,
                    }),
              ),
            )
          : undefined
      activeIncomingDispatchToken = incomingDispatch?.dispatchToken
      if (
        workflowStart.workflowRun.candidateIdentityVersion ===
          'incoming-pr-v1' &&
        incomingDispatch === undefined
      ) {
        return undefined
      }
      if (
        incomingDispatch !== undefined &&
        persistedVerification !== undefined
      ) {
        const execution = yield* Effect.raceFirst(
          RunIncomingVerificationPlan({
            workflowStart,
            incomingDispatch,
            verificationPlan: persistedVerification,
            maxAggregateExecutionSeconds:
              hostedVerificationAggregateLimitSeconds,
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
        return execution.sandboxExecutions.at(-1)
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
          ? Effect.sync(
              (): { sandboxExecution: SandboxExecutionValue | undefined } => ({
                sandboxExecution,
              }),
            )
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
    ),
  )
  if (Exit.isFailure(executionExit)) {
    const terminalStateExit = await runtime.runPromiseExit(
      Effect.tryPromise({
        try: () =>
          new ConvexHttpClient(configuredConvexUrl(sourceConfig)).mutation(
            markWorkflowExecutionFailedMutation,
            {
              systemSecret: secret,
              workflowRunId: workflowStart.workflowRun.id,
              ...(activeIncomingDispatchToken === undefined
                ? {}
                : {
                    incomingDispatchToken: activeIncomingDispatchToken,
                  }),
              summary: 'Rerun execution failed after dispatch.',
            },
          ),
        catch: (cause) =>
          new SourceControlWorkerRequestError({
            message: `Unable to confirm terminal rerun state: ${String(cause)}`,
          }),
      }),
    )
    const terminalStateConfirmed =
      Exit.isSuccess(terminalStateExit) && terminalStateExit.value
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
}
