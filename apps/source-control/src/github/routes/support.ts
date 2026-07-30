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
import { makeFunctionReference } from 'convex/server'
import {
  Crypto,
  Effect,
  Layer,
  ManagedRuntime,
  Option,
  Redacted,
  Schema,
} from 'effect'
import {
  PATCHPLANE_DEFAULT_AGENT_PROVIDER,
  sourceControlConfigLayer,
  type SourceControlRouteConfig as SourceControlRouteConfigType,
  type WorkerEnv,
} from '../config'
import { type IncomingPullRequestDispatch } from '@patchplane/core/workflows/freeze-incoming-pull-request-candidate'
import {
  AlphaPolicyServiceLayer,
  AlphaReviewServiceLayer,
} from '@patchplane/core/services/alpha-review-policy'
import { ArtifactsError } from '@patchplane/domain/errors'
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

export type SandboxExecutionValue = Schema.Schema.Type<typeof SandboxExecution>

export const hostedVerificationAggregateLimitSeconds = 14 * 60

export const hostedVerificationCommandLimitSeconds = 30

const internalJsonMaxBytes = 16 * 1024

export async function readBoundedJson(
  request: Request,
): Promise<unknown | undefined> {
  const declared = request.headers.get('content-length')
  if (declared !== null) {
    const size = Number(declared)
    if (
      !Number.isSafeInteger(size) ||
      size < 0 ||
      size > internalJsonMaxBytes
    ) {
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

export const noIncomingDispatch: Effect.Effect<
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

export const loadConfiguredVerificationPolicyLayers = Effect.fnUntraced(
  function* (
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
  },
)

export const lookupGitHubWebhookRoute = makeFunctionReference<
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

export type SourceControlRuntime = ManagedRuntime.ManagedRuntime<
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

export class SourceControlWorkerRequestError extends Schema.ErrorClass<SourceControlWorkerRequestError>(
  'SourceControlWorkerRequestError',
)({
  message: Schema.String,
  cause: Schema.optional(Schema.Defect()),
}) {}

export const syncInstallationRequestSchema = Schema.Struct({
  installationId: Schema.NonEmptyString,
  workspaceId: WorkspaceId,
})

export const connectedRepositoryRouteSchema = Schema.NullOr(
  Schema.Struct({
    workspaceId: WorkspaceId,
    repositoryFullName: Schema.NonEmptyString,
    status: Schema.NonEmptyString,
  }),
)

export const rerunExecutionRequestSchema = Schema.Struct({
  traceId: Schema.String,
  workflowRunId: WorkflowRunId,
})

export const runtimeControlRequestSchema = Schema.Struct({
  workflowRunId: WorkflowRunId,
  operation: Schema.Literals(['abort', 'steer', 'followUp', 'terminate']),
  message: Schema.optional(Schema.String),
})

export const publishDecisionRequestSchema = Schema.Struct({
  traceId: Schema.String,
  workflowRunId: Schema.optional(WorkflowRunId),
  humanDecisionId: Schema.optional(HumanDecisionId),
  // Accepted only during the client contract migration. These values are used
  // to locate authoritative records and are never used as publication facts.
  workflowStart: Schema.optional(Schema.Unknown),
  humanDecision: Schema.optional(Schema.Unknown),
})

export const decisionPublicationFixtureSchema = Schema.Struct({
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

export const bindQueuedGitHubDeliveryToWorkflowMutation = makeFunctionReference<
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

export const terminalizeQueuedGitHubDeliveryMutation = makeFunctionReference<
  'mutation',
  {
    systemSecret: string
    deliveryId: string
    deliveryToken: string
    processingToken: string
  },
  { readonly terminalized: boolean; readonly workflowRunId?: string }
>('workflowStarts:terminalizeQueuedGitHubDelivery')

export const markWorkflowExecutionFailedMutation = makeFunctionReference<
  'mutation',
  { systemSecret: string; workflowRunId: string; summary: string },
  boolean
>('workflowStarts:markWorkflowExecutionFailed')

export const getWorkflowExecutionFixtureQuery = makeFunctionReference<
  'query',
  { systemSecret: string; workflowRunId: string },
  unknown
>('workflowStarts:getWorkflowExecutionFixture')

export const getDecisionPublicationFixtureQuery = makeFunctionReference<
  'query',
  { systemSecret: string; workflowRunId: string; humanDecisionId: string },
  unknown
>('workflowStarts:getDecisionPublicationReplayFixture')

export function jsonResponse(body: unknown, init?: ResponseInit) {
  const headers = new Headers(init?.headers)
  headers.set('content-type', 'application/json')
  return new Response(JSON.stringify(body), { ...init, headers })
}

export function nestedString(value: unknown, ...path: ReadonlyArray<string>) {
  let current: unknown = value
  for (const key of path) {
    if (typeof current !== 'object' || current === null || !(key in current))
      return undefined
    current = Reflect.get(current, key)
  }
  return typeof current === 'string' && current.length > 0 ? current : undefined
}

export function requiredHeader(request: Request, name: string) {
  const value = request.headers.get(name)
  return value === null || value.length === 0 ? undefined : value
}

export function configuredConvexUrl(config: SourceControlRouteConfigType) {
  return config.convexUrl.replace(/\/$/, '')
}

export function systemIngestionSecret(config: SourceControlRouteConfigType) {
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

export const loadGitHubWebhookRouteConfig = Effect.fnUntraced(function* (
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

export async function randomTraceId(runtime: SourceControlRuntime) {
  return await runtime.runPromise(
    Effect.gen(function* () {
      const crypto = yield* Crypto.Crypto
      return yield* crypto.randomUUIDv4
    }),
  )
}

export function resolveGitHubWebhookWorkspace(input: {
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

export function makeGitHubActor(installationId: number) {
  return {
    id: makeGitHubAppActorId(String(installationId)),
    displayName: `GitHub App installation ${installationId}`,
  }
}

const patchPlaneResultCommentEventKinds = new Set([
  'github.issue_comment.created',
  'github.pull_request_comment.created',
])

export function isPatchPlaneResultComment(input: {
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
