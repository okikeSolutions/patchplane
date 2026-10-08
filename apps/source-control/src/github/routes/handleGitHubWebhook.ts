import {
  Cause,
  Clock,
  Crypto,
  Effect,
  Exit,
  Redacted,
  Ref,
  Schema,
} from 'effect'
import { loadSourceControlRouteConfig, type WorkerEnv } from '../config'
import {
  convexMutation,
  convexQuery,
} from '@patchplane/plugins/convex/http-client'
import { convexMutationWithNativeDeadline } from '@patchplane/plugins/convex/native-deadline-mutation'
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
import { SourceControlError } from '@patchplane/domain/errors'
import { withCapturedCriticalPathScope } from '../../critical-path-telemetry'
import { readBoundedPayload } from '../../webhook-worker/boundary'
import {
  hostedVerificationAggregateLimitSeconds,
  hostedVerificationCommandLimitSeconds,
  loadConfiguredVerificationPolicyLayers,
  lookupGitHubWebhookRoute,
  SourceControlWorkerRequestError,
  connectedRepositoryRouteSchema,
  bindQueuedGitHubDeliveryToWorkflowMutation,
  markWorkflowExecutionFailedMutation,
  jsonResponse,
  requiredHeader,
  configuredConvexUrl,
  systemIngestionSecret,
  loadGitHubWebhookRouteConfig,
  randomTraceIdEffect,
  resolveGitHubWebhookWorkspace,
  makeGitHubActor,
  isPatchPlaneResultComment,
} from './support'

const convexOperationTimeoutMilliseconds = 15_000
const terminalConfirmationTimeoutMilliseconds = 10_000
const terminalConfirmationEffectTimeoutMilliseconds = 11_000

export function validWebhookHeaders(input: {
  readonly deliveryId: string
  readonly eventName: string
  readonly signature: string
}) {
  return (
    input.deliveryId.length <= 128 &&
    input.eventName.length <= 128 &&
    /^sha256=[0-9a-f]{64}$/.test(input.signature)
  )
}

function hex(bytes: Uint8Array) {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join(
    '',
  )
}

function deadline<A, E, R>(effect: Effect.Effect<A, E, R>, operation: string) {
  return effect.pipe(
    Effect.timeoutOrElse({
      duration: convexOperationTimeoutMilliseconds,
      orElse: () =>
        Effect.fail(
          new SourceControlWorkerRequestError({
            message: `${operation} exceeded its deadline`,
          }),
        ),
    }),
  )
}

export function withPreparedWebhookInterruptionFinalizer<
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

const confirmTerminalWebhookState = Effect.fnUntraced(function* (input: {
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
      summary: 'Webhook execution was interrupted after workflow creation.',
    },
    operationName: 'markWorkflowExecutionFailed.webhook',
    timeoutMilliseconds: terminalConfirmationTimeoutMilliseconds,
    catch: (cause) =>
      new SourceControlWorkerRequestError({
        message: 'Unable to confirm terminal webhook state',
        cause,
      }),
  }).pipe(
    Effect.flatMap(Schema.decodeUnknownEffect(Schema.Boolean)),
    Effect.timeoutOrElse({
      duration: terminalConfirmationEffectTimeoutMilliseconds,
      orElse: () => Effect.succeed(false),
    }),
    Effect.orElseSucceed(() => false),
  )
})

export const handleGitHubWebhook = Effect.fnUntraced(function* (
  request: Request,
  env: WorkerEnv,
) {
  const configExit = yield* loadSourceControlRouteConfig(env).pipe(Effect.exit)
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
  if (!validWebhookHeaders({ deliveryId, eventName, signature })) {
    return jsonResponse(
      { ok: false, error: 'Invalid GitHub webhook headers' },
      { status: 400 },
    )
  }

  const traceId = yield* randomTraceIdEffect()
  const payload = yield* readBoundedPayload(request)
  if (payload === undefined) {
    return jsonResponse(
      { ok: false, traceId, error: 'GitHub webhook payload exceeds bounds' },
      { status: 413 },
    )
  }
  const routeConfigExit = yield* loadGitHubWebhookRouteConfig(config).pipe(
    Effect.exit,
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
      installationId: event.installationId,
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
        : yield* deadline(
            convexQuery({
              url: configuredConvexUrl(config),
              reference: lookupGitHubWebhookRoute,
              args: {
                systemSecret: secret,
                installationId: String(event.installationId),
                repositoryExternalId: String(event.repositoryId),
              },
              catch: (cause) =>
                new SourceControlError({
                  operation: 'githubWorker.lookupConnectedRepository',
                  message:
                    'Convex failed to look up connected GitHub repository',
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
                      operation:
                        'githubWorker.lookupConnectedRepository.decode',
                      message:
                        'Convex returned an invalid connected repository route',
                      cause,
                    }),
              ),
            ),
            'Connected repository lookup',
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
      const bound: unknown = yield* deadline(
        convexMutation({
          url: configuredConvexUrl(config),
          reference: bindQueuedGitHubDeliveryToWorkflowMutation,
          args: {
            systemSecret: Redacted.value(config.systemIngestionSecret),
            deliveryId,
            workflowRunId: workflowStart.workflowRun.id,
            repositoryExternalId,
            issueExternalId,
            pullRequestBaseSha,
            pullRequestHeadSha,
          },
          catch: () =>
            new SourceControlWorkerRequestError({
              message: 'Queued delivery could not bind its workflow attempt',
            }),
        }),
        'Queued delivery workflow binding',
      )
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
    if (
      workflowStart.workflowRun.candidateIdentityVersion !== 'incoming-pr-v1'
    ) {
      return yield* new SourceControlWorkerRequestError({
        message:
          'Executable GitHub pull request workflow lacks incoming candidate identity',
      })
    }
    const activeIncomingDispatchToken = yield* Ref.make<string | undefined>(
      undefined,
    )
    let preparedIncomingDispatchToken: string | undefined
    const terminalize =
      secret === undefined
        ? Effect.void
        : Effect.gen(function* () {
            const incomingDispatchToken = yield* Ref.get(
              activeIncomingDispatchToken,
            )
            yield* confirmTerminalWebhookState({
              convexUrl: configuredConvexUrl(config),
              systemSecret: secret,
              workflowRunId: workflowStart.workflowRun.id,
              incomingDispatchToken,
            })
          })
    const workflowExecution = Effect.gen(function* () {
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
              operation: 'github.webhook.persistVerificationPlan',
            })
          : undefined
      const incomingDispatch =
        workflowStart.workflowRun.candidateIdentityVersion === 'incoming-pr-v1'
          ? yield* FreezeIncomingPullRequestCandidate({ workflowStart }).pipe(
              Effect.flatMap((candidatePatchSet) =>
                Effect.gen(function* () {
                  if (candidatePatchSet === undefined) return undefined
                  if (preparedIncomingDispatchToken === undefined) {
                    return yield* new SourceControlWorkerRequestError({
                      message: 'Incoming dispatch token was not prepared',
                    })
                  }
                  return yield* ClaimIncomingPullRequestDispatch({
                    workflowStart,
                    candidatePatchSet,
                    dispatchToken: preparedIncomingDispatchToken,
                  })
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
        workflowStart.workflowRun.candidateIdentityVersion ===
          'incoming-pr-v1' && incomingDispatch === undefined
          ? undefined
          : incomingExecution !== undefined
            ? incomingExecution.sandboxExecutions.at(-1)
            : routeConfig.execution.mode === 'daytona-pi'
              ? yield* RunSandboxAgentForWorkflow({
                  workflowStart,
                  ...(incomingDispatch === undefined
                    ? {}
                    : { incomingDispatch }),
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
                  ...(incomingDispatch === undefined
                    ? {}
                    : { incomingDispatch }),
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
    })
    return yield* withPreparedWebhookInterruptionFinalizer({
      prepare: Effect.gen(function* () {
        preparedIncomingDispatchToken =
          workflowStart.workflowRun.candidateIdentityVersion ===
          'incoming-pr-v1'
            ? hex(yield* (yield* Crypto.Crypto).randomBytes(16))
            : undefined
        yield* Ref.set(
          activeIncomingDispatchToken,
          preparedIncomingDispatchToken,
        )
      }),
      effect: workflowExecution,
      finalizer: terminalize,
    })
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

  const exit = yield* program.pipe(Effect.exit)

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

  const failure = Cause.squash(exit.cause)
  const failureTag =
    typeof failure === 'object' && failure !== null
      ? Reflect.get(failure, '_tag')
      : undefined
  const failureOperation =
    typeof failure === 'object' && failure !== null
      ? Reflect.get(failure, 'operation')
      : undefined
  const providerCause =
    typeof failure === 'object' && failure !== null
      ? Reflect.get(failure, 'cause')
      : undefined
  const providerStatus =
    typeof providerCause === 'object' && providerCause !== null
      ? Reflect.get(providerCause, 'status')
      : undefined
  const providerErrorType =
    typeof providerCause === 'object' && providerCause !== null
      ? Reflect.get(providerCause, 'errorType')
      : undefined
  const providerErrorDetail =
    typeof providerCause === 'object' && providerCause !== null
      ? Reflect.get(providerCause, 'errorDetail')
      : undefined
  const providerRequest =
    typeof providerCause === 'object' && providerCause !== null
      ? Reflect.get(providerCause, 'request')
      : undefined
  const providerRequestUrl =
    typeof providerRequest === 'object' && providerRequest !== null
      ? Reflect.get(providerRequest, 'url')
      : undefined
  const providerRouteCategory = (() => {
    if (typeof providerRequestUrl !== 'string') return undefined
    try {
      const path = new URL(providerRequestUrl).pathname.replace(/\/{2,}/g, '/')
      if (/^\/app\/installations\/\d+\/access_tokens$/.test(path)) {
        return 'installation-token-mint'
      }
      if (path === '/installation/token') {
        return 'installation-token-revoke'
      }
      return undefined
    } catch {
      return undefined
    }
  })()
  yield* Effect.logError('githubWorker.webhook failed', {
    traceId,
    deliveryId,
    eventName,
    ...(typeof failureTag === 'string' && failureTag.length <= 128
      ? { failureTag }
      : {}),
    ...(typeof failureOperation === 'string' && failureOperation.length <= 256
      ? { failureOperation }
      : {}),
    ...(typeof providerStatus === 'number' &&
    Number.isSafeInteger(providerStatus)
      ? { providerStatus }
      : {}),
    ...(typeof providerErrorType === 'string' && providerErrorType.length <= 128
      ? { providerErrorType }
      : {}),
    ...(typeof providerErrorDetail === 'string' &&
    providerErrorDetail.length <= 256
      ? { providerErrorDetail }
      : {}),
    ...(providerRouteCategory === undefined ? {} : { providerRouteCategory }),
  })

  return jsonResponse(
    { ok: false, traceId, error: 'GitHub webhook ingestion failed' },
    { status: 400 },
  )
})
