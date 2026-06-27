import { NodeServices } from '@effect/platform-node'
import { ConvexStoragePlugin } from '@patchplane/plugins/convex/storage-plugin'
import { DaytonaSandboxPlugin } from '@patchplane/plugins/daytona/sandbox-plugin'
import { DAYTONA_DEFAULT_COMMAND, DAYTONA_DEFAULT_COMMAND_TIMEOUT_SECONDS } from '@patchplane/plugins/daytona/config'
import { GitHubProviderPlugin } from '@patchplane/plugins/github/provider-plugin'
import { SentryTelemetryPlugin } from '@patchplane/plugins/sentry/telemetry-plugin'
import { ConvexHttpClient } from 'convex/browser'
import { makeFunctionReference } from 'convex/server'
import { Cause, Crypto, Effect, Exit, Layer, ManagedRuntime, Schema } from 'effect'
import { GitHubEventToWorkflowIntake } from '@patchplane/core/workflows/github-event-to-intake'
import { IngestGitHubWebhook } from '@patchplane/core/workflows/ingest-github-webhook'
import { PublishSandboxResultToSource } from '@patchplane/core/workflows/publish-sandbox-result-to-source'
import { RunSandboxAgentForWorkflow } from '@patchplane/core/workflows/run-sandbox-agent-for-workflow'
import { RunSandboxCommandForWorkflow } from '@patchplane/core/workflows/run-sandbox-command-for-workflow'
import { StartWorkflowFromIntake } from '@patchplane/core/workflows/start-workflow-from-intake'
import { SourceControlService } from '@patchplane/core/services/source-control-service'
import { captureTelemetryCause, withTelemetrySpan } from '@patchplane/core/services/telemetry-service'
import { SourceControlError, publicErrorMessage } from '@patchplane/domain/errors'
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

const SourceControlWorkerLayer = Layer.mergeAll(
  ConvexStoragePlugin.layer,
  GitHubProviderPlugin.layer,
  DaytonaSandboxPlugin.layer,
  SentryTelemetryPlugin.layer,
  NodeServices.layer,
)

const memoMap = Layer.makeMemoMapUnsafe()
const runtime = ManagedRuntime.make(SourceControlWorkerLayer, { memoMap })

class SourceControlWorkerRequestError extends Schema.ErrorClass<SourceControlWorkerRequestError>('SourceControlWorkerRequestError')({
  message: Schema.String,
}) {}

const syncInstallationRequestSchema = Schema.Struct({
  installationId: Schema.String,
  workspaceId: Schema.String,
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

function configuredConvexUrl() {
  const value = process.env.CONVEX_URL ?? process.env.VITE_CONVEX_URL
  if (value === undefined || value.trim().length === 0) {
    throw new Error('CONVEX_URL or VITE_CONVEX_URL is required')
  }
  return value.replace(/\/$/, '')
}

function systemIngestionSecret() {
  const value = process.env.PATCHPLANE_SYSTEM_INGESTION_SECRET?.trim()
  return value && value.length > 0 ? value : undefined
}

function internalWorkerToken() {
  const value = process.env.PATCHPLANE_INTERNAL_WORKER_TOKEN?.trim()
  if (!value) {
    throw new Error('PATCHPLANE_INTERNAL_WORKER_TOKEN is required')
  }
  return value
}

function assertInternalAuthorization(request: Request) {
  const authorization = request.headers.get('authorization')
  if (authorization !== `Bearer ${internalWorkerToken()}`) {
    return jsonResponse({ ok: false, error: 'Unauthorized' }, { status: 401 })
  }
  return undefined
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

function parseGitHubWorkspaceId() {
  const workspaceId = process.env.PATCHPLANE_GITHUB_WORKSPACE_ID?.trim()
  if (workspaceId) {
    return makeWorkspaceId(workspaceId)
  }

  const organizationId = process.env.PATCHPLANE_WORKOS_ORGANIZATION_ID?.trim()
  if (organizationId) {
    return makeWorkOSWorkspaceId(organizationId)
  }

  throw new Error(
    'PATCHPLANE_GITHUB_WORKSPACE_ID or PATCHPLANE_WORKOS_ORGANIZATION_ID is required for GitHub workflow ingestion',
  )
}

function providerApiKeyEnvName(provider: string) {
  const names: Readonly<Record<string, string>> = {
    anthropic: 'ANTHROPIC_API_KEY',
    openai: 'OPENAI_API_KEY',
    google: 'GEMINI_API_KEY',
    'github-copilot': 'COPILOT_GITHUB_TOKEN',
    openrouter: 'OPENROUTER_API_KEY',
  }
  return names[provider] ?? 'OPENAI_API_KEY'
}

function resolvePiExecutionConfig() {
  const cloudflareApiKey = process.env.CLOUDFLARE_API_KEY
  const cloudflareAccountId = process.env.CLOUDFLARE_ACCOUNT_ID
  const cloudflareGatewayId = process.env.CLOUDFLARE_GATEWAY_ID ?? process.env.PATCHPLANE_AI_GATEWAY_ID

  if (cloudflareApiKey !== undefined && cloudflareAccountId !== undefined && cloudflareGatewayId !== undefined) {
    return {
      provider: 'cloudflare-ai-gateway',
      model: process.env.PATCHPLANE_PI_MODEL ?? PATCHPLANE_DEFAULT_AGENT_MODEL,
      thinking: process.env.PATCHPLANE_PI_THINKING ?? PATCHPLANE_DEFAULT_AGENT_THINKING,
      apiKey: cloudflareApiKey,
      env: {
        CLOUDFLARE_ACCOUNT_ID: cloudflareAccountId,
        CLOUDFLARE_GATEWAY_ID: cloudflareGatewayId,
      },
      timeoutSeconds: DAYTONA_DEFAULT_COMMAND_TIMEOUT_SECONDS,
    } as const
  }

  const provider = process.env.PATCHPLANE_PI_PROVIDER ?? PATCHPLANE_DEFAULT_AGENT_PROVIDER
  return {
    provider,
    model: process.env.PATCHPLANE_PI_MODEL ?? PATCHPLANE_DEFAULT_AGENT_MODEL,
    thinking: process.env.PATCHPLANE_PI_THINKING ?? PATCHPLANE_DEFAULT_AGENT_THINKING,
    apiKey: process.env[providerApiKeyEnvName(provider)],
    env: undefined,
    timeoutSeconds: DAYTONA_DEFAULT_COMMAND_TIMEOUT_SECONDS,
  } as const
}

function loadGitHubWebhookRouteConfig() {
  const mode = process.env.PATCHPLANE_GITHUB_WEBHOOK_EXECUTION === 'daytona-command'
    ? 'daytona-command'
    : 'daytona-pi'

  if (mode === 'daytona-pi') {
    return {
      workspaceId: parseGitHubWorkspaceId(),
      repositoryAllowlist: parseRepositoryAllowlist(process.env.PATCHPLANE_GITHUB_ALLOWED_REPOSITORIES),
      execution: {
        mode,
        ...resolvePiExecutionConfig(),
      },
    } as const
  }

  return {
    workspaceId: parseGitHubWorkspaceId(),
    repositoryAllowlist: parseRepositoryAllowlist(process.env.PATCHPLANE_GITHUB_ALLOWED_REPOSITORIES),
    execution: {
      mode,
      command: DAYTONA_DEFAULT_COMMAND,
      timeoutSeconds: DAYTONA_DEFAULT_COMMAND_TIMEOUT_SECONDS,
    },
  } as const
}

async function randomTraceId() {
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

const PATCHPLANE_DEFAULT_AGENT_PROVIDER = 'openai'
const PATCHPLANE_DEFAULT_AGENT_MODEL = 'gpt-5.5'
const PATCHPLANE_DEFAULT_AGENT_THINKING = 'low'

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

export async function syncGitHubInstallation(request: Request) {
  const unauthorized = assertInternalAuthorization(request)
  if (unauthorized !== undefined) return unauthorized

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

export async function handleGitHubWebhook(request: Request) {
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

  const traceId = await randomTraceId()
  const payload = await request.text()
  const routeConfig = (() => {
    try {
      return loadGitHubWebhookRouteConfig()
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
    const secret = systemIngestionSecret()
    const resolvedRoute = yield* Effect.tryPromise({
      try: () => resolveGitHubWebhookWorkspace({
        repositoryFullName,
        fallbackWorkspaceId: routeConfig.workspaceId,
        repositoryAllowlist: routeConfig.repositoryAllowlist,
        lookupConnectedRepository: async () => {
          if (secret === undefined) return null
          const convex = new ConvexHttpClient(configuredConvexUrl())
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
          apiKey: routeConfig.execution.apiKey,
          env: routeConfig.execution.env,
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

