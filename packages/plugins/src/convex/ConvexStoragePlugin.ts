import { Config, Effect, Layer, Option, Redacted, Schema } from 'effect'
import { ConvexHttpClient } from 'convex/browser'
import { makeFunctionReference } from 'convex/server'
import {
  decodeCandidatePatchSet,
  decodePolicyDecision,
  decodeProvenanceEvent,
  decodePublicationResult,
  decodeReviewFinding,
  decodeReviewRun,
} from '@patchplane/domain/decision-review'
import { StorageError } from '@patchplane/domain/errors'
import { decodeEvidenceArtifact } from '@patchplane/domain/evidence-artifact'
import { decodeRuntimeEvents } from '@patchplane/domain/runtime-event'
import { decodeRuntimeSession } from '@patchplane/domain/runtime-session'
import {
  decodeSandboxExecution,
  SandboxExecution,
} from '@patchplane/domain/sandbox-execution'
import {
  decodeVerificationExecutionGroup,
  decodeVerificationPlanV1,
  VerificationExecutionGroup,
  VerificationResult,
  decodeVerificationRequirement,
  decodeVerificationResult,
} from '@patchplane/domain/verification'
import {
  decodeWorkflowStart,
  decodeWorkflowStarts,
} from '@patchplane/domain/workflow-start'
import {
  StorageService,
  type CandidateFreezeInput,
  type ClaimVerificationExecutionGroupInput,
  type FailCandidateFreezeInput,
  type FailVerificationExecutionGroupInput,
  type ClaimWorkflowExecutionInput,
  type GetCandidatePatchSetForWorkflowInput,
  type IncomingDispatchClaimInput,
  type StartIncomingDispatchInput,
  type StartIncomingVerificationPlanInput,
  type StartVerificationExecutionGroupInput,
  type MarkWorkflowExecutionFailedInput,
  type CreateWorkflowFromPromptInput,
  type GetActiveRuntimeSessionInput,
  type MarkRuntimeSessionStatusInput,
  type GetEvidenceArtifactInput,
  type GetVerificationExecutionStateInput,
  type RecordEvidenceArtifactInput,
  type RecordCandidatePatchSetInput,
  type RecordPolicyDecisionInput,
  type RecordProvenanceEventInput,
  type RecordPublicationResultInput,
  type RecordReviewFindingInput,
  type RecordReviewRunInput,
  type RecordVerificationPlanInput,
  type RecordVerificationRequirementInput,
  type RecordVerificationResultInput,
  type RecordRuntimeEventInput,
  type RecordRuntimeSessionStartedInput,
  type RecordSandboxExecutionInput,
  type StorageListRecentWorkflowStartsInput,
} from '@patchplane/core/services/storage-service'
import { ConvexConfig } from './ConvexConfig'

interface ExternalWorkflowRefInput {
  readonly provider: string
  readonly deliveryId: string
  readonly eventKind: string
  readonly repositoryProvider?: string | undefined
  readonly repositoryInstallationId?: string | undefined
  readonly repositoryExternalId?: string | undefined
  readonly repositoryOwner?: string | undefined
  readonly repositoryName?: string | undefined
  readonly repositoryFullName?: string | undefined
  readonly issueExternalId?: string | undefined
  readonly issueNumber?: number | undefined
  readonly issueTitle?: string | undefined
  readonly issueBody?: string | undefined
  readonly pullRequestExternalId?: string | undefined
  readonly pullRequestNumber?: number | undefined
  readonly pullRequestUpdatedAt?: number | undefined
  readonly pullRequestBaseSha?: string | undefined
  readonly pullRequestHeadSha?: string | undefined
  readonly pullRequestPreviousHeadSha?: string | undefined
  readonly pullRequestHeadRef?: string | undefined
  readonly pullRequestBaseRef?: string | undefined
  readonly commentExternalId?: string | undefined
  readonly url?: string | undefined
  readonly senderProvider?: string | undefined
  readonly senderExternalId?: string | undefined
  readonly senderLogin?: string | undefined
}

const createWorkflowStartMutation = makeFunctionReference<
  'mutation',
  {
    workspaceId: string
    actorId: string
    actorDisplayName: string
    source: 'dev' | 'app' | 'external'
    traceId: string
    prompt: string
  },
  unknown
>('workflowStarts:create')

const createWorkflowStartFromExternalIntakeMutation = makeFunctionReference<
  'mutation',
  {
    systemSecret: string
    workspaceId: string
    actorId: string
    actorDisplayName: string
    source: 'external'
    traceId: string
    prompt: string
    externalRef: ExternalWorkflowRefInput
  },
  unknown
>('workflowStarts:createFromExternalIntake')

const recordRuntimeEventsMutation = makeFunctionReference<
  'mutation',
  {
    systemSecret: string
    events: ReadonlyArray<{
      workflowRunId: string
      provider: string
      type: string
      occurredAt: number
      summary?: string
      payloadJson?: string
      idempotencyKey?: string
      sourceSessionId?: string
      sourceCommandId?: string
      sourceStream?: 'stdout' | 'stderr'
      sourceLine?: number
      sourceOffset?: number
    }>
  },
  unknown
>('workflowStarts:recordRuntimeEvents')

const recordRuntimeSessionStartedMutation = makeFunctionReference<
  'mutation',
  {
    systemSecret: string
    workflowRunId: string
    provider: string
    sandboxId: string
    sessionId: string
    commandId: string
    startedAt: number
  },
  unknown
>('workflowStarts:recordRuntimeSessionStarted')

const markRuntimeSessionStatusMutation = makeFunctionReference<
  'mutation',
  {
    systemSecret: string
    runtimeSessionId: string
    status: 'starting' | 'running' | 'completed' | 'failed' | 'cancelled'
    completedAt?: number
  },
  unknown
>('workflowStarts:markRuntimeSessionStatus')

const getActiveRuntimeSessionQuery = makeFunctionReference<
  'query',
  {
    systemSecret: string
    workflowRunId: string
  },
  unknown
>('workflowStarts:getActiveRuntimeSession')

const claimWorkflowExecutionMutation = makeFunctionReference<
  'mutation',
  { systemSecret: string; workflowRunId: string },
  boolean
>('workflowStarts:claimWorkflowExecution')

const markWorkflowExecutionFailedMutation = makeFunctionReference<
  'mutation',
  {
    systemSecret: string
    workflowRunId: string
    incomingDispatchToken?: string
    summary: string
  },
  boolean
>('workflowStarts:markWorkflowExecutionFailed')

const recordSandboxExecutionMutation = makeFunctionReference<
  'mutation',
  {
    systemSecret: string
    workflowRunId: string
    incomingDispatchToken?: string
    executionGroupId?: string
    executionGroupClaimToken?: string
    idempotencyKey?: string
    provider: string
    sandboxId: string
    command: string
    status: 'succeeded' | 'failed'
    exitCode?: number
    stdout: string
    stderr?: string
    policy?: Record<string, unknown>
    startedAt: number
    completedAt: number
  },
  unknown
>('workflowStarts:recordSandboxExecution')

const recordEvidenceArtifactMutation = makeFunctionReference<
  'mutation',
  {
    systemSecret: string
    workflowRunId: string
    producer?: string
    subjectDigest?: string
    traceId?: string
    kind: RecordEvidenceArtifactInput['kind']
    label?: string
    storageProvider: 'cloudflare-r2'
    storageKey: string
    contentType: string
    sizeBytes: number
    sha256: string
    retentionPolicy?: string
    createdAt?: number
  },
  unknown
>('workflowStarts:recordEvidenceArtifact')

const getEvidenceArtifactQuery = makeFunctionReference<
  'query',
  {
    artifactId: string
    workflowRunId?: string
    systemSecret?: string
  },
  unknown
>('workflowStarts:getEvidenceArtifact')

const getCandidatePatchSetForWorkflowQuery = makeFunctionReference<
  'query',
  { systemSecret: string; workflowRunId: string },
  unknown
>('workflowStarts:getCandidatePatchSetForWorkflow')

const claimCandidateFreezeMutation = makeFunctionReference<
  'mutation',
  { systemSecret: string; workflowRunId: string; leaseToken: string },
  boolean
>('workflowStarts:claimCandidateFreeze')

const releaseCandidateFreezeMutation = makeFunctionReference<
  'mutation',
  { systemSecret: string; workflowRunId: string; leaseToken: string },
  boolean
>('workflowStarts:releaseCandidateFreeze')

const failCandidateFreezeMutation = makeFunctionReference<
  'mutation',
  {
    systemSecret: string
    workflowRunId: string
    leaseToken: string
    summary: string
  },
  boolean
>('workflowStarts:failCandidateFreeze')

const claimIncomingDispatchMutation = makeFunctionReference<
  'mutation',
  {
    systemSecret: string
    workflowRunId: string
    candidatePatchSetId: string
    dispatchToken: string
  },
  boolean
>('workflowStarts:claimIncomingDispatch')

const startIncomingDispatchMutation = makeFunctionReference<
  'mutation',
  {
    systemSecret: string
    workflowRunId: string
    candidatePatchSetId: string
    dispatchToken: string
    sandboxId: string
  },
  boolean
>('workflowStarts:startIncomingDispatch')

const validateIncomingDispatchMutation = makeFunctionReference<
  'mutation',
  {
    systemSecret: string
    workflowRunId: string
    candidatePatchSetId: string
    dispatchToken: string
  },
  boolean
>('workflowStarts:validateIncomingDispatch')

const recordCandidatePatchSetMutation = makeFunctionReference<
  'mutation',
  {
    systemSecret: string
    workflowRunId: string
    sandboxExecutionId?: string
    subject?: RecordCandidatePatchSetInput['subject']
    candidateFreezeLeaseToken?: string
    status: RecordCandidatePatchSetInput['status']
    candidateDigest?: string
    baseRef?: string
    baseSha?: string
    headRef?: string
    headSha?: string
    diffArtifactId?: string
    summary?: string
    stats?: {
      filesChanged: number
      additions: number
      deletions: number
    }
    idempotencyKey: string
    createdAt: number
  },
  unknown
>('workflowStarts:recordCandidatePatchSet')

const recordVerificationPlanMutation = makeFunctionReference<
  'mutation',
  {
    systemSecret: string
    workflowRunId: string
    version: 'verification-plan-v1'
    sources: RecordVerificationPlanInput['sources']
    requirements: RecordVerificationPlanInput['requirements']
    digest: string
    createdAt: number
  },
  unknown
>('workflowStarts:recordVerificationPlan')

const recordVerificationRequirementMutation = makeFunctionReference<
  'mutation',
  {
    systemSecret: string
    workflowRunId: string
    verificationPlanId?: string
    key: string
    label: string
    kind: RecordVerificationRequirementInput['kind']
    required: boolean
    command?: string
    platform?: RecordVerificationRequirementInput['platform']
    architecture?: string
    timeoutSeconds?: number
    requiredArtifactKinds: RecordVerificationRequirementInput['requiredArtifactKinds']
    source: RecordVerificationRequirementInput['source']
    createdAt: number
  },
  unknown
>('workflowStarts:recordVerificationRequirement')

const startIncomingVerificationPlanMutation = makeFunctionReference<
  'mutation',
  {
    systemSecret: string
    workflowRunId: string
    verificationPlanId: string
    candidatePatchSetId: string
    incomingDispatchToken: string
  },
  boolean
>('workflowStarts:startIncomingVerificationPlan')

const claimVerificationExecutionGroupMutation = makeFunctionReference<
  'mutation',
  {
    systemSecret: string
    workflowRunId: string
    verificationPlanId: string
    requirementId: string
    candidatePatchSetId: string
    stableKey: string
    claimToken: string
    incomingDispatchToken: string
    provider: string
    platform: ClaimVerificationExecutionGroupInput['platform']
    architecture: string
    commandDigest?: string
    timeoutSeconds?: number
    claimedAt: number
  },
  unknown
>('workflowStarts:claimVerificationExecutionGroup')

const startVerificationExecutionGroupMutation = makeFunctionReference<
  'mutation',
  {
    systemSecret: string
    workflowRunId: string
    executionGroupId: string
    claimToken: string
    sandboxId: string
  },
  boolean
>('workflowStarts:startVerificationExecutionGroup')

const failVerificationExecutionGroupMutation = makeFunctionReference<
  'mutation',
  {
    systemSecret: string
    workflowRunId: string
    executionGroupId: string
    claimToken: string
    status: FailVerificationExecutionGroupInput['status']
    completedAt: number
  },
  boolean
>('workflowStarts:failVerificationExecutionGroup')

const getVerificationExecutionStateQuery = makeFunctionReference<
  'query',
  {
    systemSecret: string
    workflowRunId: string
    verificationPlanId: string
    candidatePatchSetId: string
  },
  unknown
>('workflowStarts:getVerificationExecutionState')

const recordVerificationResultMutation = makeFunctionReference<
  'mutation',
  {
    systemSecret: string
    workflowRunId: string
    verificationPlanId?: string
    executionGroupId?: string
    executionGroupClaimToken?: string
    requirementId: string
    candidatePatchSetId: string
    sandboxExecutionId?: string
    provider: string
    command?: string
    commandDigest?: string
    platform: RecordVerificationResultInput['platform']
    architecture: string
    environmentImage?: string
    status: RecordVerificationResultInput['status']
    exitCode?: number
    summary?: string
    passedCount?: number
    failedCount?: number
    skippedCount?: number
    artifactIds: RecordVerificationResultInput['artifactIds']
    stdoutArtifactId?: string
    stderrArtifactId?: string
    stdoutCaptureStatus?: RecordVerificationResultInput['stdoutCaptureStatus']
    stderrCaptureStatus?: RecordVerificationResultInput['stderrCaptureStatus']
    cleanupStatus?: RecordVerificationResultInput['cleanupStatus']
    candidateDigestBefore?: string
    candidateDigestAfter?: string
    startedAt: number
    completedAt?: number
    idempotencyKey: string
  },
  unknown
>('workflowStarts:recordVerificationResult')

const recordReviewRunMutation = makeFunctionReference<
  'mutation',
  {
    systemSecret: string
    workflowRunId: string
    sandboxExecutionId?: string
    candidatePatchSetId?: string
    kind: RecordReviewRunInput['kind']
    reviewer: string
    status: RecordReviewRunInput['status']
    summary?: string
    startedAt: number
    completedAt?: number
    idempotencyKey: string
    createdAt?: number
  },
  unknown
>('workflowStarts:recordReviewRun')

const recordReviewFindingMutation = makeFunctionReference<
  'mutation',
  {
    systemSecret: string
    workflowRunId: string
    reviewRunId?: string
    severity: RecordReviewFindingInput['severity']
    category: RecordReviewFindingInput['category']
    message: string
    path?: string
    startLine?: number
    endLine?: number
    evidenceArtifactId?: string
    idempotencyKey: string
    createdAt?: number
  },
  unknown
>('workflowStarts:recordReviewFinding')

const recordPolicyDecisionMutation = makeFunctionReference<
  'mutation',
  {
    systemSecret: string
    workflowRunId: string
    reviewRunId?: string
    candidatePatchSetId?: string
    status: RecordPolicyDecisionInput['status']
    summary: string
    reason?: string
    policyVersion?: string
    inputDigest?: string
    verificationResultIds?: ReadonlyArray<string>
    reviewFindingIds?: ReadonlyArray<string>
    missingRequirementIds?: ReadonlyArray<string>
    idempotencyKey: string
    createdAt?: number
  },
  unknown
>('workflowStarts:recordPolicyDecision')

const recordPublicationResultMutation = makeFunctionReference<
  'mutation',
  {
    systemSecret: string
    workflowRunId: string
    humanDecisionId?: string
    candidatePatchSetId?: string
    targetSha?: string
    provider: string
    kind: RecordPublicationResultInput['kind']
    status: RecordPublicationResultInput['status']
    externalId?: string
    url?: string
    summary?: string
    error?: string
    dispatchToken?: string
    createdAt?: number
    idempotencyKey?: string
  },
  unknown
>('workflowStarts:recordPublicationResult')

const recordProvenanceEventMutation = makeFunctionReference<
  'mutation',
  {
    systemSecret: string
    workflowRunId: string
    traceId: string
    parentEventId?: string
    type: string
    operation: string
    pluginName?: string
    status: RecordProvenanceEventInput['status']
    startedAt: number
    completedAt?: number
    summary?: string
    artifactRefs: ReadonlyArray<string>
    errorCategory?: string
    idempotencyKey?: string
  },
  unknown
>('workflowStarts:recordProvenanceEvent')

const listRecentWorkflowStartsQuery = makeFunctionReference<
  'query',
  {
    workspaceId: string
    limit?: number
  },
  unknown
>('workflowStarts:listRecent')

export const ConvexStoragePlugin = {
  layer: Layer.effect(
    StorageService,
    Effect.gen(function* () {
      const config = yield* ConvexConfig
      const configuredUrl = config.url.canonical.pipe(
        Option.orElse(() => config.url.legacy),
      )
      if (Option.isNone(configuredUrl)) {
        return yield* Schema.decodeUnknownEffect(Schema.Never)(undefined).pipe(
          Effect.mapError((cause) => new Config.ConfigError(cause)),
        )
      }
      const convexUrl = configuredUrl.value.toString().replace(/\/$/, '')
      const systemIngestionSecret = Option.getOrUndefined(
        config.systemIngestionSecret,
      )

      const createWorkflowFromPrompt = Effect.fn(
        '@patchplane/plugins/convex/createWorkflowFromPrompt',
      )(function* (input: CreateWorkflowFromPromptInput) {
        yield* Effect.annotateCurrentSpan({
          traceId: input.traceId,
          workspaceId: input.workspaceId,
          actorId: input.actor.id,
        })

        yield* Effect.logInfo(
          'Calling authenticated Convex workflow start mutation',
        )

        const value = yield* Effect.tryPromise({
          try: () => {
            const client = new ConvexHttpClient(convexUrl)

            if (input.externalRef !== undefined) {
              if (systemIngestionSecret === undefined) {
                throw new Error(
                  'PATCHPLANE_SYSTEM_INGESTION_SECRET is required for external workflow ingestion',
                )
              }

              if (input.source !== 'external') {
                throw new Error(
                  'External workflow ingestion requires the external prompt source',
                )
              }

              return client.mutation(
                createWorkflowStartFromExternalIntakeMutation,
                {
                  systemSecret: Redacted.value(systemIngestionSecret),
                  workspaceId: input.workspaceId,
                  actorId: input.actor.id,
                  actorDisplayName: input.actor.displayName,
                  source: input.source,
                  traceId: input.traceId,
                  prompt: input.prompt,
                  externalRef: input.externalRef,
                },
              )
            }

            if (input.authToken !== undefined) {
              client.setAuth(input.authToken)
            }

            return client.mutation(createWorkflowStartMutation, {
              workspaceId: input.workspaceId,
              actorId: input.actor.id,
              actorDisplayName: input.actor.displayName,
              source: input.source,
              traceId: input.traceId,
              prompt: input.prompt,
            })
          },
          catch: (cause) =>
            new StorageError({
              operation: 'createWorkflowFromPrompt',
              message: 'Convex failed to create workflow from prompt',
              cause,
            }),
        })

        const workflowStart = yield* decodeWorkflowStart(value).pipe(
          Effect.mapError(
            (cause) =>
              new StorageError({
                operation: 'createWorkflowFromPrompt.decode',
                message: 'Convex returned an invalid workflow start',
                cause,
              }),
          ),
        )

        yield* Effect.logInfo('Authenticated Convex workflow start succeeded', {
          promptRequestId: workflowStart.promptRequest.id,
          workflowRunId: workflowStart.workflowRun.id,
        })

        return workflowStart
      })

      const listRecentWorkflowStarts = Effect.fn(
        '@patchplane/plugins/convex/listRecentWorkflowStarts',
      )(function* (input: StorageListRecentWorkflowStartsInput) {
        yield* Effect.annotateCurrentSpan({
          workspaceId: input.workspaceId,
          limit: input.limit,
        })

        yield* Effect.logInfo('Calling Convex workflowStarts:listRecent')

        const queryArgs =
          input.limit === undefined
            ? { workspaceId: input.workspaceId }
            : { workspaceId: input.workspaceId, limit: input.limit }

        const value = yield* Effect.tryPromise({
          try: () => {
            const client = new ConvexHttpClient(convexUrl)

            if (input.authToken !== undefined) {
              client.setAuth(input.authToken)
            }

            return client.query(listRecentWorkflowStartsQuery, queryArgs)
          },
          catch: (cause) =>
            new StorageError({
              operation: 'listRecentWorkflowStarts',
              message: 'Convex failed to list recent workflow starts',
              cause,
            }),
        })

        const workflowStarts = yield* decodeWorkflowStarts(value).pipe(
          Effect.mapError(
            (cause) =>
              new StorageError({
                operation: 'listRecentWorkflowStarts.decode',
                message: 'Convex returned invalid workflow starts',
                cause,
              }),
          ),
        )

        yield* Effect.logInfo('Convex workflowStarts:listRecent succeeded', {
          count: workflowStarts.length,
        })

        return workflowStarts
      })

      const claimWorkflowExecution = Effect.fn(
        '@patchplane/plugins/convex/claimWorkflowExecution',
      )(function* (input: ClaimWorkflowExecutionInput) {
        if (systemIngestionSecret === undefined) {
          return yield* new StorageError({
            operation: 'claimWorkflowExecution.config',
            message:
              'PATCHPLANE_SYSTEM_INGESTION_SECRET is required to claim workflow execution',
            cause: undefined,
          })
        }
        const result = yield* Effect.tryPromise({
          try: () =>
            new ConvexHttpClient(convexUrl).mutation(
              claimWorkflowExecutionMutation,
              {
                systemSecret: Redacted.value(systemIngestionSecret),
                workflowRunId: input.workflowRunId,
              },
            ),
          catch: (cause) =>
            new StorageError({
              operation: 'claimWorkflowExecution',
              message: 'Convex failed to claim workflow execution',
              cause,
            }),
        })
        return yield* Schema.decodeUnknownEffect(Schema.Boolean)(result).pipe(
          Effect.mapError(
            (cause) =>
              new StorageError({
                operation: 'claimWorkflowExecution.decode',
                message:
                  'Convex returned an invalid workflow execution claim result',
                cause,
              }),
          ),
        )
      })

      const markWorkflowExecutionFailed = Effect.fn(
        '@patchplane/plugins/convex/markWorkflowExecutionFailed',
      )(function* (input: MarkWorkflowExecutionFailedInput) {
        if (systemIngestionSecret === undefined) {
          return yield* new StorageError({
            operation: 'markWorkflowExecutionFailed.config',
            message:
              'PATCHPLANE_SYSTEM_INGESTION_SECRET is required to mark workflow execution failed',
            cause: undefined,
          })
        }
        const result = yield* Effect.tryPromise({
          try: () =>
            new ConvexHttpClient(convexUrl).mutation(
              markWorkflowExecutionFailedMutation,
              {
                systemSecret: Redacted.value(systemIngestionSecret),
                workflowRunId: input.workflowRunId,
                ...(input.incomingDispatchToken === undefined
                  ? {}
                  : { incomingDispatchToken: input.incomingDispatchToken }),
                summary: input.summary,
              },
            ),
          catch: (cause) =>
            new StorageError({
              operation: 'markWorkflowExecutionFailed',
              message: 'Convex failed to mark workflow execution failed',
              cause,
            }),
        })
        return yield* Schema.decodeUnknownEffect(Schema.Boolean)(result).pipe(
          Effect.mapError(
            (cause) =>
              new StorageError({
                operation: 'markWorkflowExecutionFailed.decode',
                message:
                  'Convex returned an invalid workflow execution failure result',
                cause,
              }),
          ),
        )
      })

      const recordSandboxExecution = Effect.fn(
        '@patchplane/plugins/convex/recordSandboxExecution',
      )(function* (input: RecordSandboxExecutionInput) {
        if (systemIngestionSecret === undefined) {
          return yield* new StorageError({
            operation: 'recordSandboxExecution.config',
            message:
              'PATCHPLANE_SYSTEM_INGESTION_SECRET is required to record sandbox executions',
            cause: undefined,
          })
        }

        const value = yield* Effect.tryPromise({
          try: () => {
            const client = new ConvexHttpClient(convexUrl)
            return client.mutation(recordSandboxExecutionMutation, {
              systemSecret: Redacted.value(systemIngestionSecret),
              workflowRunId: input.workflowRunId,
              ...(input.incomingDispatchToken === undefined
                ? {}
                : { incomingDispatchToken: input.incomingDispatchToken }),
              ...(input.executionGroupId === undefined
                ? {}
                : { executionGroupId: input.executionGroupId }),
              ...(input.executionGroupClaimToken === undefined
                ? {}
                : {
                    executionGroupClaimToken: input.executionGroupClaimToken,
                  }),
              ...(input.idempotencyKey === undefined
                ? {}
                : { idempotencyKey: input.idempotencyKey }),
              provider: input.provider,
              sandboxId: input.sandboxId,
              command: input.command,
              status: input.status,
              ...(input.exitCode === undefined
                ? {}
                : { exitCode: input.exitCode }),
              stdout: input.stdout,
              ...(input.stderr === undefined ? {} : { stderr: input.stderr }),
              ...(input.policy === undefined ? {} : { policy: input.policy }),
              startedAt: input.startedAt,
              completedAt: input.completedAt,
            })
          },
          catch: (cause) =>
            new StorageError({
              operation: 'recordSandboxExecution',
              message: 'Convex failed to record sandbox execution',
              cause,
            }),
        })

        return yield* decodeSandboxExecution(value).pipe(
          Effect.mapError(
            (cause) =>
              new StorageError({
                operation: 'recordSandboxExecution.decode',
                message: 'Convex returned an invalid sandbox execution',
                cause,
              }),
          ),
        )
      })

      const recordRuntimeEvents = Effect.fn(
        '@patchplane/plugins/convex/recordRuntimeEvents',
      )(function* (input: ReadonlyArray<RecordRuntimeEventInput>) {
        if (input.length === 0) {
          return []
        }
        if (systemIngestionSecret === undefined) {
          return yield* new StorageError({
            operation: 'recordRuntimeEvents.config',
            message:
              'PATCHPLANE_SYSTEM_INGESTION_SECRET is required to record runtime events',
            cause: undefined,
          })
        }

        const value = yield* Effect.tryPromise({
          try: () => {
            const client = new ConvexHttpClient(convexUrl)
            return client.mutation(recordRuntimeEventsMutation, {
              systemSecret: Redacted.value(systemIngestionSecret),
              events: input.map((event) => ({
                workflowRunId: event.workflowRunId,
                provider: event.provider,
                type: event.type,
                occurredAt: event.occurredAt,
                ...(event.summary === undefined
                  ? {}
                  : { summary: event.summary }),
                ...(event.payloadJson === undefined
                  ? {}
                  : { payloadJson: event.payloadJson }),
                ...(event.idempotencyKey === undefined
                  ? {}
                  : { idempotencyKey: event.idempotencyKey }),
                ...(event.sourceSessionId === undefined
                  ? {}
                  : { sourceSessionId: event.sourceSessionId }),
                ...(event.sourceCommandId === undefined
                  ? {}
                  : { sourceCommandId: event.sourceCommandId }),
                ...(event.sourceStream === undefined
                  ? {}
                  : { sourceStream: event.sourceStream }),
                ...(event.sourceLine === undefined
                  ? {}
                  : { sourceLine: event.sourceLine }),
                ...(event.sourceOffset === undefined
                  ? {}
                  : { sourceOffset: event.sourceOffset }),
              })),
            })
          },
          catch: (cause) =>
            new StorageError({
              operation: 'recordRuntimeEvents',
              message: 'Convex failed to record runtime events',
              cause,
            }),
        })

        return yield* decodeRuntimeEvents(value).pipe(
          Effect.mapError(
            (cause) =>
              new StorageError({
                operation: 'recordRuntimeEvents.decode',
                message: 'Convex returned invalid runtime events',
                cause,
              }),
          ),
        )
      })

      const recordRuntimeSessionStarted = Effect.fn(
        '@patchplane/plugins/convex/recordRuntimeSessionStarted',
      )(function* (input: RecordRuntimeSessionStartedInput) {
        if (systemIngestionSecret === undefined) {
          return yield* new StorageError({
            operation: 'recordRuntimeSessionStarted.config',
            message:
              'PATCHPLANE_SYSTEM_INGESTION_SECRET is required to record runtime sessions',
            cause: undefined,
          })
        }
        const value = yield* Effect.tryPromise({
          try: () => {
            const client = new ConvexHttpClient(convexUrl)
            return client.mutation(recordRuntimeSessionStartedMutation, {
              systemSecret: Redacted.value(systemIngestionSecret),
              workflowRunId: input.workflowRunId,
              provider: input.provider,
              sandboxId: input.sandboxId,
              sessionId: input.sessionId,
              commandId: input.commandId,
              startedAt: input.startedAt,
            })
          },
          catch: (cause) =>
            new StorageError({
              operation: 'recordRuntimeSessionStarted',
              message: 'Convex failed to record runtime session',
              cause,
            }),
        })
        return yield* decodeRuntimeSession(value).pipe(
          Effect.mapError(
            (cause) =>
              new StorageError({
                operation: 'recordRuntimeSessionStarted.decode',
                message: 'Convex returned invalid runtime session',
                cause,
              }),
          ),
        )
      })

      const markRuntimeSessionStatus = Effect.fn(
        '@patchplane/plugins/convex/markRuntimeSessionStatus',
      )(function* (input: MarkRuntimeSessionStatusInput) {
        if (systemIngestionSecret === undefined) {
          return yield* new StorageError({
            operation: 'markRuntimeSessionStatus.config',
            message:
              'PATCHPLANE_SYSTEM_INGESTION_SECRET is required to update runtime sessions',
            cause: undefined,
          })
        }
        const value = yield* Effect.tryPromise({
          try: () => {
            const client = new ConvexHttpClient(convexUrl)
            return client.mutation(markRuntimeSessionStatusMutation, {
              systemSecret: Redacted.value(systemIngestionSecret),
              runtimeSessionId: input.runtimeSessionId,
              status: input.status,
              ...(input.completedAt === undefined
                ? {}
                : { completedAt: input.completedAt }),
            })
          },
          catch: (cause) =>
            new StorageError({
              operation: 'markRuntimeSessionStatus',
              message: 'Convex failed to update runtime session',
              cause,
            }),
        })
        return yield* decodeRuntimeSession(value).pipe(
          Effect.mapError(
            (cause) =>
              new StorageError({
                operation: 'markRuntimeSessionStatus.decode',
                message: 'Convex returned invalid runtime session',
                cause,
              }),
          ),
        )
      })

      const getActiveRuntimeSession = Effect.fn(
        '@patchplane/plugins/convex/getActiveRuntimeSession',
      )(function* (input: GetActiveRuntimeSessionInput) {
        if (systemIngestionSecret === undefined) {
          return yield* new StorageError({
            operation: 'getActiveRuntimeSession.config',
            message:
              'PATCHPLANE_SYSTEM_INGESTION_SECRET is required to read runtime sessions',
            cause: undefined,
          })
        }
        const value = yield* Effect.tryPromise({
          try: () => {
            const client = new ConvexHttpClient(convexUrl)
            return client.query(getActiveRuntimeSessionQuery, {
              systemSecret: Redacted.value(systemIngestionSecret),
              workflowRunId: input.workflowRunId,
            })
          },
          catch: (cause) =>
            new StorageError({
              operation: 'getActiveRuntimeSession',
              message: 'Convex failed to read runtime session',
              cause,
            }),
        })
        if (value === null) return Option.none()
        const session = yield* decodeRuntimeSession(value).pipe(
          Effect.mapError(
            (cause) =>
              new StorageError({
                operation: 'getActiveRuntimeSession.decode',
                message: 'Convex returned invalid runtime session',
                cause,
              }),
          ),
        )
        return Option.some(session)
      })

      const recordEvidenceArtifact = Effect.fn(
        '@patchplane/plugins/convex/recordEvidenceArtifact',
      )(function* (input: RecordEvidenceArtifactInput) {
        if (systemIngestionSecret === undefined) {
          return yield* new StorageError({
            operation: 'recordEvidenceArtifact.config',
            message:
              'PATCHPLANE_SYSTEM_INGESTION_SECRET is required to record evidence artifacts',
            cause: undefined,
          })
        }
        const value = yield* Effect.tryPromise({
          try: () => {
            const client = new ConvexHttpClient(convexUrl)
            return client.mutation(recordEvidenceArtifactMutation, {
              systemSecret: Redacted.value(systemIngestionSecret),
              workflowRunId: input.workflowRunId,
              ...(input.producer === undefined
                ? {}
                : { producer: input.producer }),
              ...(input.subjectDigest === undefined
                ? {}
                : { subjectDigest: input.subjectDigest }),
              ...(input.traceId === undefined
                ? {}
                : { traceId: input.traceId }),
              kind: input.kind,
              ...(input.label === undefined ? {} : { label: input.label }),
              storageProvider: input.storageProvider,
              storageKey: input.storageKey,
              contentType: input.contentType,
              sizeBytes: input.sizeBytes,
              sha256: input.sha256,
              ...(input.retentionPolicy === undefined
                ? {}
                : { retentionPolicy: input.retentionPolicy }),
              ...(input.createdAt === undefined
                ? {}
                : { createdAt: input.createdAt }),
            })
          },
          catch: (cause) =>
            new StorageError({
              operation: 'recordEvidenceArtifact',
              message: 'Convex failed to record evidence artifact',
              cause,
            }),
        })
        return yield* decodeEvidenceArtifact(value).pipe(
          Effect.mapError(
            (cause) =>
              new StorageError({
                operation: 'recordEvidenceArtifact.decode',
                message: 'Convex returned invalid evidence artifact',
                cause,
              }),
          ),
        )
      })

      const getEvidenceArtifact = Effect.fn(
        '@patchplane/plugins/convex/getEvidenceArtifact',
      )(function* (input: GetEvidenceArtifactInput) {
        if (
          input.authToken === undefined &&
          systemIngestionSecret === undefined
        ) {
          return yield* new StorageError({
            operation: 'getEvidenceArtifact.config',
            message:
              'authToken or PATCHPLANE_SYSTEM_INGESTION_SECRET is required to read evidence artifacts',
            cause: undefined,
          })
        }
        const value = yield* Effect.tryPromise({
          try: () => {
            const client = new ConvexHttpClient(convexUrl)
            if (input.authToken !== undefined) {
              client.setAuth(input.authToken)
            }
            return client.query(getEvidenceArtifactQuery, {
              artifactId: input.artifactId,
              ...(input.workflowRunId === undefined
                ? {}
                : { workflowRunId: input.workflowRunId }),
              ...(input.authToken !== undefined ||
              systemIngestionSecret === undefined
                ? {}
                : { systemSecret: Redacted.value(systemIngestionSecret) }),
            })
          },
          catch: (cause) =>
            new StorageError({
              operation: 'getEvidenceArtifact',
              message: 'Convex failed to read evidence artifact',
              cause,
            }),
        })
        if (value === null) return Option.none()
        const artifact = yield* decodeEvidenceArtifact(value).pipe(
          Effect.mapError(
            (cause) =>
              new StorageError({
                operation: 'getEvidenceArtifact.decode',
                message: 'Convex returned invalid evidence artifact',
                cause,
              }),
          ),
        )
        return Option.some(artifact)
      })

      const getCandidatePatchSetForWorkflow = Effect.fn(
        '@patchplane/plugins/convex/getCandidatePatchSetForWorkflow',
      )(function* (input: GetCandidatePatchSetForWorkflowInput) {
        if (systemIngestionSecret === undefined) {
          return yield* new StorageError({
            operation: 'getCandidatePatchSetForWorkflow.config',
            message:
              'PATCHPLANE_SYSTEM_INGESTION_SECRET is required to read candidates',
            cause: undefined,
          })
        }
        const value = yield* Effect.tryPromise({
          try: () =>
            new ConvexHttpClient(convexUrl).query(
              getCandidatePatchSetForWorkflowQuery,
              {
                systemSecret: Redacted.value(systemIngestionSecret),
                workflowRunId: input.workflowRunId,
              },
            ),
          catch: (cause) =>
            new StorageError({
              operation: 'getCandidatePatchSetForWorkflow',
              message: 'Convex failed to read the workflow candidate',
              cause,
            }),
        })
        if (value === null) return Option.none()
        return Option.some(
          yield* decodeCandidatePatchSet(value).pipe(
            Effect.mapError(
              (cause) =>
                new StorageError({
                  operation: 'getCandidatePatchSetForWorkflow.decode',
                  message: 'Convex returned an invalid workflow candidate',
                  cause,
                }),
            ),
          ),
        )
      })

      const candidateFreezeMutation = (
        operation: 'claimCandidateFreeze' | 'releaseCandidateFreeze',
        mutationRef:
          | typeof claimCandidateFreezeMutation
          | typeof releaseCandidateFreezeMutation,
        input: CandidateFreezeInput,
      ) =>
        Effect.gen(function* () {
          if (systemIngestionSecret === undefined) {
            return yield* new StorageError({
              operation: `${operation}.config`,
              message:
                'PATCHPLANE_SYSTEM_INGESTION_SECRET is required for candidate freeze coordination',
              cause: undefined,
            })
          }
          const result = yield* Effect.tryPromise({
            try: () =>
              new ConvexHttpClient(convexUrl).mutation(mutationRef, {
                systemSecret: Redacted.value(systemIngestionSecret),
                workflowRunId: input.workflowRunId,
                leaseToken: input.leaseToken,
              }),
            catch: (cause) =>
              new StorageError({
                operation,
                message: `Convex failed to ${operation}`,
                cause,
              }),
          })
          return yield* Schema.decodeUnknownEffect(Schema.Boolean)(result).pipe(
            Effect.mapError(
              (cause) =>
                new StorageError({
                  operation: `${operation}.decode`,
                  message: `Convex returned an invalid ${operation} result`,
                  cause,
                }),
            ),
          )
        })

      const claimCandidateFreeze = Effect.fn(
        '@patchplane/plugins/convex/claimCandidateFreeze',
      )((input: CandidateFreezeInput) =>
        candidateFreezeMutation(
          'claimCandidateFreeze',
          claimCandidateFreezeMutation,
          input,
        ),
      )

      const releaseCandidateFreeze = Effect.fn(
        '@patchplane/plugins/convex/releaseCandidateFreeze',
      )((input: CandidateFreezeInput) =>
        candidateFreezeMutation(
          'releaseCandidateFreeze',
          releaseCandidateFreezeMutation,
          input,
        ),
      )

      const failCandidateFreeze = (input: FailCandidateFreezeInput) =>
        Effect.gen(function* () {
          if (systemIngestionSecret === undefined) {
            return yield* new StorageError({
              operation: 'failCandidateFreeze.config',
              message:
                'PATCHPLANE_SYSTEM_INGESTION_SECRET is required for candidate freeze coordination',
              cause: undefined,
            })
          }
          const result = yield* Effect.tryPromise({
            try: () =>
              new ConvexHttpClient(convexUrl).mutation(
                failCandidateFreezeMutation,
                {
                  systemSecret: Redacted.value(systemIngestionSecret),
                  workflowRunId: input.workflowRunId,
                  leaseToken: input.leaseToken,
                  summary: input.summary,
                },
              ),
            catch: (cause) =>
              new StorageError({
                operation: 'failCandidateFreeze',
                message: 'Convex failed to persist candidate freeze failure',
                cause,
              }),
          })
          return yield* Schema.decodeUnknownEffect(Schema.Boolean)(result).pipe(
            Effect.mapError(
              (cause) =>
                new StorageError({
                  operation: 'failCandidateFreeze.decode',
                  message:
                    'Convex returned an invalid candidate freeze failure result',
                  cause,
                }),
            ),
          )
        })

      const incomingDispatchMutation = (
        operation:
          | 'claimIncomingDispatch'
          | 'startIncomingDispatch'
          | 'validateIncomingDispatch',
        mutationRef:
          | typeof claimIncomingDispatchMutation
          | typeof startIncomingDispatchMutation
          | typeof validateIncomingDispatchMutation,
        input: IncomingDispatchClaimInput | StartIncomingDispatchInput,
      ) =>
        Effect.gen(function* () {
          if (systemIngestionSecret === undefined) {
            return yield* new StorageError({
              operation: `${operation}.config`,
              message:
                'PATCHPLANE_SYSTEM_INGESTION_SECRET is required for incoming dispatch coordination',
              cause: undefined,
            })
          }
          const result = yield* Effect.tryPromise({
            try: () =>
              new ConvexHttpClient(convexUrl).mutation(mutationRef, {
                systemSecret: Redacted.value(systemIngestionSecret),
                workflowRunId: input.workflowRunId,
                candidatePatchSetId: input.candidatePatchSetId,
                dispatchToken: input.dispatchToken,
                ...(operation === 'startIncomingDispatch'
                  ? {
                      sandboxId: (input as StartIncomingDispatchInput)
                        .sandboxId,
                    }
                  : {}),
              }),
            catch: (cause) =>
              new StorageError({
                operation,
                message: `Convex failed to ${operation}`,
                cause,
              }),
          })
          return yield* Schema.decodeUnknownEffect(Schema.Boolean)(result).pipe(
            Effect.mapError(
              (cause) =>
                new StorageError({
                  operation: `${operation}.decode`,
                  message: `Convex returned an invalid ${operation} result`,
                  cause,
                }),
            ),
          )
        })

      const claimIncomingDispatch = Effect.fn(
        '@patchplane/plugins/convex/claimIncomingDispatch',
      )((input: IncomingDispatchClaimInput) =>
        incomingDispatchMutation(
          'claimIncomingDispatch',
          claimIncomingDispatchMutation,
          input,
        ),
      )

      const startIncomingDispatch = Effect.fn(
        '@patchplane/plugins/convex/startIncomingDispatch',
      )((input: StartIncomingDispatchInput) =>
        incomingDispatchMutation(
          'startIncomingDispatch',
          startIncomingDispatchMutation,
          input,
        ),
      )

      const validateIncomingDispatch = Effect.fn(
        '@patchplane/plugins/convex/validateIncomingDispatch',
      )((input: IncomingDispatchClaimInput) =>
        incomingDispatchMutation(
          'validateIncomingDispatch',
          validateIncomingDispatchMutation,
          input,
        ),
      )

      const recordCandidatePatchSet = Effect.fn(
        '@patchplane/plugins/convex/recordCandidatePatchSet',
      )(function* (input: RecordCandidatePatchSetInput) {
        if (systemIngestionSecret === undefined) {
          return yield* new StorageError({
            operation: 'recordCandidatePatchSet.config',
            message:
              'PATCHPLANE_SYSTEM_INGESTION_SECRET is required to record candidate patch sets',
            cause: undefined,
          })
        }
        const value = yield* Effect.tryPromise({
          try: () => {
            const client = new ConvexHttpClient(convexUrl)
            return client.mutation(recordCandidatePatchSetMutation, {
              systemSecret: Redacted.value(systemIngestionSecret),
              workflowRunId: input.workflowRunId,
              ...(input.sandboxExecutionId === undefined
                ? {}
                : { sandboxExecutionId: input.sandboxExecutionId }),
              ...(input.subject === undefined
                ? {}
                : { subject: input.subject }),
              ...(input.candidateFreezeLeaseToken === undefined
                ? {}
                : {
                    candidateFreezeLeaseToken: input.candidateFreezeLeaseToken,
                  }),
              status: input.status,
              ...(input.candidateDigest === undefined
                ? {}
                : { candidateDigest: input.candidateDigest }),
              ...(input.baseRef === undefined
                ? {}
                : { baseRef: input.baseRef }),
              ...(input.baseSha === undefined
                ? {}
                : { baseSha: input.baseSha }),
              ...(input.headRef === undefined
                ? {}
                : { headRef: input.headRef }),
              ...(input.headSha === undefined
                ? {}
                : { headSha: input.headSha }),
              ...(input.diffArtifactId === undefined
                ? {}
                : { diffArtifactId: input.diffArtifactId }),
              ...(input.summary === undefined
                ? {}
                : { summary: input.summary }),
              ...(input.stats === undefined ? {} : { stats: input.stats }),
              idempotencyKey: input.idempotencyKey,
              createdAt: input.createdAt,
            })
          },
          catch: (cause) =>
            new StorageError({
              operation: 'recordCandidatePatchSet',
              message: 'Convex failed to record candidate patch set',
              cause,
            }),
        })
        return yield* decodeCandidatePatchSet(value).pipe(
          Effect.mapError(
            (cause) =>
              new StorageError({
                operation: 'recordCandidatePatchSet.decode',
                message: 'Convex returned invalid candidate patch set',
                cause,
              }),
          ),
        )
      })

      const recordVerificationPlan = Effect.fn(
        '@patchplane/plugins/convex/recordVerificationPlan',
      )(function* (input: RecordVerificationPlanInput) {
        if (systemIngestionSecret === undefined) {
          return yield* new StorageError({
            operation: 'recordVerificationPlan.config',
            message:
              'PATCHPLANE_SYSTEM_INGESTION_SECRET is required to record verification plans',
            cause: undefined,
          })
        }
        const value = yield* Effect.tryPromise({
          try: () =>
            new ConvexHttpClient(convexUrl).mutation(
              recordVerificationPlanMutation,
              {
                systemSecret: Redacted.value(systemIngestionSecret),
                workflowRunId: input.workflowRunId,
                version: input.version,
                sources: input.sources,
                requirements: input.requirements,
                digest: input.digest,
                createdAt: input.createdAt,
              },
            ),
          catch: (cause) =>
            new StorageError({
              operation: 'recordVerificationPlan',
              message: 'Convex failed to record verification plan',
              cause,
            }),
        })
        return yield* decodeVerificationPlanV1(value).pipe(
          Effect.mapError(
            (cause) =>
              new StorageError({
                operation: 'recordVerificationPlan.decode',
                message: 'Convex returned an invalid verification plan',
                cause,
              }),
          ),
        )
      })

      const recordVerificationRequirement = Effect.fn(
        '@patchplane/plugins/convex/recordVerificationRequirement',
      )(function* (input: RecordVerificationRequirementInput) {
        if (systemIngestionSecret === undefined) {
          return yield* new StorageError({
            operation: 'recordVerificationRequirement.config',
            message:
              'PATCHPLANE_SYSTEM_INGESTION_SECRET is required to record verification requirements',
            cause: undefined,
          })
        }
        const value = yield* Effect.tryPromise({
          try: () =>
            new ConvexHttpClient(convexUrl).mutation(
              recordVerificationRequirementMutation,
              {
                systemSecret: Redacted.value(systemIngestionSecret),
                workflowRunId: input.workflowRunId,
                ...(input.verificationPlanId === undefined
                  ? {}
                  : { verificationPlanId: input.verificationPlanId }),
                key: input.key,
                label: input.label,
                kind: input.kind,
                required: input.required,
                ...(input.command === undefined
                  ? {}
                  : { command: input.command }),
                ...(input.platform === undefined
                  ? {}
                  : { platform: input.platform }),
                ...(input.architecture === undefined
                  ? {}
                  : { architecture: input.architecture }),
                ...(input.timeoutSeconds === undefined
                  ? {}
                  : { timeoutSeconds: input.timeoutSeconds }),
                requiredArtifactKinds: input.requiredArtifactKinds,
                source: input.source,
                createdAt: input.createdAt,
              },
            ),
          catch: (cause) =>
            new StorageError({
              operation: 'recordVerificationRequirement',
              message: 'Convex failed to record verification requirement',
              cause,
            }),
        })
        return yield* decodeVerificationRequirement(value).pipe(
          Effect.mapError(
            (cause) =>
              new StorageError({
                operation: 'recordVerificationRequirement.decode',
                message: 'Convex returned invalid verification requirement',
                cause,
              }),
          ),
        )
      })

      const startIncomingVerificationPlan = Effect.fn(
        '@patchplane/plugins/convex/startIncomingVerificationPlan',
      )(function* (input: StartIncomingVerificationPlanInput) {
        if (systemIngestionSecret === undefined) {
          return yield* new StorageError({
            operation: 'startIncomingVerificationPlan.config',
            message:
              'PATCHPLANE_SYSTEM_INGESTION_SECRET is required to start incoming verification plans',
            cause: undefined,
          })
        }
        const value = yield* Effect.tryPromise({
          try: () =>
            new ConvexHttpClient(convexUrl).mutation(
              startIncomingVerificationPlanMutation,
              {
                systemSecret: Redacted.value(systemIngestionSecret),
                workflowRunId: input.workflowRunId,
                verificationPlanId: input.verificationPlanId,
                candidatePatchSetId: input.candidatePatchSetId,
                incomingDispatchToken: input.incomingDispatchToken,
              },
            ),
          catch: (cause) =>
            new StorageError({
              operation: 'startIncomingVerificationPlan',
              message: 'Convex failed to start incoming verification plan',
              cause,
            }),
        })
        return yield* Schema.decodeUnknownEffect(Schema.Boolean)(value).pipe(
          Effect.mapError(
            (cause) =>
              new StorageError({
                operation: 'startIncomingVerificationPlan.decode',
                message:
                  'Convex returned invalid verification-plan start result',
                cause,
              }),
          ),
        )
      })

      const claimVerificationExecutionGroup = Effect.fn(
        '@patchplane/plugins/convex/claimVerificationExecutionGroup',
      )(function* (input: ClaimVerificationExecutionGroupInput) {
        if (systemIngestionSecret === undefined) {
          return yield* new StorageError({
            operation: 'claimVerificationExecutionGroup.config',
            message:
              'PATCHPLANE_SYSTEM_INGESTION_SECRET is required to claim verification execution groups',
            cause: undefined,
          })
        }
        const value = yield* Effect.tryPromise({
          try: () =>
            new ConvexHttpClient(convexUrl).mutation(
              claimVerificationExecutionGroupMutation,
              {
                systemSecret: Redacted.value(systemIngestionSecret),
                workflowRunId: input.workflowRunId,
                verificationPlanId: input.verificationPlanId,
                requirementId: input.requirementId,
                candidatePatchSetId: input.candidatePatchSetId,
                stableKey: input.stableKey,
                claimToken: input.claimToken,
                incomingDispatchToken: input.incomingDispatchToken,
                provider: input.provider,
                platform: input.platform,
                architecture: input.architecture,
                ...(input.commandDigest === undefined
                  ? {}
                  : { commandDigest: input.commandDigest }),
                ...(input.timeoutSeconds === undefined
                  ? {}
                  : { timeoutSeconds: input.timeoutSeconds }),
                claimedAt: input.claimedAt,
              },
            ),
          catch: (cause) =>
            new StorageError({
              operation: 'claimVerificationExecutionGroup',
              message: 'Convex failed to claim verification execution group',
              cause,
            }),
        })
        if (value === null) return undefined
        return yield* decodeVerificationExecutionGroup(value).pipe(
          Effect.mapError(
            (cause) =>
              new StorageError({
                operation: 'claimVerificationExecutionGroup.decode',
                message: 'Convex returned invalid verification execution group',
                cause,
              }),
          ),
        )
      })

      const startVerificationExecutionGroup = Effect.fn(
        '@patchplane/plugins/convex/startVerificationExecutionGroup',
      )(function* (input: StartVerificationExecutionGroupInput) {
        if (systemIngestionSecret === undefined) {
          return yield* new StorageError({
            operation: 'startVerificationExecutionGroup.config',
            message:
              'PATCHPLANE_SYSTEM_INGESTION_SECRET is required to start verification execution groups',
            cause: undefined,
          })
        }
        const value = yield* Effect.tryPromise({
          try: () =>
            new ConvexHttpClient(convexUrl).mutation(
              startVerificationExecutionGroupMutation,
              {
                systemSecret: Redacted.value(systemIngestionSecret),
                workflowRunId: input.workflowRunId,
                executionGroupId: input.executionGroupId,
                claimToken: input.claimToken,
                sandboxId: input.sandboxId,
              },
            ),
          catch: (cause) =>
            new StorageError({
              operation: 'startVerificationExecutionGroup',
              message: 'Convex failed to start verification execution group',
              cause,
            }),
        })
        return yield* Schema.decodeUnknownEffect(Schema.Boolean)(value).pipe(
          Effect.mapError(
            (cause) =>
              new StorageError({
                operation: 'startVerificationExecutionGroup.decode',
                message: 'Convex returned invalid execution-group start result',
                cause,
              }),
          ),
        )
      })

      const failVerificationExecutionGroup = Effect.fn(
        '@patchplane/plugins/convex/failVerificationExecutionGroup',
      )(function* (input: FailVerificationExecutionGroupInput) {
        if (systemIngestionSecret === undefined) {
          return yield* new StorageError({
            operation: 'failVerificationExecutionGroup.config',
            message:
              'PATCHPLANE_SYSTEM_INGESTION_SECRET is required to fail verification execution groups',
            cause: undefined,
          })
        }
        const value = yield* Effect.tryPromise({
          try: () =>
            new ConvexHttpClient(convexUrl).mutation(
              failVerificationExecutionGroupMutation,
              {
                systemSecret: Redacted.value(systemIngestionSecret),
                workflowRunId: input.workflowRunId,
                executionGroupId: input.executionGroupId,
                claimToken: input.claimToken,
                status: input.status,
                completedAt: input.completedAt,
              },
            ),
          catch: (cause) =>
            new StorageError({
              operation: 'failVerificationExecutionGroup',
              message: 'Convex failed to fail verification execution group',
              cause,
            }),
        })
        return yield* Schema.decodeUnknownEffect(Schema.Boolean)(value).pipe(
          Effect.mapError(
            (cause) =>
              new StorageError({
                operation: 'failVerificationExecutionGroup.decode',
                message:
                  'Convex returned invalid execution-group failure result',
                cause,
              }),
          ),
        )
      })

      const getVerificationExecutionState = Effect.fn(
        '@patchplane/plugins/convex/getVerificationExecutionState',
      )(function* (input: GetVerificationExecutionStateInput) {
        if (systemIngestionSecret === undefined) {
          return yield* new StorageError({
            operation: 'getVerificationExecutionState.config',
            message:
              'PATCHPLANE_SYSTEM_INGESTION_SECRET is required to read verification execution state',
            cause: undefined,
          })
        }
        const value = yield* Effect.tryPromise({
          try: () =>
            new ConvexHttpClient(convexUrl).query(
              getVerificationExecutionStateQuery,
              {
                systemSecret: Redacted.value(systemIngestionSecret),
                workflowRunId: input.workflowRunId,
                verificationPlanId: input.verificationPlanId,
                candidatePatchSetId: input.candidatePatchSetId,
              },
            ),
          catch: (cause) =>
            new StorageError({
              operation: 'getVerificationExecutionState',
              message: 'Convex failed to read verification execution state',
              cause,
            }),
        })
        return yield* Schema.decodeUnknownEffect(
          Schema.Struct({
            groups: Schema.Array(VerificationExecutionGroup),
            results: Schema.Array(VerificationResult),
            sandboxExecutions: Schema.Array(SandboxExecution),
          }),
        )(value).pipe(
          Effect.mapError(
            (cause) =>
              new StorageError({
                operation: 'getVerificationExecutionState.decode',
                message: 'Convex returned invalid verification execution state',
                cause,
              }),
          ),
        )
      })

      const recordVerificationResult = Effect.fn(
        '@patchplane/plugins/convex/recordVerificationResult',
      )(function* (input: RecordVerificationResultInput) {
        if (systemIngestionSecret === undefined) {
          return yield* new StorageError({
            operation: 'recordVerificationResult.config',
            message:
              'PATCHPLANE_SYSTEM_INGESTION_SECRET is required to record verification results',
            cause: undefined,
          })
        }
        const value = yield* Effect.tryPromise({
          try: () =>
            new ConvexHttpClient(convexUrl).mutation(
              recordVerificationResultMutation,
              {
                systemSecret: Redacted.value(systemIngestionSecret),
                workflowRunId: input.workflowRunId,
                ...(input.verificationPlanId === undefined
                  ? {}
                  : { verificationPlanId: input.verificationPlanId }),
                ...(input.executionGroupId === undefined
                  ? {}
                  : { executionGroupId: input.executionGroupId }),
                ...(input.executionGroupClaimToken === undefined
                  ? {}
                  : {
                      executionGroupClaimToken: input.executionGroupClaimToken,
                    }),
                requirementId: input.requirementId,
                candidatePatchSetId: input.candidatePatchSetId,
                ...(input.sandboxExecutionId === undefined
                  ? {}
                  : { sandboxExecutionId: input.sandboxExecutionId }),
                provider: input.provider,
                ...(input.command === undefined
                  ? {}
                  : { command: input.command }),
                ...(input.commandDigest === undefined
                  ? {}
                  : { commandDigest: input.commandDigest }),
                platform: input.platform,
                architecture: input.architecture,
                ...(input.environmentImage === undefined
                  ? {}
                  : { environmentImage: input.environmentImage }),
                status: input.status,
                ...(input.exitCode === undefined
                  ? {}
                  : { exitCode: input.exitCode }),
                ...(input.summary === undefined
                  ? {}
                  : { summary: input.summary }),
                ...(input.passedCount === undefined
                  ? {}
                  : { passedCount: input.passedCount }),
                ...(input.failedCount === undefined
                  ? {}
                  : { failedCount: input.failedCount }),
                ...(input.skippedCount === undefined
                  ? {}
                  : { skippedCount: input.skippedCount }),
                artifactIds: input.artifactIds,
                ...(input.stdoutArtifactId === undefined
                  ? {}
                  : { stdoutArtifactId: input.stdoutArtifactId }),
                ...(input.stderrArtifactId === undefined
                  ? {}
                  : { stderrArtifactId: input.stderrArtifactId }),
                ...(input.stdoutCaptureStatus === undefined
                  ? {}
                  : { stdoutCaptureStatus: input.stdoutCaptureStatus }),
                ...(input.stderrCaptureStatus === undefined
                  ? {}
                  : { stderrCaptureStatus: input.stderrCaptureStatus }),
                ...(input.cleanupStatus === undefined
                  ? {}
                  : { cleanupStatus: input.cleanupStatus }),
                ...(input.candidateDigestBefore === undefined
                  ? {}
                  : { candidateDigestBefore: input.candidateDigestBefore }),
                ...(input.candidateDigestAfter === undefined
                  ? {}
                  : { candidateDigestAfter: input.candidateDigestAfter }),
                startedAt: input.startedAt,
                ...(input.completedAt === undefined
                  ? {}
                  : { completedAt: input.completedAt }),
                idempotencyKey: input.idempotencyKey,
              },
            ),
          catch: (cause) =>
            new StorageError({
              operation: 'recordVerificationResult',
              message: 'Convex failed to record verification result',
              cause,
            }),
        })
        return yield* decodeVerificationResult(value).pipe(
          Effect.mapError(
            (cause) =>
              new StorageError({
                operation: 'recordVerificationResult.decode',
                message: 'Convex returned invalid verification result',
                cause,
              }),
          ),
        )
      })

      const recordReviewRun = Effect.fn(
        '@patchplane/plugins/convex/recordReviewRun',
      )(function* (input: RecordReviewRunInput) {
        if (systemIngestionSecret === undefined) {
          return yield* new StorageError({
            operation: 'recordReviewRun.config',
            message:
              'PATCHPLANE_SYSTEM_INGESTION_SECRET is required to record review runs',
            cause: undefined,
          })
        }
        const value = yield* Effect.tryPromise({
          try: () => {
            const client = new ConvexHttpClient(convexUrl)
            return client.mutation(recordReviewRunMutation, {
              systemSecret: Redacted.value(systemIngestionSecret),
              workflowRunId: input.workflowRunId,
              ...(input.sandboxExecutionId === undefined
                ? {}
                : { sandboxExecutionId: input.sandboxExecutionId }),
              ...(input.candidatePatchSetId === undefined
                ? {}
                : { candidatePatchSetId: input.candidatePatchSetId }),
              kind: input.kind,
              reviewer: input.reviewer,
              status: input.status,
              ...(input.summary === undefined
                ? {}
                : { summary: input.summary }),
              startedAt: input.startedAt,
              ...(input.completedAt === undefined
                ? {}
                : { completedAt: input.completedAt }),
              idempotencyKey: input.idempotencyKey,
              ...(input.createdAt === undefined
                ? {}
                : { createdAt: input.createdAt }),
            })
          },
          catch: (cause) =>
            new StorageError({
              operation: 'recordReviewRun',
              message: 'Convex failed to record review run',
              cause,
            }),
        })
        return yield* decodeReviewRun(value).pipe(
          Effect.mapError(
            (cause) =>
              new StorageError({
                operation: 'recordReviewRun.decode',
                message: 'Convex returned invalid review run',
                cause,
              }),
          ),
        )
      })

      const recordReviewFinding = Effect.fn(
        '@patchplane/plugins/convex/recordReviewFinding',
      )(function* (input: RecordReviewFindingInput) {
        if (systemIngestionSecret === undefined) {
          return yield* new StorageError({
            operation: 'recordReviewFinding.config',
            message:
              'PATCHPLANE_SYSTEM_INGESTION_SECRET is required to record review findings',
            cause: undefined,
          })
        }
        const value = yield* Effect.tryPromise({
          try: () => {
            const client = new ConvexHttpClient(convexUrl)
            return client.mutation(recordReviewFindingMutation, {
              systemSecret: Redacted.value(systemIngestionSecret),
              workflowRunId: input.workflowRunId,
              ...(input.reviewRunId === undefined
                ? {}
                : { reviewRunId: input.reviewRunId }),
              severity: input.severity,
              category: input.category,
              message: input.message,
              ...(input.path === undefined ? {} : { path: input.path }),
              ...(input.startLine === undefined
                ? {}
                : { startLine: input.startLine }),
              ...(input.endLine === undefined
                ? {}
                : { endLine: input.endLine }),
              ...(input.evidenceArtifactId === undefined
                ? {}
                : { evidenceArtifactId: input.evidenceArtifactId }),
              idempotencyKey: input.idempotencyKey,
              ...(input.createdAt === undefined
                ? {}
                : { createdAt: input.createdAt }),
            })
          },
          catch: (cause) =>
            new StorageError({
              operation: 'recordReviewFinding',
              message: 'Convex failed to record review finding',
              cause,
            }),
        })
        return yield* decodeReviewFinding(value).pipe(
          Effect.mapError(
            (cause) =>
              new StorageError({
                operation: 'recordReviewFinding.decode',
                message: 'Convex returned invalid review finding',
                cause,
              }),
          ),
        )
      })

      const recordPolicyDecision = Effect.fn(
        '@patchplane/plugins/convex/recordPolicyDecision',
      )(function* (input: RecordPolicyDecisionInput) {
        if (systemIngestionSecret === undefined) {
          return yield* new StorageError({
            operation: 'recordPolicyDecision.config',
            message:
              'PATCHPLANE_SYSTEM_INGESTION_SECRET is required to record policy decisions',
            cause: undefined,
          })
        }
        const value = yield* Effect.tryPromise({
          try: () => {
            const client = new ConvexHttpClient(convexUrl)
            return client.mutation(recordPolicyDecisionMutation, {
              systemSecret: Redacted.value(systemIngestionSecret),
              workflowRunId: input.workflowRunId,
              ...(input.reviewRunId === undefined
                ? {}
                : { reviewRunId: input.reviewRunId }),
              ...(input.candidatePatchSetId === undefined
                ? {}
                : { candidatePatchSetId: input.candidatePatchSetId }),
              status: input.status,
              summary: input.summary,
              ...(input.reason === undefined ? {} : { reason: input.reason }),
              ...(input.policyVersion === undefined
                ? {}
                : { policyVersion: input.policyVersion }),
              ...(input.inputDigest === undefined
                ? {}
                : { inputDigest: input.inputDigest }),
              ...(input.verificationResultIds === undefined
                ? {}
                : { verificationResultIds: input.verificationResultIds }),
              ...(input.reviewFindingIds === undefined
                ? {}
                : { reviewFindingIds: input.reviewFindingIds }),
              ...(input.missingRequirementIds === undefined
                ? {}
                : { missingRequirementIds: input.missingRequirementIds }),
              idempotencyKey: input.idempotencyKey,
              ...(input.createdAt === undefined
                ? {}
                : { createdAt: input.createdAt }),
            })
          },
          catch: (cause) =>
            new StorageError({
              operation: 'recordPolicyDecision',
              message: 'Convex failed to record policy decision',
              cause,
            }),
        })
        return yield* decodePolicyDecision(value).pipe(
          Effect.mapError(
            (cause) =>
              new StorageError({
                operation: 'recordPolicyDecision.decode',
                message: 'Convex returned invalid policy decision',
                cause,
              }),
          ),
        )
      })

      const recordPublicationResult = Effect.fn(
        '@patchplane/plugins/convex/recordPublicationResult',
      )(function* (input: RecordPublicationResultInput) {
        if (systemIngestionSecret === undefined) {
          return yield* new StorageError({
            operation: 'recordPublicationResult.config',
            message:
              'PATCHPLANE_SYSTEM_INGESTION_SECRET is required to record publication results',
            cause: undefined,
          })
        }
        const value = yield* Effect.tryPromise({
          try: () => {
            const client = new ConvexHttpClient(convexUrl)
            return client.mutation(recordPublicationResultMutation, {
              systemSecret: Redacted.value(systemIngestionSecret),
              workflowRunId: input.workflowRunId,
              ...(input.humanDecisionId === undefined
                ? {}
                : { humanDecisionId: input.humanDecisionId }),
              ...(input.candidatePatchSetId === undefined
                ? {}
                : { candidatePatchSetId: input.candidatePatchSetId }),
              ...(input.targetSha === undefined
                ? {}
                : { targetSha: input.targetSha }),
              provider: input.provider,
              kind: input.kind,
              status: input.status,
              ...(input.externalId === undefined
                ? {}
                : { externalId: input.externalId }),
              ...(input.url === undefined ? {} : { url: input.url }),
              ...(input.summary === undefined
                ? {}
                : { summary: input.summary }),
              ...(input.error === undefined ? {} : { error: input.error }),
              ...(input.dispatchToken === undefined
                ? {}
                : { dispatchToken: input.dispatchToken }),
              ...(input.createdAt === undefined
                ? {}
                : { createdAt: input.createdAt }),
              ...(input.idempotencyKey === undefined
                ? {}
                : { idempotencyKey: input.idempotencyKey }),
            })
          },
          catch: (cause) =>
            new StorageError({
              operation: 'recordPublicationResult',
              message: 'Convex failed to record publication result',
              cause,
            }),
        })
        return yield* decodePublicationResult(value).pipe(
          Effect.mapError(
            (cause) =>
              new StorageError({
                operation: 'recordPublicationResult.decode',
                message: 'Convex returned invalid publication result',
                cause,
              }),
          ),
        )
      })

      const recordProvenanceEvent = Effect.fn(
        '@patchplane/plugins/convex/recordProvenanceEvent',
      )(function* (input: RecordProvenanceEventInput) {
        if (systemIngestionSecret === undefined) {
          return yield* new StorageError({
            operation: 'recordProvenanceEvent.config',
            message:
              'PATCHPLANE_SYSTEM_INGESTION_SECRET is required to record provenance events',
            cause: undefined,
          })
        }
        const value = yield* Effect.tryPromise({
          try: () => {
            const client = new ConvexHttpClient(convexUrl)
            return client.mutation(recordProvenanceEventMutation, {
              systemSecret: Redacted.value(systemIngestionSecret),
              workflowRunId: input.workflowRunId,
              traceId: input.traceId,
              ...(input.parentEventId === undefined
                ? {}
                : { parentEventId: input.parentEventId }),
              type: input.type,
              operation: input.operation,
              ...(input.pluginName === undefined
                ? {}
                : { pluginName: input.pluginName }),
              status: input.status,
              startedAt: input.startedAt,
              ...(input.completedAt === undefined
                ? {}
                : { completedAt: input.completedAt }),
              ...(input.summary === undefined
                ? {}
                : { summary: input.summary }),
              artifactRefs: input.artifactRefs ?? [],
              ...(input.errorCategory === undefined
                ? {}
                : { errorCategory: input.errorCategory }),
              ...(input.idempotencyKey === undefined
                ? {}
                : { idempotencyKey: input.idempotencyKey }),
            })
          },
          catch: (cause) =>
            new StorageError({
              operation: 'recordProvenanceEvent',
              message: 'Convex failed to record provenance event',
              cause,
            }),
        })
        return yield* decodeProvenanceEvent(value).pipe(
          Effect.mapError(
            (cause) =>
              new StorageError({
                operation: 'recordProvenanceEvent.decode',
                message: 'Convex returned invalid provenance event',
                cause,
              }),
          ),
        )
      })

      return StorageService.of({
        createWorkflowFromIntake: createWorkflowFromPrompt,
        createWorkflowFromPrompt,
        listRecentWorkflowStarts,
        recordRuntimeEvents,
        recordRuntimeSessionStarted,
        markRuntimeSessionStatus,
        getActiveRuntimeSession,
        claimWorkflowExecution,
        markWorkflowExecutionFailed,
        recordSandboxExecution,
        recordEvidenceArtifact,
        getEvidenceArtifact,
        getCandidatePatchSetForWorkflow,
        claimCandidateFreeze,
        releaseCandidateFreeze,
        failCandidateFreeze,
        claimIncomingDispatch,
        startIncomingDispatch,
        validateIncomingDispatch,
        recordCandidatePatchSet,
        recordVerificationPlan,
        recordVerificationRequirement,
        startIncomingVerificationPlan,
        claimVerificationExecutionGroup,
        startVerificationExecutionGroup,
        failVerificationExecutionGroup,
        getVerificationExecutionState,
        recordVerificationResult,
        recordReviewRun,
        recordReviewFinding,
        recordPolicyDecision,
        recordPublicationResult,
        recordProvenanceEvent,
      })
    }),
  ),
  config: ConvexConfig,
} satisfies {
  readonly layer: Layer.Layer<StorageService, Config.ConfigError>
  readonly config: typeof ConvexConfig
}
