import { NodeServices } from '@effect/platform-node'
import { ArtifactsService } from '@patchplane/core/services/artifacts-service'
import { CloudflareR2ArtifactsPlugin, type R2BucketLike } from '@patchplane/plugins/cloudflare/r2-artifacts-plugin'
import { ConvexStoragePlugin } from '@patchplane/plugins/convex/storage-plugin'
import { DaytonaSandboxPlugin } from '@patchplane/plugins/daytona/sandbox-plugin'
import { DAYTONA_DEFAULT_COMMAND, DAYTONA_DEFAULT_COMMAND_TIMEOUT_SECONDS } from '@patchplane/plugins/daytona/config'
import { GitHubProviderPlugin } from '@patchplane/plugins/github/provider-plugin'
import { SentryTelemetryPlugin } from '@patchplane/plugins/sentry/telemetry-plugin'
import { ConvexHttpClient } from 'convex/browser'
import { makeFunctionReference } from 'convex/server'
import { Cause, Crypto, Effect, Exit, Layer, ManagedRuntime, Redacted, Schema } from 'effect'
import {
  PATCHPLANE_DEFAULT_AGENT_PROVIDER,
  loadSourceControlRouteConfig,
  sourceControlConfigLayer,
  type SourceControlRouteConfig as SourceControlRouteConfigType,
  type WorkerEnv,
} from './config'
import { GitHubEventToWorkflowIntake } from '@patchplane/core/workflows/github-event-to-intake'
import { IngestGitHubWebhook } from '@patchplane/core/workflows/ingest-github-webhook'
import { ControlRuntimeSession } from '@patchplane/core/workflows/control-runtime-session'
import { PublishSandboxResultToSource } from '@patchplane/core/workflows/publish-sandbox-result-to-source'
import { RunSandboxAgentForWorkflow } from '@patchplane/core/workflows/run-sandbox-agent-for-workflow'
import { RunSandboxCommandForWorkflow } from '@patchplane/core/workflows/run-sandbox-command-for-workflow'
import { StartWorkflowFromIntake } from '@patchplane/core/workflows/start-workflow-from-intake'
import { SourceControlService } from '@patchplane/core/services/source-control-service'
import { captureTelemetryCause, withTelemetrySpan } from '@patchplane/core/services/telemetry-service'
import { ArtifactsError, SourceControlError, publicErrorMessage } from '@patchplane/domain/errors'
import { makeGitHubAppActorId, makeWorkspaceId, makeWorkOSWorkspaceId } from '@patchplane/domain/ids'

const lookupGitHubWebhookRoute = makeFunctionReference<
  'query',
  {
    systemSecret: string
    installationId: string
    repositoryExternalId: string
  },
  { workspaceId: string; repositoryFullName: string; status: string } | null
>('connectedRepositories:lookupGitHubWebhookRoute')

const MissingR2ArtifactsLayer = Layer.succeed(ArtifactsService, ArtifactsService.of({
  putArtifact: () => Effect.fail(new ArtifactsError({
    operation: 'r2.config',
    message: 'PATCHPLANE_EVIDENCE_BUCKET binding is required to store artifacts',
    cause: undefined,
  })),
  getArtifactMetadata: () => Effect.fail(new ArtifactsError({
    operation: 'r2.config',
    message: 'PATCHPLANE_EVIDENCE_BUCKET binding is required to read artifacts',
    cause: undefined,
  })),
  createSignedReadUrl: () => Effect.fail(new ArtifactsError({
    operation: 'r2.config',
    message: 'PATCHPLANE_EVIDENCE_BUCKET binding is required to sign artifacts',
    cause: undefined,
  })),
  deleteArtifact: () => Effect.fail(new ArtifactsError({
    operation: 'r2.config',
    message: 'PATCHPLANE_EVIDENCE_BUCKET binding is required to delete artifacts',
    cause: undefined,
  })),
  applyRetentionPolicy: () => Effect.fail(new ArtifactsError({
    operation: 'r2.config',
    message: 'PATCHPLANE_EVIDENCE_BUCKET binding is required to update artifact retention',
    cause: undefined,
  })),
}))

function sourceControlWorkerLayer(env: WorkerEnv) {
  const bucket = env.PATCHPLANE_EVIDENCE_BUCKET as R2BucketLike | undefined
  const artifactsLayer = bucket === undefined
    ? MissingR2ArtifactsLayer
    : CloudflareR2ArtifactsPlugin.layerFromBucket(bucket).pipe(Layer.provide(NodeServices.layer))

  return Layer.mergeAll(
    ConvexStoragePlugin.layer,
    GitHubProviderPlugin.layer,
    DaytonaSandboxPlugin.layer,
    SentryTelemetryPlugin.layer,
    artifactsLayer,
    NodeServices.layer,
  )
}

const SourceControlWorkerLayer = sourceControlWorkerLayer({})

type SourceControlRuntime = ManagedRuntime.ManagedRuntime<
  Layer.Success<typeof SourceControlWorkerLayer>,
  Layer.Error<typeof SourceControlWorkerLayer>
>

export function makeSourceControlRuntime(env: WorkerEnv): SourceControlRuntime {
  return ManagedRuntime.make(
    sourceControlWorkerLayer(env).pipe(Layer.provide(sourceControlConfigLayer(env))),
    { memoMap: Layer.makeMemoMapUnsafe() },
  )
}

class SourceControlWorkerRequestError extends Schema.ErrorClass<SourceControlWorkerRequestError>('SourceControlWorkerRequestError')({
  message: Schema.String,
}) {}

const syncInstallationRequestSchema = Schema.Struct({
  installationId: Schema.String,
  workspaceId: Schema.String,
})

const runtimeControlRequestSchema = Schema.Struct({
  workflowRunId: Schema.String,
  operation: Schema.Literals(['abort', 'steer', 'followUp', 'terminate']),
  message: Schema.optional(Schema.String),
})

function jsonResponse(body: unknown, init?: ResponseInit) {
  const headers = new Headers(init?.headers)
  headers.set('content-type', 'application/json')
  return new Response(JSON.stringify(body), { ...init, headers })
}

function requiredHeader(request: Request, name: string) {
  const value = request.headers.get(name)
  return value === null || value.length === 0 ? undefined : value
}

function configuredConvexUrl(config: SourceControlRouteConfigType) {
  return config.convexUrl.replace(/\/$/, '')
}

function systemIngestionSecret(config: SourceControlRouteConfigType) {
  const value = Redacted.value(config.systemIngestionSecret).trim()
  return value.length > 0 ? value : undefined
}

function parseRepositoryAllowlist(value: string | undefined) {
  if (value === undefined || value.trim().length === 0) {
    throw new Error('PATCHPLANE_GITHUB_ALLOWED_REPOSITORIES is required for GitHub workflow ingestion')
  }

  const repositories = value
    .split(',')
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean)

  if (repositories.length === 0) {
    throw new Error('PATCHPLANE_GITHUB_ALLOWED_REPOSITORIES must include at least one owner/repo entry')
  }

  return new Set(repositories)
}

function parseGitHubWorkspaceId(config: SourceControlRouteConfigType) {
  const workspaceId = config.githubWorkspaceId.trim()
  if (workspaceId) {
    return makeWorkspaceId(workspaceId)
  }

  const organizationId = config.workosOrganizationId.trim()
  if (organizationId) {
    return makeWorkOSWorkspaceId(organizationId)
  }

  throw new Error(
    'PATCHPLANE_GITHUB_WORKSPACE_ID or PATCHPLANE_WORKOS_ORGANIZATION_ID is required for GitHub workflow ingestion',
  )
}

function resolvePiExecutionConfig(config: SourceControlRouteConfigType) {
  const provider = config.piProvider.trim() || (
    config.cloudflareApiKey.trim().length > 0 &&
      config.cloudflareAccountId.trim().length > 0 &&
      config.cloudflareGatewayId.trim().length > 0
      ? 'cloudflare-ai-gateway'
      : PATCHPLANE_DEFAULT_AGENT_PROVIDER
  )

  return {
    provider,
    model: config.piModel,
    thinking: config.piThinking,
    piMode: config.piMode === 'rpc' ? 'rpc' : 'json',
    timeoutSeconds: DAYTONA_DEFAULT_COMMAND_TIMEOUT_SECONDS,
  } as const
}

function loadGitHubWebhookRouteConfig(config: SourceControlRouteConfigType) {
  const mode = config.webhookExecution === 'daytona-command'
    ? 'daytona-command'
    : 'daytona-pi'

  if (mode === 'daytona-pi') {
    return {
      workspaceId: parseGitHubWorkspaceId(config),
      repositoryAllowlist: parseRepositoryAllowlist(config.repositoryAllowlist),
      execution: {
        mode,
        ...resolvePiExecutionConfig(config),
      },
    } as const
  }

  return {
    workspaceId: parseGitHubWorkspaceId(config),
    repositoryAllowlist: parseRepositoryAllowlist(config.repositoryAllowlist),
    execution: {
      mode,
      command: DAYTONA_DEFAULT_COMMAND,
      timeoutSeconds: DAYTONA_DEFAULT_COMMAND_TIMEOUT_SECONDS,
    },
  } as const
}

async function randomTraceId(runtime: SourceControlRuntime) {
  return await runtime.runPromise(
    Effect.gen(function* () {
      const crypto = yield* Crypto.Crypto
      return yield* crypto.randomUUIDv4
    }),
  )
}

async function resolveGitHubWebhookWorkspace(input: {
  readonly repositoryFullName: string
  readonly fallbackWorkspaceId: string
  readonly repositoryAllowlist: ReadonlySet<string>
  readonly lookupConnectedRepository: () => Promise<{ readonly workspaceId: string } | null>
}) {
  const hostedRoute = await input.lookupConnectedRepository()
  const allowlisted = input.repositoryAllowlist.has(input.repositoryFullName.toLowerCase())

  if (hostedRoute === null && !allowlisted) {
    return { workspaceId: undefined, ignoredReason: 'unconnected_repository' as const }
  }

  return {
    workspaceId: hostedRoute?.workspaceId ?? input.fallbackWorkspaceId,
    ignoredReason: undefined,
  }
}

function makeGitHubActor(installationId: number) {
  return {
    id: makeGitHubAppActorId(String(installationId)),
    displayName: `GitHub App installation ${installationId}`,
  }
}

const patchPlaneResultCommentEventKinds = new Set([
  'github.issue_comment.created',
  'github.pull_request_comment.created',
])

function isPatchPlaneResultComment(input: {
  readonly eventKind?: string | undefined
  readonly prompt: string
}) {
  return input.eventKind !== undefined &&
    patchPlaneResultCommentEventKinds.has(input.eventKind) &&
    input.prompt.trimStart().startsWith('PatchPlane sandbox run ')
}

export async function syncGitHubInstallation(request: Request, runtime: SourceControlRuntime) {
  const input = await runtime.runPromise(
    Effect.tryPromise({
      try: () => request.json(),
      catch: (cause) => new SourceControlWorkerRequestError({ message: `Invalid JSON body: ${String(cause)}` }),
    }).pipe(Effect.flatMap(Schema.decodeUnknownEffect(syncInstallationRequestSchema))),
  )

  const result = await runtime.runPromise(
    Effect.gen(function* () {
      const sourceControl = yield* SourceControlService
      const account = yield* sourceControl.getInstallationAccount({
        provider: 'github',
        installationId: input.installationId,
      })
      const repositories = yield* sourceControl.listInstallationRepositories({
        provider: 'github',
        installationId: input.installationId,
      })
      return { account, repositories }
    }),
  )

  return jsonResponse({
    account: {
      provider: 'github',
      installationId: result.account.installationId,
      accountExternalId: result.account.accountExternalId,
      accountLogin: result.account.accountLogin,
      ...(result.account.accountType === undefined ? {} : { accountType: result.account.accountType }),
    },
    repositories: result.repositories.map((repository) => ({
      provider: 'github' as const,
      installationId: repository.installationId,
      repositoryExternalId: repository.repositoryExternalId ?? repository.fullName,
      repositoryOwner: repository.owner,
      repositoryName: repository.name,
      repositoryFullName: repository.fullName,
      private: repository.private ?? false,
      selected: true,
    })),
  })
}

export async function controlRuntimeSession(request: Request, runtime: SourceControlRuntime) {
  const traceId = await randomTraceId(runtime)

  const inputExit = await runtime.runPromiseExit(
    Effect.tryPromise({
      try: () => request.json(),
      catch: (cause) => new SourceControlWorkerRequestError({ message: `Invalid JSON body: ${String(cause)}` }),
    }).pipe(Effect.flatMap(Schema.decodeUnknownEffect(runtimeControlRequestSchema))),
  )

  if (Exit.isFailure(inputExit)) {
    return jsonResponse({ ok: false, traceId, error: 'Invalid runtime control request' }, { status: 400 })
  }

  const input = inputExit.value
  const controlExit = await runtime.runPromiseExit(
    ControlRuntimeSession({
      workflowRunId: input.workflowRunId,
      operation: input.operation,
      ...(input.message === undefined ? {} : { message: input.message }),
      traceId,
    }).pipe(
      (effect) => withTelemetrySpan({
        traceId,
        workflowRunId: input.workflowRunId,
        operation: 'runtime.control',
        name: 'runtime.control',
      }, effect),
    ),
  )

  if (Exit.isFailure(controlExit)) {
    const error = publicErrorMessage(Cause.squash(controlExit.cause), 'Runtime control failed')
    await runtime.runPromise(Effect.logError('Runtime control failed', {
      traceId,
      workflowRunId: input.workflowRunId,
      operation: input.operation,
      cause: Cause.pretty(controlExit.cause),
      error,
    }))
    return jsonResponse({ ok: false, traceId, error }, { status: 500 })
  }

  return jsonResponse({ ok: true, traceId, status: controlExit.value.status })
}

export async function handleGitHubWebhook(request: Request, env: WorkerEnv, runtime: SourceControlRuntime) {
  const config = (() => {
    try {
      return loadSourceControlRouteConfig(env)
    } catch (error) {
      return error instanceof Error ? error : new Error(String(error))
    }
  })()

  if (config instanceof Error) {
    return jsonResponse({ ok: false, error: config.message }, { status: 500 })
  }

  const deliveryId = requiredHeader(request, 'x-github-delivery')
  const eventName = requiredHeader(request, 'x-github-event')
  const signature = requiredHeader(request, 'x-hub-signature-256')

  if (deliveryId === undefined || eventName === undefined || signature === undefined) {
    return jsonResponse(
      {
        ok: false,
        error: 'Missing required GitHub webhook headers: x-github-delivery, x-github-event, x-hub-signature-256',
      },
      { status: 400 },
    )
  }

  const traceId = await randomTraceId(runtime)
  const payload = await request.text()
  const routeConfig = (() => {
    try {
      return loadGitHubWebhookRouteConfig(config)
    } catch (error) {
      return error instanceof Error ? error : new Error(String(error))
    }
  })()

  if (routeConfig instanceof Error) {
    return jsonResponse({ ok: false, error: routeConfig.message }, { status: 500 })
  }

  const program = Effect.gen(function* () {
    const event = yield* IngestGitHubWebhook({ deliveryId, eventName, signature, payload })
    const repositoryFullName = `${event.owner}/${event.repo}`
    const secret = systemIngestionSecret(config)
    const resolvedRoute = yield* Effect.tryPromise({
      try: () => resolveGitHubWebhookWorkspace({
        repositoryFullName,
        fallbackWorkspaceId: routeConfig.workspaceId,
        repositoryAllowlist: routeConfig.repositoryAllowlist,
        lookupConnectedRepository: async () => {
          if (secret === undefined) return null
          const convex = new ConvexHttpClient(configuredConvexUrl(config))
          return await convex.query(lookupGitHubWebhookRoute, {
            systemSecret: secret,
            installationId: String(event.installationId),
            repositoryExternalId: String(event.repositoryId),
          })
        },
      }),
      catch: (cause) =>
        new SourceControlError({
          operation: 'githubWorker.lookupConnectedRepository',
          message: 'Convex failed to look up connected GitHub repository',
          cause,
        }),
    })

    if (resolvedRoute.ignoredReason === 'unconnected_repository') {
      yield* Effect.logInfo('Ignoring GitHub webhook for unconnected repository', {
        deliveryId,
        repository: repositoryFullName,
      })
      return {
        event,
        intake: undefined,
        workflowStart: undefined,
        sandboxExecution: undefined,
        publication: undefined,
        ignoredReason: 'unconnected_repository',
      }
    }

    const workspaceId = makeWorkspaceId(resolvedRoute.workspaceId)
    const intake = yield* GitHubEventToWorkflowIntake(event, {
      actor: makeGitHubActor(event.installationId),
      workspaceId,
      traceId,
    })

    if (isPatchPlaneResultComment({
      eventKind: intake.externalRef?.eventKind,
      prompt: intake.prompt,
    })) {
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
    const sandboxExecution = routeConfig.execution.mode === 'daytona-pi'
      ? yield* RunSandboxAgentForWorkflow({
          workflowStart,
          provider: routeConfig.execution.provider,
          model: routeConfig.execution.model,
          thinking: routeConfig.execution.thinking,
          mode: routeConfig.execution.piMode,
          timeoutSeconds: routeConfig.execution.timeoutSeconds,
        })
      : yield* RunSandboxCommandForWorkflow({
          workflowStart,
          command: routeConfig.execution.command,
          timeoutSeconds: routeConfig.execution.timeoutSeconds,
        })

    const publication = yield* PublishSandboxResultToSource({ workflowStart, sandboxExecution })
    return { event, intake, workflowStart, sandboxExecution, publication, ignoredReason: undefined }
  }).pipe(
    (effect) => withTelemetrySpan({
      traceId,
      operation: 'githubWorker.webhook',
      name: 'githubWorker.webhook',
      attributes: { deliveryId, eventName },
    }, effect),
    Effect.withLogSpan('githubWorker.webhook'),
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
        externalEventKind: exit.value.intake?.externalRef?.eventKind ?? exit.value.event.kind,
        sandboxExecutionId: exit.value.sandboxExecution?.id,
        sandboxStatus: exit.value.sandboxExecution?.status,
        publishedProvider: exit.value.publication?.provider,
        publishedIssueNumber: exit.value.publication?.issueNumber,
      },
      { status: 202 },
    )
  }

  const cause = Cause.squash(exit.cause)
  const error = publicErrorMessage(cause, 'GitHub webhook ingestion failed')

  await runtime.runPromise(
    captureTelemetryCause({
      traceId,
      operation: 'githubWorker.webhook',
      cause: exit.cause,
      message: 'GitHub webhook ingestion failed',
      attributes: { deliveryId, eventName },
    }),
  )

  console.error('githubWorker.webhook failed', {
    traceId,
    deliveryId,
    eventName,
    error,
    cause: Cause.pretty(exit.cause),
  })

  return jsonResponse({ ok: false, traceId, error }, { status: 400 })
}
