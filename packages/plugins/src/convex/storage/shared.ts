import { makeFunctionReference } from 'convex/server'
import { Effect } from 'effect'
import { StorageError } from '@patchplane/domain/errors'
import {
  type ClaimVerificationExecutionGroupInput,
  type FailVerificationExecutionGroupInput,
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
} from '@patchplane/core/services/storage-service'

export function settleWithin<T>(input: {
  readonly promise: Promise<T>
  readonly timeoutMs: number
  readonly operation: string
  readonly message: string
}) {
  return Effect.tryPromise({
    try: () => input.promise,
    catch: (cause) =>
      new StorageError({
        operation: input.operation,
        message: input.message,
        cause,
      }),
  }).pipe(
    Effect.timeout(input.timeoutMs),
    Effect.mapError(
      (cause) =>
        new StorageError({
          operation: input.operation,
          message: input.message,
          cause,
        }),
    ),
  )
}

export interface ExternalWorkflowRefInput {
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

export const createWorkflowStartMutation = makeFunctionReference<
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

export const createWorkflowStartFromExternalIntakeMutation =
  makeFunctionReference<
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

export const recordRuntimeEventsMutation = makeFunctionReference<
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

export const recordRuntimeSessionStartedMutation = makeFunctionReference<
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

export const markRuntimeSessionStatusMutation = makeFunctionReference<
  'mutation',
  {
    systemSecret: string
    runtimeSessionId: string
    status: 'starting' | 'running' | 'completed' | 'failed' | 'cancelled'
    completedAt?: number
  },
  unknown
>('workflowStarts:markRuntimeSessionStatus')

export const getActiveRuntimeSessionQuery = makeFunctionReference<
  'query',
  {
    systemSecret: string
    workflowRunId: string
  },
  unknown
>('workflowStarts:getActiveRuntimeSession')

export const claimWorkflowExecutionMutation = makeFunctionReference<
  'mutation',
  { systemSecret: string; workflowRunId: string },
  boolean
>('workflowStarts:claimWorkflowExecution')

export const markWorkflowExecutionFailedMutation = makeFunctionReference<
  'mutation',
  {
    systemSecret: string
    workflowRunId: string
    incomingDispatchToken?: string
    summary: string
  },
  boolean
>('workflowStarts:markWorkflowExecutionFailed')

export const recordSandboxExecutionMutation = makeFunctionReference<
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
    providerSessionId?: string
    providerCommandId?: string
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

export const recordEvidenceArtifactMutation = makeFunctionReference<
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

export const getEvidenceArtifactQuery = makeFunctionReference<
  'query',
  {
    artifactId: string
    workflowRunId?: string
    systemSecret?: string
  },
  unknown
>('workflowStarts:getEvidenceArtifact')

export const getCandidatePatchSetForWorkflowQuery = makeFunctionReference<
  'query',
  { systemSecret: string; workflowRunId: string },
  unknown
>('workflowStarts:getCandidatePatchSetForWorkflow')

export const claimCandidateFreezeMutation = makeFunctionReference<
  'mutation',
  { systemSecret: string; workflowRunId: string; leaseToken: string },
  boolean
>('workflowStarts:claimCandidateFreeze')

export const releaseCandidateFreezeMutation = makeFunctionReference<
  'mutation',
  { systemSecret: string; workflowRunId: string; leaseToken: string },
  boolean
>('workflowStarts:releaseCandidateFreeze')

export const failCandidateFreezeMutation = makeFunctionReference<
  'mutation',
  {
    systemSecret: string
    workflowRunId: string
    leaseToken: string
    summary: string
  },
  boolean
>('workflowStarts:failCandidateFreeze')

export const claimIncomingDispatchMutation = makeFunctionReference<
  'mutation',
  {
    systemSecret: string
    workflowRunId: string
    candidatePatchSetId: string
    dispatchToken: string
  },
  boolean
>('workflowStarts:claimIncomingDispatch')

export const startIncomingDispatchMutation = makeFunctionReference<
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

export const validateIncomingDispatchMutation = makeFunctionReference<
  'mutation',
  {
    systemSecret: string
    workflowRunId: string
    candidatePatchSetId: string
    dispatchToken: string
  },
  boolean
>('workflowStarts:validateIncomingDispatch')

export const recordCandidatePatchSetMutation = makeFunctionReference<
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

export const recordVerificationPlanMutation = makeFunctionReference<
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

export const recordVerificationRequirementMutation = makeFunctionReference<
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

export const startIncomingVerificationPlanMutation = makeFunctionReference<
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

export const claimVerificationExecutionGroupMutation = makeFunctionReference<
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

export const startVerificationExecutionGroupMutation = makeFunctionReference<
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

export const recordVerificationExecutionCommandMutation = makeFunctionReference<
  'mutation',
  {
    systemSecret: string
    workflowRunId: string
    executionGroupId: string
    claimToken: string
    sandboxId: string
    providerSessionId: string
    providerCommandId: string
  },
  boolean
>('workflowStarts:recordVerificationExecutionCommand')

export const failVerificationExecutionGroupMutation = makeFunctionReference<
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

export const getVerificationExecutionStateQuery = makeFunctionReference<
  'query',
  {
    systemSecret: string
    workflowRunId: string
    verificationPlanId: string
    candidatePatchSetId: string
  },
  unknown
>('workflowStarts:getVerificationExecutionState')

export const recordVerificationResultMutation = makeFunctionReference<
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
    providerSessionId?: string
    providerCommandId?: string
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

export const recordReviewRunMutation = makeFunctionReference<
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

export const recordReviewFindingMutation = makeFunctionReference<
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

export const recordPolicyDecisionMutation = makeFunctionReference<
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

export const recordPublicationResultMutation = makeFunctionReference<
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

export const recordProvenanceEventMutation = makeFunctionReference<
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

export const listRecentWorkflowStartsQuery = makeFunctionReference<
  'query',
  {
    workspaceId: string
    limit?: number
  },
  unknown
>('workflowStarts:listRecent')
