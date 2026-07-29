import { NodeServices } from '@effect/platform-node'
import { ArtifactsService } from '@patchplane/core/services/artifacts-service'
import {
  CloudflareR2ArtifactsPlugin,
  type R2BucketLike,
} from '@patchplane/plugins/cloudflare/r2-artifacts-plugin'
import { ConvexStoragePlugin } from '@patchplane/plugins/convex/storage-plugin'
import { DaytonaSandboxPlugin } from '@patchplane/plugins/daytona/sandbox-plugin'
import {
  DAYTONA_DEFAULT_COMMAND,
  DAYTONA_DEFAULT_COMMAND_TIMEOUT_SECONDS,
} from '@patchplane/plugins/daytona/config'
import { GitHubProviderPlugin } from '@patchplane/plugins/github/provider-plugin'
import { CloudflareTelemetryPlugin } from '@patchplane/plugins/sentry/cloudflare-telemetry-plugin'
import { ConvexHttpClient } from 'convex/browser'
import { makeFunctionReference } from 'convex/server'
import {
  Cause,
  Crypto,
  Effect,
  Exit,
  Layer,
  ManagedRuntime,
  Option,
  Redacted,
  Schema,
} from 'effect'
import {
  PATCHPLANE_DEFAULT_AGENT_PROVIDER,
  loadSourceControlRouteConfig,
  sourceControlConfigLayer,
  type SourceControlRouteConfig as SourceControlRouteConfigType,
  type WorkerEnv,
} from './config'
import { GitHubEventToWorkflowIntake } from '@patchplane/core/workflows/github-event-to-intake'
import { NormalizeGitHubWebhookEvent } from '@patchplane/core/github/normalize-github-webhook-event'
import { GitHubWebhookService } from '@patchplane/core/services/github-webhook-service'
import { ControlRuntimeSession } from '@patchplane/core/workflows/control-runtime-session'
import { AssemblePatchReportV1 } from '@patchplane/core/patch-report/assemble-patch-report-v1'
import { PublishDecisionToSource } from '@patchplane/core/workflows/publish-decision-to-source'
import { PublishSandboxResultToSource } from '@patchplane/core/workflows/publish-sandbox-result-to-source'
import {
  ClaimIncomingPullRequestDispatch,
  FreezeIncomingPullRequestCandidate,
  type IncomingPullRequestDispatch,
} from '@patchplane/core/workflows/freeze-incoming-pull-request-candidate'
import { RunIncomingVerificationPlan } from '@patchplane/core/workflows/run-incoming-verification-plan'
import { RunSandboxAgentForWorkflow } from '@patchplane/core/workflows/run-sandbox-agent-for-workflow'
import { RunSandboxCommandForWorkflow } from '@patchplane/core/workflows/run-sandbox-command-for-workflow'
import { PersistConfiguredVerificationRequirements } from '@patchplane/core/workflows/persist-sandbox-verification-evidence'
import { StartWorkflowFromIntake } from '@patchplane/core/workflows/start-workflow-from-intake'
import { SourceControlService } from '@patchplane/core/services/source-control-service'
import {
  AlphaPolicyServiceLayer,
  AlphaReviewServiceLayer,
} from '@patchplane/core/services/alpha-review-policy'
import { withTelemetrySpan } from '@patchplane/core/services/telemetry-service'
import {
  ArtifactsError,
  SourceControlError,
  publicErrorMessage,
} from '@patchplane/domain/errors'
import {
  CandidatePatchSet,
  HumanDecision,
  PolicyDecision,
  PublicationResult,
  ReviewFinding,
  ReviewRun,
} from '@patchplane/domain/decision-review'
import { EvidenceArtifact } from '@patchplane/domain/evidence-artifact'
import {
  HumanDecisionId,
  WorkspaceId,
  WorkflowRunId,
  makeGitHubAppActorId,
  makeWorkspaceId,
  makeWorkOSWorkspaceId,
} from '@patchplane/domain/ids'
import { SandboxExecution } from '@patchplane/domain/sandbox-execution'
import {
  VerificationPlanRequirementV1,
  VerificationRequirement,
  VerificationResult,
} from '@patchplane/domain/verification'
import { GitCommitSha } from '@patchplane/domain/refinements'
import { WorkflowStart } from '@patchplane/domain/workflow-start'
import { withCapturedCriticalPathScope } from '../critical-path-telemetry'

type SandboxExecutionValue = Schema.Schema.Type<typeof SandboxExecution>

const hostedVerificationAggregateLimitSeconds = 14 * 60
const hostedVerificationCommandLimitSeconds = 30
const internalJsonMaxBytes = 16 * 1024

async function readBoundedJson(request: Request): Promise<unknown | undefined> {
  const declared = request.headers.get('content-length')
  if (declared !== null) {
    const size = Number(declared)
    if (!Number.isSafeInteger(size) || size < 0 || size > internalJsonMaxBytes) {
      return undefined
    }
  }
  const contentType = request.headers.get('content-type') ?? ''
  if (!/^application\/json(?:\s*;|$)/i.test(contentType)) return undefined
  const reader = request.body?.getReader()
  if (reader === undefined) return undefined
  const chunks: Array<Uint8Array> = []
  let size = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.byteLength
    if (size > internalJsonMaxBytes) {
      await reader.cancel().catch(() => undefined)
      return undefined
    }
    chunks.push(value)
  }
  const bytes = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  try {
    return JSON.parse(
      new TextDecoder('utf-8', { fatal: true }).decode(bytes),
    ) as unknown
  } catch {
    return undefined
  }
}

const noIncomingDispatch: Effect.Effect<
  IncomingPullRequestDispatch | undefined
> = Effect.void.pipe(Effect.as(undefined))

const ConfiguredWorkspaceVerificationPolicy = Schema.Struct({
  workspaceId: WorkspaceId,
  revision: Schema.NonEmptyString,
  requirements: Schema.Array(VerificationPlanRequirementV1),
})
const ConfiguredBaseRepositoryVerificationPolicy = Schema.Struct({
  repositoryFullName: Schema.NonEmptyString,
  revision: Schema.NonEmptyString,
  requirements: Schema.Array(VerificationPlanRequirementV1),
})

const loadConfiguredVerificationPolicyLayers = Effect.fnUntraced(function* (
  config: {
    readonly workspaceVerificationPolicyJson: string
    readonly baseRepositoryVerificationPolicyJson: string
  },
  workflowStart: Schema.Schema.Type<typeof WorkflowStart>,
) {
  const decodeJson = <A>(
    value: string,
    decode: (input: unknown) => Effect.Effect<A, unknown>,
    label: string,
  ) =>
    value.trim().length === 0
      ? Effect.void
      : new TextEncoder().encode(value).byteLength > 65_536
        ? Effect.fail(
            new SourceControlWorkerRequestError({
              message: `${label} exceeds the 65536-byte policy limit`,
            }),
          )
        : Effect.try({
            try: () => JSON.parse(value) as unknown,
            catch: (cause) =>
              new SourceControlWorkerRequestError({
                message: `${label} is not valid JSON: ${String(cause)}`,
              }),
          }).pipe(
            Effect.flatMap(decode),
            Effect.mapError(
              () =>
                new SourceControlWorkerRequestError({
                  message: `${label} failed trusted policy validation`,
                }),
            ),
          )

  const workspace = yield* decodeJson(
    config.workspaceVerificationPolicyJson,
    Schema.decodeUnknownEffect(ConfiguredWorkspaceVerificationPolicy),
    'PATCHPLANE_WORKSPACE_VERIFICATION_POLICY_JSON',
  )
  const baseRepository = yield* decodeJson(
    config.baseRepositoryVerificationPolicyJson,
    Schema.decodeUnknownEffect(ConfiguredBaseRepositoryVerificationPolicy),
    'PATCHPLANE_BASE_REPOSITORY_VERIFICATION_POLICY_JSON',
  )
  const externalRef = workflowStart.promptRequest.externalRef
  const baseSha =
    workflowStart.workflowRun.sourceBaseSha === undefined
      ? undefined
      : yield* Schema.decodeUnknownEffect(GitCommitSha)(
          workflowStart.workflowRun.sourceBaseSha,
        ).pipe(
          Effect.mapError(
            () =>
              new SourceControlWorkerRequestError({
                message: 'Workflow base SHA is invalid for trusted policy',
              }),
          ),
        )
  return {
    ...(workspace?.workspaceId !== workflowStart.workflowRun.workspaceId
      ? {}
      : {
          workspacePolicy: {
            source: {
              kind: 'workspace-policy' as const,
              workspaceId: workspace.workspaceId,
              revision: workspace.revision,
            },
            requirements: workspace.requirements,
          },
        }),
    ...(baseRepository === undefined ||
    externalRef?.repositoryFullName !== baseRepository.repositoryFullName ||
    baseSha === undefined
      ? {}
      : {
          baseRepositoryPolicy: {
            source: {
              kind: 'base-repository-policy' as const,
              repositoryFullName: baseRepository.repositoryFullName,
              baseSha,
              revision: baseRepository.revision,
            },
            requirements: baseRepository.requirements,
          },
        }),
  }
})

const lookupGitHubWebhookRoute = makeFunctionReference<
  'query',
  {
    systemSecret: string
    installationId: string
    repositoryExternalId: string
  },
  unknown
>('connectedRepositories:lookupGitHubWebhookRoute')

const MissingR2ArtifactsLayer = Layer.succeed(
  ArtifactsService,
  ArtifactsService.of({
    putArtifact: () =>
      Effect.fail(
        new ArtifactsError({
          operation: 'r2.config',
          message:
            'PATCHPLANE_EVIDENCE_BUCKET binding is required to store artifacts',
          cause: undefined,
        }),
      ),
    getArtifactMetadata: () =>
      Effect.fail(
        new ArtifactsError({
          operation: 'r2.config',
          message:
            'PATCHPLANE_EVIDENCE_BUCKET binding is required to read artifacts',
          cause: undefined,
        }),
      ),
    createSignedReadUrl: () =>
      Effect.fail(
        new ArtifactsError({
          operation: 'r2.config',
          message:
            'PATCHPLANE_EVIDENCE_BUCKET binding is required to sign artifacts',
          cause: undefined,
        }),
      ),
    deleteArtifact: () =>
      Effect.fail(
        new ArtifactsError({
          operation: 'r2.config',
          message:
            'PATCHPLANE_EVIDENCE_BUCKET binding is required to delete artifacts',
          cause: undefined,
        }),
      ),
    applyRetentionPolicy: () =>
      Effect.fail(
        new ArtifactsError({
          operation: 'r2.config',
          message:
            'PATCHPLANE_EVIDENCE_BUCKET binding is required to update artifact retention',
          cause: undefined,
        }),
      ),
  }),
)

function sourceControlWorkerLayer(env: WorkerEnv) {
  const bucket = env.PATCHPLANE_EVIDENCE_BUCKET as R2BucketLike | undefined
  const artifactsLayer =
    bucket === undefined
      ? MissingR2ArtifactsLayer
      : CloudflareR2ArtifactsPlugin.layerFromBucket(bucket).pipe(
          Layer.provide(NodeServices.layer),
        )

  return Layer.mergeAll(
    ConvexStoragePlugin.layer,
    GitHubProviderPlugin.layer,
    DaytonaSandboxPlugin.layer,
    AlphaReviewServiceLayer,
    AlphaPolicyServiceLayer,
    CloudflareTelemetryPlugin.layer,
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
    sourceControlWorkerLayer(env).pipe(
      Layer.provide(sourceControlConfigLayer(env)),
    ),
    { memoMap: Layer.makeMemoMapUnsafe() },
  )
}

class SourceControlWorkerRequestError extends Schema.ErrorClass<SourceControlWorkerRequestError>(
  'SourceControlWorkerRequestError',
)({
  message: Schema.String,
  cause: Schema.optional(Schema.Defect()),
}) {}

const syncInstallationRequestSchema = Schema.Struct({
  installationId: Schema.NonEmptyString,
  workspaceId: WorkspaceId,
})

const connectedRepositoryRouteSchema = Schema.NullOr(
  Schema.Struct({
    workspaceId: WorkspaceId,
    repositoryFullName: Schema.NonEmptyString,
    status: Schema.NonEmptyString,
  }),
)

const rerunExecutionRequestSchema = Schema.Struct({
  traceId: Schema.String,
  workflowRunId: WorkflowRunId,
})

const runtimeControlRequestSchema = Schema.Struct({
  workflowRunId: WorkflowRunId,
  operation: Schema.Literals(['abort', 'steer', 'followUp', 'terminate']),
  message: Schema.optional(Schema.String),
})

const publishDecisionRequestSchema = Schema.Struct({
  traceId: Schema.String,
  workflowRunId: Schema.optional(WorkflowRunId),
  humanDecisionId: Schema.optional(HumanDecisionId),
  // Accepted only during the client contract migration. These values are used
  // to locate authoritative records and are never used as publication facts.
  workflowStart: Schema.optional(Schema.Unknown),
  humanDecision: Schema.optional(Schema.Unknown),
})

const decisionPublicationFixtureSchema = Schema.Struct({
  workflowStart: WorkflowStart,
  humanDecision: HumanDecision,
  sandboxExecution: Schema.optional(SandboxExecution),
  candidatePatchSet: Schema.optional(CandidatePatchSet),
  verificationRequirements: Schema.Array(VerificationRequirement),
  verificationResults: Schema.Array(VerificationResult),
  reviewRun: Schema.optional(ReviewRun),
  reviewFindings: Schema.Array(ReviewFinding),
  policyDecision: Schema.optional(PolicyDecision),
  evidenceArtifacts: Schema.Array(EvidenceArtifact),
  trustDataTruncated: Schema.Boolean,
  evidenceTruncated: Schema.Boolean,
  verification: Schema.Struct({
    status: Schema.Literals([
      'not-configured',
      'incomplete',
      'passed',
      'failed',
    ]),
    requiredCount: Schema.Finite,
    passedCount: Schema.Finite,
  }),
  candidateHeadSha: Schema.optional(Schema.String),
  publicationResults: Schema.Array(PublicationResult),
})

const bindQueuedGitHubDeliveryToWorkflowMutation = makeFunctionReference<
  'mutation',
  {
    systemSecret: string
    deliveryId: string
    workflowRunId: string
    repositoryExternalId: string
    issueExternalId: string
    pullRequestBaseSha: string
    pullRequestHeadSha: string
  },
  'bound' | 'coalesced' | 'rejected'
>('workflowStarts:bindQueuedGitHubDeliveryToWorkflow')

const terminalizeQueuedGitHubDeliveryMutation = makeFunctionReference<
  'mutation',
  {
    systemSecret: string
    deliveryId: string
    deliveryToken: string
    processingToken: string
  },
  { readonly terminalized: boolean; readonly workflowRunId?: string }
>('workflowStarts:terminalizeQueuedGitHubDelivery')

const markWorkflowExecutionFailedMutation = makeFunctionReference<
  'mutation',
  { systemSecret: string; workflowRunId: string; summary: string },
  boolean
>('workflowStarts:markWorkflowExecutionFailed')

const getWorkflowExecutionFixtureQuery = makeFunctionReference<
  'query',
  { systemSecret: string; workflowRunId: string },
  unknown
>('workflowStarts:getWorkflowExecutionFixture')

const getDecisionPublicationFixtureQuery = makeFunctionReference<
  'query',
  { systemSecret: string; workflowRunId: string; humanDecisionId: string },
  unknown
>('workflowStarts:getDecisionPublicationReplayFixture')

function jsonResponse(body: unknown, init?: ResponseInit) {
  const headers = new Headers(init?.headers)
  headers.set('content-type', 'application/json')
  return new Response(JSON.stringify(body), { ...init, headers })
}

function nestedString(value: unknown, ...path: ReadonlyArray<string>) {
  let current: unknown = value
  for (const key of path) {
    if (typeof current !== 'object' || current === null || !(key in current))
      return undefined
    current = Reflect.get(current, key)
  }
  return typeof current === 'string' && current.length > 0 ? current : undefined
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
    throw new Error(
      'PATCHPLANE_GITHUB_ALLOWED_REPOSITORIES is required for GitHub workflow ingestion',
    )
  }

  const repositories = value
    .split(',')
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean)

  if (repositories.length === 0) {
    throw new Error(
      'PATCHPLANE_GITHUB_ALLOWED_REPOSITORIES must include at least one owner/repo entry',
    )
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
  const provider =
    config.piProvider.trim() ||
    (Option.isSome(config.cloudflareApiKey) &&
    config.cloudflareAccountId.trim().length > 0 &&
    config.cloudflareGatewayId.trim().length > 0
      ? 'cloudflare-ai-gateway'
      : PATCHPLANE_DEFAULT_AGENT_PROVIDER)

  return {
    provider,
    model: config.piModel,
    thinking: config.piThinking,
    piMode: config.piMode === 'rpc' ? 'rpc' : 'json',
    timeoutSeconds: DAYTONA_DEFAULT_COMMAND_TIMEOUT_SECONDS,
  } as const
}

function resolveEvidenceCaptureConfig(config: SourceControlRouteConfigType) {
  const testReportCommand = config.evidenceTestReportCommand.trim()
  const browserScreenshotCommand =
    config.evidenceBrowserScreenshotCommand.trim()
  const testPlatform = config.evidenceTestPlatform
  return {
    ...(testReportCommand.length === 0
      ? {}
      : {
          evidenceTestReportCommand: testReportCommand,
          evidenceTestPlatform: testPlatform,
        }),
    ...(browserScreenshotCommand.length === 0
      ? {}
      : { evidenceBrowserScreenshotCommand: browserScreenshotCommand }),
  }
}

const loadGitHubWebhookRouteConfig = Effect.fnUntraced(function* (
  config: SourceControlRouteConfigType,
) {
  return yield* Effect.try({
    try: () => {
      const workspaceId = parseGitHubWorkspaceId(config)
      const repositoryAllowlist = parseRepositoryAllowlist(
        config.repositoryAllowlist,
      )

      if (config.webhookExecution === 'daytona-pi') {
        return {
          workspaceId,
          repositoryAllowlist,
          workspaceVerificationPolicyJson:
            config.workspaceVerificationPolicyJson,
          baseRepositoryVerificationPolicyJson:
            config.baseRepositoryVerificationPolicyJson,
          execution: {
            mode: config.webhookExecution,
            ...resolvePiExecutionConfig(config),
            ...resolveEvidenceCaptureConfig(config),
          },
        } as const
      }

      return {
        workspaceId,
        repositoryAllowlist,
        workspaceVerificationPolicyJson: config.workspaceVerificationPolicyJson,
        baseRepositoryVerificationPolicyJson:
          config.baseRepositoryVerificationPolicyJson,
        execution: {
          mode: config.webhookExecution,
          command: DAYTONA_DEFAULT_COMMAND,
          timeoutSeconds: DAYTONA_DEFAULT_COMMAND_TIMEOUT_SECONDS,
          ...resolveEvidenceCaptureConfig(config),
        },
      } as const
    },
    catch: (cause) =>
      new SourceControlWorkerRequestError({
        message: 'GitHub webhook route configuration is invalid',
        cause,
      }),
  })
})

async function randomTraceId(runtime: SourceControlRuntime) {
  return await runtime.runPromise(
    Effect.gen(function* () {
      const crypto = yield* Crypto.Crypto
      return yield* crypto.randomUUIDv4
    }),
  )
}

function resolveGitHubWebhookWorkspace(input: {
  readonly repositoryFullName: string
  readonly fallbackWorkspaceId: WorkspaceId
  readonly repositoryAllowlist: ReadonlySet<string>
  readonly hostedRoute: { readonly workspaceId: WorkspaceId } | null
}) {
  const allowlisted = input.repositoryAllowlist.has(
    input.repositoryFullName.toLowerCase(),
  )

  if (input.hostedRoute === null && !allowlisted) {
    return {
      workspaceId: undefined,
      ignoredReason: 'unconnected_repository' as const,
    }
  }

  return {
    workspaceId: input.hostedRoute?.workspaceId ?? input.fallbackWorkspaceId,
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
  const prompt = input.prompt.trimStart()
  return (
    input.eventKind !== undefined &&
    patchPlaneResultCommentEventKinds.has(input.eventKind) &&
    (prompt.startsWith('PatchPlane sandbox run ') ||
      prompt.startsWith('## PatchPlane Patch Report') ||
      prompt.startsWith('## PatchPlane Decision Update'))
  )
}

export async function markQueuedDeliveryExhausted(
  request: Request,
  env: WorkerEnv,
  runtime: SourceControlRuntime,
) {
  const input = await readBoundedJson(request)
  const fields =
    input !== null && typeof input === 'object'
      ? (input as Record<string, unknown>)
      : undefined
  const deliveryId =
    typeof fields?.deliveryId === 'string' ? fields.deliveryId : undefined
  const deliveryToken =
    typeof fields?.deliveryToken === 'string' ? fields.deliveryToken : undefined
  const processingToken =
    typeof fields?.processingToken === 'string'
      ? fields.processingToken
      : undefined
  if (
    deliveryId === undefined ||
    deliveryId.length === 0 ||
    deliveryId.length > 128 ||
    deliveryToken === undefined ||
    deliveryToken.length === 0 ||
    deliveryToken.length > 128 ||
    processingToken === undefined ||
    processingToken.length === 0 ||
    processingToken.length > 128
  ) {
    return jsonResponse(
      { ok: false, error: 'Invalid delivery identity' },
      { status: 400 },
    )
  }
  const configExit = await runtime.runPromiseExit(
    loadSourceControlRouteConfig(env),
  )
  if (Exit.isFailure(configExit)) {
    return jsonResponse(
      { ok: false, error: 'Source-control configuration is invalid' },
      { status: 500 },
    )
  }
  const secret = Redacted.value(configExit.value.systemIngestionSecret)
  if (secret.length === 0) {
    return jsonResponse(
      { ok: false, error: 'System ingestion is not configured' },
      { status: 500 },
    )
  }
  const terminal = await new ConvexHttpClient(
    configuredConvexUrl(configExit.value),
  ).mutation(terminalizeQueuedGitHubDeliveryMutation, {
    systemSecret: secret,
    deliveryId,
    deliveryToken,
    processingToken,
  })
  return jsonResponse({ ok: true, ...terminal }, { status: 200 })
}

export async function syncGitHubInstallation(
  request: Request,
  runtime: SourceControlRuntime,
) {
  const inputExit = await runtime.runPromiseExit(
    Effect.tryPromise({
      try: () => request.json(),
      catch: (cause) =>
        new SourceControlWorkerRequestError({
          message: `Invalid JSON body: ${String(cause)}`,
        }),
    }).pipe(
      Effect.flatMap(Schema.decodeUnknownEffect(syncInstallationRequestSchema)),
    ),
  )
  if (Exit.isFailure(inputExit)) {
    return jsonResponse(
      { ok: false, error: 'Invalid installation sync request' },
      { status: 400 },
    )
  }
  const input = inputExit.value

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
      ...(result.account.accountType === undefined
        ? {}
        : { accountType: result.account.accountType }),
    },
    repositories: result.repositories.map((repository) => ({
      provider: 'github' as const,
      installationId: repository.installationId,
      repositoryExternalId:
        repository.repositoryExternalId ?? repository.fullName,
      repositoryOwner: repository.owner,
      repositoryName: repository.name,
      repositoryFullName: repository.fullName,
      private: repository.private ?? false,
      selected: true,
    })),
  })
}

export async function controlRuntimeSession(
  request: Request,
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
      Effect.flatMap(Schema.decodeUnknownEffect(runtimeControlRequestSchema)),
    ),
  )

  if (Exit.isFailure(inputExit)) {
    return jsonResponse(
      { ok: false, traceId, error: 'Invalid runtime control request' },
      { status: 400 },
    )
  }

  const input = inputExit.value
  const controlExit = await runtime.runPromiseExit(
    ControlRuntimeSession({
      workflowRunId: input.workflowRunId,
      operation: input.operation,
      ...(input.message === undefined ? {} : { message: input.message }),
      traceId,
    }).pipe((effect) =>
      withTelemetrySpan(
        {
          traceId,
          workflowRunId: input.workflowRunId,
          operation: 'runtime.control',
          name: 'runtime.control',
        },
        effect,
      ),
    ),
  )

  if (Exit.isFailure(controlExit)) {
    const error = publicErrorMessage(
      Cause.squash(controlExit.cause),
      'Runtime control failed',
    )
    await runtime.runPromise(
      Effect.logError('Runtime control failed', {
        traceId,
        workflowRunId: input.workflowRunId,
        operation: input.operation,
        cause: Cause.pretty(controlExit.cause),
        error,
      }),
    )
    return jsonResponse({ ok: false, traceId, error }, { status: 500 })
  }

  return jsonResponse({ ok: true, traceId, status: controlExit.value.status })
}

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

export async function publishDecision(
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
      Effect.flatMap(Schema.decodeUnknownEffect(publishDecisionRequestSchema)),
    ),
  )

  if (Exit.isFailure(inputExit)) {
    return jsonResponse(
      { ok: false, traceId, error: 'Invalid decision publication request' },
      { status: 400 },
    )
  }

  const input = inputExit.value
  const workflowRunId =
    input.workflowRunId ??
    nestedString(input.workflowStart, 'workflowRun', 'id')
  const humanDecisionId =
    input.humanDecisionId ?? nestedString(input.humanDecision, 'id')
  if (workflowRunId === undefined || humanDecisionId === undefined) {
    return jsonResponse(
      { ok: false, traceId, error: 'Workflow and human decision IDs required' },
      { status: 400 },
    )
  }

  const routeConfigExit = await runtime.runPromiseExit(
    loadSourceControlRouteConfig(env),
  )
  if (Exit.isFailure(routeConfigExit)) {
    return jsonResponse(
      { ok: false, traceId, error: 'Decision publication is not configured' },
      { status: 503 },
    )
  }
  const routeConfig = routeConfigExit.value
  const secret = systemIngestionSecret(routeConfig)
  if (secret === undefined) {
    return jsonResponse(
      { ok: false, traceId, error: 'Decision publication is not configured' },
      { status: 503 },
    )
  }
  const fixtureExit = await runtime.runPromiseExit(
    Effect.tryPromise({
      try: () =>
        new ConvexHttpClient(configuredConvexUrl(routeConfig)).query(
          getDecisionPublicationFixtureQuery,
          { systemSecret: secret, workflowRunId, humanDecisionId },
        ),
      catch: (cause) =>
        new SourceControlWorkerRequestError({
          message: `Unable to load decision publication evidence: ${String(cause)}`,
        }),
    }).pipe(
      Effect.flatMap(
        Schema.decodeUnknownEffect(decisionPublicationFixtureSchema),
      ),
    ),
  )
  if (Exit.isFailure(fixtureExit)) {
    return jsonResponse(
      {
        ok: false,
        traceId,
        error: 'Authoritative decision evidence unavailable',
      },
      { status: 409 },
    )
  }
  const fixture = fixtureExit.value
  const patchReportExit =
    fixture.workflowStart.workflowRun.modelVersion === 'v1'
      ? await runtime.runPromiseExit(
          AssemblePatchReportV1({
            workflowStart: fixture.workflowStart,
            sandboxExecutions:
              fixture.sandboxExecution === undefined
                ? []
                : [fixture.sandboxExecution],
            candidatePatchSets:
              fixture.candidatePatchSet === undefined
                ? []
                : [fixture.candidatePatchSet],
            verificationRequirements: fixture.verificationRequirements,
            verificationResults: fixture.verificationResults,
            reviewRuns:
              fixture.reviewRun === undefined ? [] : [fixture.reviewRun],
            reviewFindings: fixture.reviewFindings,
            policyDecisions:
              fixture.policyDecision === undefined
                ? []
                : [fixture.policyDecision],
            humanDecisions: [fixture.humanDecision],
            evidenceArtifacts: fixture.evidenceArtifacts,
            publicationResults: fixture.publicationResults,
            trustDataTruncated: fixture.trustDataTruncated,
            evidenceTruncated: fixture.evidenceTruncated,
          }),
        )
      : undefined
  if (patchReportExit !== undefined && Exit.isFailure(patchReportExit)) {
    return jsonResponse(
      { ok: false, traceId, error: 'Canonical Patch Report assembly failed' },
      { status: 409 },
    )
  }
  const patchReport =
    patchReportExit !== undefined && Exit.isSuccess(patchReportExit)
      ? patchReportExit.value
      : undefined
  const publicationExit = await runtime.runPromiseExit(
    PublishDecisionToSource({
      traceId: input.traceId,
      workflowStart: fixture.workflowStart,
      humanDecision: fixture.humanDecision,
      ...(fixture.sandboxExecution === undefined
        ? {}
        : { sandboxExecution: fixture.sandboxExecution }),
      ...(fixture.candidatePatchSet === undefined
        ? {}
        : { candidatePatchSet: fixture.candidatePatchSet }),
      ...(patchReport === undefined ? {} : { patchReport }),
      verification: fixture.verification,
      publicationResults: fixture.publicationResults,
    }).pipe(
      (effect) =>
        withTelemetrySpan(
          {
            traceId: input.traceId,
            workflowRunId,
            operation: 'githubWorker.publishDecision',
            name: 'githubWorker.publishDecision',
          },
          effect,
        ),
      (effect) =>
        withCapturedCriticalPathScope(
          {
            traceId: input.traceId,
            workflowRunId,
            operation: 'githubWorker.publishDecision',
            message: 'Decision publication failed',
          },
          effect,
        ),
    ),
  )

  if (Exit.isFailure(publicationExit)) {
    const error = publicErrorMessage(
      Cause.squash(publicationExit.cause),
      'Decision publication failed',
    )
    await runtime.runPromise(
      Effect.logError('Decision publication failed', {
        traceId: input.traceId,
        cause: Cause.pretty(publicationExit.cause),
        error,
      }),
    )
    return jsonResponse(
      { ok: false, traceId: input.traceId, error },
      { status: 500 },
    )
  }

  const failed = publicationExit.value.publications.filter(
    (publication) => publication.status === 'failed',
  )
  if (failed.length > 0) {
    return jsonResponse(
      {
        ok: false,
        traceId: input.traceId,
        publications: publicationExit.value.publications,
        error: failed
          .map(
            (publication) =>
              publication.error ?? publication.summary ?? publication.kind,
          )
          .join('; '),
      },
      { status: 500 },
    )
  }

  return jsonResponse({
    ok: true,
    traceId: input.traceId,
    publications: publicationExit.value.publications,
  })
}

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
