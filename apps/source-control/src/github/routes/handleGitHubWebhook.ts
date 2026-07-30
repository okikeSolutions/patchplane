import { ConvexHttpClient } from 'convex/browser'
import { Cause, Effect, Exit, Redacted, Schema } from 'effect'
import { loadSourceControlRouteConfig, type WorkerEnv } from '../config'
import { GitHubEventToWorkflowIntake } from '@patchplane/core/workflows/github-event-to-intake'
import { NormalizeGitHubWebhookEvent } from '@patchplane/core/github/normalize-github-webhook-event'
import { GitHubWebhookService } from '@patchplane/core/services/github-webhook-service'
import { PublishSandboxResultToSource } from '@patchplane/core/workflows/publish-sandbox-result-to-source'
import {
  ClaimIncomingPullRequestDispatch,
  FreezeIncomingPullRequestCandidate,
} from '@patchplane/core/workflows/freeze-incoming-pull-request-candidate'
import { RunIncomingVerificationPlan } from '@patchplane/core/workflows/run-incoming-verification-plan'
import { RunSandboxAgentForWorkflow } from '@patchplane/core/workflows/run-sandbox-agent-for-workflow'
import { RunSandboxCommandForWorkflow } from '@patchplane/core/workflows/run-sandbox-command-for-workflow'
import { PersistConfiguredVerificationRequirements } from '@patchplane/core/workflows/persist-sandbox-verification-evidence'
import { StartWorkflowFromIntake } from '@patchplane/core/workflows/start-workflow-from-intake'
import { withTelemetrySpan } from '@patchplane/core/services/telemetry-service'
import {
  SourceControlError,
  publicErrorMessage,
} from '@patchplane/domain/errors'
import { withCapturedCriticalPathScope } from '../../critical-path-telemetry'
import {
  hostedVerificationAggregateLimitSeconds,
  hostedVerificationCommandLimitSeconds,
  noIncomingDispatch,
  loadConfiguredVerificationPolicyLayers,
  lookupGitHubWebhookRoute,
  type SourceControlRuntime,
  SourceControlWorkerRequestError,
  connectedRepositoryRouteSchema,
  bindQueuedGitHubDeliveryToWorkflowMutation,
  jsonResponse,
  requiredHeader,
  configuredConvexUrl,
  systemIngestionSecret,
  loadGitHubWebhookRouteConfig,
  randomTraceId,
  resolveGitHubWebhookWorkspace,
  makeGitHubActor,
  isPatchPlaneResultComment,
} from './support'

export async function handleGitHubWebhook(
  request: Request,
  env: WorkerEnv,
  runtime: SourceControlRuntime,
) {
  const configExit = await runtime.runPromiseExit(
    loadSourceControlRouteConfig(env),
  )
  if (Exit.isFailure(configExit)) {
    return jsonResponse(
      { ok: false, error: 'GitHub webhook configuration is incomplete' },
      { status: 500 },
    )
  }
  const config = configExit.value

  const deliveryId = requiredHeader(request, 'x-github-delivery')
  const eventName = requiredHeader(request, 'x-github-event')
  const signature = requiredHeader(request, 'x-hub-signature-256')

  if (
    deliveryId === undefined ||
    eventName === undefined ||
    signature === undefined
  ) {
    return jsonResponse(
      {
        ok: false,
        error:
          'Missing required GitHub webhook headers: x-github-delivery, x-github-event, x-hub-signature-256',
      },
      { status: 400 },
    )
  }

  const traceId = await randomTraceId(runtime)
  const payload = await request.text()
  const routeConfigExit = await runtime.runPromiseExit(
    loadGitHubWebhookRouteConfig(config),
  )
  if (Exit.isFailure(routeConfigExit)) {
    return jsonResponse(
      { ok: false, error: 'GitHub webhook configuration is invalid' },
      { status: 500 },
    )
  }
  const routeConfig = routeConfigExit.value

  const program = Effect.gen(function* () {
    const githubWebhooks = yield* GitHubWebhookService
    const verified = yield* githubWebhooks.verifyWebhook({
      deliveryId,
      eventName,
      signature,
      payload,
      traceId,
      operation: 'github.webhook.verify',
    })
    if (eventName === 'pull_request') {
      const action = yield* Schema.decodeUnknownEffect(
        Schema.Struct({ action: Schema.String }),
      )(verified.payload).pipe(
        Effect.mapError(
          () =>
            new SourceControlWorkerRequestError({
              message: 'GitHub pull request action is malformed',
            }),
        ),
      )
      if (action.action !== 'opened' && action.action !== 'synchronize') {
        return {
          event: undefined,
          intake: undefined,
          workflowStart: undefined,
          sandboxExecution: undefined,
          publication: undefined,
          ignoredReason: 'unsupported_pull_request_action',
          verificationTerminal: true,
        }
      }
    }
    const event = yield* NormalizeGitHubWebhookEvent(verified)
    yield* Effect.logInfo('Ingested GitHub webhook event', {
      deliveryId: event.deliveryId,
      kind: event.kind,
      owner: event.owner,
      repo: event.repo,
    })
    const repositoryFullName = `${event.owner}/${event.repo}`
    if (
      event.kind !== 'github.pull_request.opened' &&
      event.kind !== 'github.pull_request.synchronize'
    ) {
      yield* Effect.logInfo(
        'Ignoring executable GitHub event without a pinned pull request head',
        {
          deliveryId,
          eventKind: event.kind,
          repository: repositoryFullName,
        },
      )
      return {
        event,
        intake: undefined,
        workflowStart: undefined,
        sandboxExecution: undefined,
        publication: undefined,
        ignoredReason: 'unpinned_event',
      }
    }
    const secret = systemIngestionSecret(config)
    const hostedRoute =
      secret === undefined
        ? null
        : yield* Effect.tryPromise({
            try: () => {
              const convex = new ConvexHttpClient(configuredConvexUrl(config))
              return convex.query(lookupGitHubWebhookRoute, {
                systemSecret: secret,
                installationId: String(event.installationId),
                repositoryExternalId: String(event.repositoryId),
              })
            },
            catch: (cause) =>
              new SourceControlError({
                operation: 'githubWorker.lookupConnectedRepository',
                message: 'Convex failed to look up connected GitHub repository',
                cause,
              }),
          }).pipe(
            Effect.flatMap(
              Schema.decodeUnknownEffect(connectedRepositoryRouteSchema),
            ),
            Effect.mapError((cause) =>
              cause instanceof SourceControlError
                ? cause
                : new SourceControlError({
                    operation: 'githubWorker.lookupConnectedRepository.decode',
                    message:
                      'Convex returned an invalid connected repository route',
                    cause,
                  }),
            ),
          )
    const resolvedRoute = resolveGitHubWebhookWorkspace({
      repositoryFullName,
      fallbackWorkspaceId: routeConfig.workspaceId,
      repositoryAllowlist: routeConfig.repositoryAllowlist,
      hostedRoute,
    })

    if (resolvedRoute.ignoredReason === 'unconnected_repository') {
      yield* Effect.logInfo(
        'Ignoring GitHub webhook for unconnected repository',
        {
          deliveryId,
          repository: repositoryFullName,
        },
      )
      return {
        event,
        intake: undefined,
        workflowStart: undefined,
        sandboxExecution: undefined,
        publication: undefined,
        ignoredReason: 'unconnected_repository',
      }
    }

    const intake = yield* GitHubEventToWorkflowIntake(event, {
      actor: makeGitHubActor(event.installationId),
      workspaceId: resolvedRoute.workspaceId,
      traceId,
    })

    if (
      isPatchPlaneResultComment({
        eventKind: intake.externalRef?.eventKind,
        prompt: intake.prompt,
      })
    ) {
      yield* Effect.logInfo('Ignoring PatchPlane result comment webhook', {
        deliveryId,
        repository: intake.externalRef?.repositoryFullName,
      })
      return {
        event,
        intake,
        workflowStart: undefined,
        sandboxExecution: undefined,
        publication: undefined,
        ignoredReason: 'patchplane_result_comment',
      }
    }

    const workflowStart = yield* StartWorkflowFromIntake(intake)
    if (request.headers.get('x-patchplane-queued-delivery') === 'v1') {
      const externalRef = intake.externalRef
      if (
        externalRef?.repositoryExternalId === undefined ||
        externalRef.issueExternalId === undefined ||
        externalRef.pullRequestBaseSha === undefined ||
        externalRef.pullRequestHeadSha === undefined
      ) {
        return yield* new SourceControlWorkerRequestError({
          message: 'Queued delivery is missing exact workflow lineage',
        })
      }
      const repositoryExternalId = externalRef.repositoryExternalId
      const issueExternalId = externalRef.issueExternalId
      const pullRequestBaseSha = externalRef.pullRequestBaseSha
      const pullRequestHeadSha = externalRef.pullRequestHeadSha
      const bound: unknown = yield* Effect.tryPromise({
        try: () =>
          new ConvexHttpClient(configuredConvexUrl(config)).mutation(
            bindQueuedGitHubDeliveryToWorkflowMutation,
            {
              systemSecret: Redacted.value(config.systemIngestionSecret),
              deliveryId,
              workflowRunId: workflowStart.workflowRun.id,
              repositoryExternalId,
              issueExternalId,
              pullRequestBaseSha,
              pullRequestHeadSha,
            },
          ),
        catch: () =>
          new SourceControlWorkerRequestError({
            message: 'Queued delivery could not bind its workflow attempt',
          }),
      })
      if (bound !== 'bound' && bound !== 'coalesced') {
        return yield* new SourceControlWorkerRequestError({
          message: 'Queued delivery workflow binding was rejected',
        })
      }
      if (bound === 'coalesced') {
        return {
          event,
          intake,
          workflowStart,
          sandboxExecution: undefined,
          publication: undefined,
          ignoredReason: undefined,
          verificationTerminal: true,
          deliveryCoalesced: true,
        }
      }
    }
    if (
      workflowStart.workflowRun.status === 'reviewed' ||
      workflowStart.workflowRun.status === 'failed'
    ) {
      return {
        event,
        intake,
        workflowStart,
        sandboxExecution: undefined,
        publication: undefined,
        ignoredReason: undefined,
        verificationTerminal: true,
      }
    }
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
            operation: 'github.webhook.persistVerificationPlan',
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
    const incomingExecution =
      incomingDispatch !== undefined && persistedVerification !== undefined
        ? yield* Effect.raceFirst(
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
        : undefined
    const sandboxExecution =
      workflowStart.workflowRun.candidateIdentityVersion === 'incoming-pr-v1' &&
      incomingDispatch === undefined
        ? undefined
        : incomingExecution !== undefined
          ? incomingExecution.sandboxExecutions.at(-1)
          : routeConfig.execution.mode === 'daytona-pi'
            ? yield* RunSandboxAgentForWorkflow({
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
                evidenceTestPlatform:
                  routeConfig.execution.evidenceTestPlatform,
                evidenceBrowserScreenshotCommand:
                  routeConfig.execution.evidenceBrowserScreenshotCommand,
              })
            : yield* RunSandboxCommandForWorkflow({
                workflowStart,
                ...(incomingDispatch === undefined ? {} : { incomingDispatch }),
                ...(persistedVerification === undefined
                  ? {}
                  : { verificationPlan: persistedVerification }),
                command: routeConfig.execution.command,
                timeoutSeconds: routeConfig.execution.timeoutSeconds,
                evidenceTestReportCommand:
                  routeConfig.execution.evidenceTestReportCommand,
                evidenceTestPlatform:
                  routeConfig.execution.evidenceTestPlatform,
                evidenceBrowserScreenshotCommand:
                  routeConfig.execution.evidenceBrowserScreenshotCommand,
              })

    const publication =
      sandboxExecution === undefined || incomingExecution !== undefined
        ? undefined
        : yield* PublishSandboxResultToSource({
            workflowStart,
            sandboxExecution,
          })
    return {
      event,
      intake,
      workflowStart,
      sandboxExecution,
      publication,
      ignoredReason: undefined,
      verificationTerminal: incomingExecution?.complete,
    }
  }).pipe(
    (effect) =>
      withTelemetrySpan(
        {
          traceId,
          operation: 'githubWorker.webhook',
          name: 'githubWorker.webhook',
          attributes: { deliveryId, eventName },
        },
        effect,
      ),
    Effect.withLogSpan('githubWorker.webhook'),
    (effect) =>
      withCapturedCriticalPathScope(
        {
          traceId,
          operation: 'githubWorker.webhook',
          message: 'GitHub webhook ingestion failed',
          attributes: { deliveryId, eventName },
        },
        effect,
      ),
  )

  const exit = await runtime.runPromiseExit(program)

  if (Exit.isSuccess(exit)) {
    return jsonResponse(
      {
        ok: true,
        traceId,
        ignored: exit.value.workflowStart === undefined,
        workflowRunId: exit.value.workflowStart?.workflowRun.id,
        promptRequestId: exit.value.workflowStart?.promptRequest.id,
        ignoredReason: exit.value.ignoredReason,
        externalProvider: exit.value.intake?.externalRef?.provider ?? 'github',
        externalEventKind:
          exit.value.intake?.externalRef?.eventKind ??
          exit.value.event?.kind ??
          `github.${eventName}.ignored`,
        sandboxExecutionId: exit.value.sandboxExecution?.id,
        sandboxStatus: exit.value.sandboxExecution?.status,
        verificationTerminal:
          exit.value.workflowStart === undefined ||
          ('verificationTerminal' in exit.value &&
            exit.value.verificationTerminal === true),
        deliveryId,
        deliveryCoalesced:
          'deliveryCoalesced' in exit.value &&
          exit.value.deliveryCoalesced === true,
        publishedProvider: exit.value.publication?.provider,
        publishedIssueNumber: exit.value.publication?.issueNumber,
      },
      { status: 202 },
    )
  }

  const cause = Cause.squash(exit.cause)
  const error = publicErrorMessage(cause, 'GitHub webhook ingestion failed')

  console.error('githubWorker.webhook failed', {
    traceId,
    deliveryId,
    eventName,
    error,
    cause: Cause.pretty(exit.cause),
  })

  return jsonResponse({ ok: false, traceId, error }, { status: 400 })
}
