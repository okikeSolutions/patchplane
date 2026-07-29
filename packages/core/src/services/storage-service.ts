import { Context, Effect, type Option } from 'effect'
import type { Actor } from '@patchplane/domain/actor'
import type { CandidateSubject } from '@patchplane/domain/candidate-subject'
import type {
  CandidatePatchSet,
  CandidatePatchSetStatus,
  HumanDecision,
  PolicyDecision,
  PolicyDecisionStatus,
  ProvenanceEvent,
  ProvenanceEventStatus,
  PublicationResult,
  PublicationResultKind,
  PublicationResultStatus,
  ReviewFinding,
  ReviewFindingCategory,
  ReviewFindingSeverity,
  ReviewRun,
  ReviewRunKind,
  ReviewRunStatus,
} from '@patchplane/domain/decision-review'
import type { StorageError } from '@patchplane/domain/errors'
import type {
  EvidenceArtifact,
  EvidenceArtifactKind,
} from '@patchplane/domain/evidence-artifact'
import type { ExternalWorkflowRef } from '@patchplane/domain/external-workflow-ref'
import type { WorkflowRunId, WorkspaceId } from '@patchplane/domain/ids'
import type { ListRecentWorkflowStartsInput } from '@patchplane/domain/list-recent-workflow-starts'
import type { PromptRequestSource } from '@patchplane/domain/prompt-request'
import type { RuntimeEvent as StoredRuntimeEvent } from '@patchplane/domain/runtime-event'
import type {
  RuntimeSession,
  RuntimeSessionStatus,
} from '@patchplane/domain/runtime-session'
import type { SandboxExecution } from '@patchplane/domain/sandbox-execution'
import type { SandboxPolicy } from '@patchplane/domain/sandbox-policy'
import type {
  GitCommitSha,
  ProviderProcessId,
} from '@patchplane/domain/refinements'
import type {
  VerificationExecutionGroup,
  VerificationPlanV1,
  VerificationPlanRequirementV1,
  VerificationPlanSource,
  VerificationRequirement,
  VerificationRequirementKind,
  VerificationRequirementSource,
  VerificationPlatform,
  VerificationResult,
  VerificationResultStatus,
} from '@patchplane/domain/verification'
import type { WorkflowIntake } from '@patchplane/domain/workflow-intake'
import type { WorkflowStart } from '@patchplane/domain/workflow-start'
import type { TelemetryContextFields } from './telemetry-service'

export type { ListRecentWorkflowStartsInput }

export interface StorageListRecentWorkflowStartsInput
  extends ListRecentWorkflowStartsInput, TelemetryContextFields {
  readonly authToken?: string
}

export interface CreateWorkflowFromPromptInput extends TelemetryContextFields {
  readonly actor: Actor
  readonly workspaceId: WorkspaceId
  readonly source: PromptRequestSource
  readonly traceId: string
  readonly prompt: string
  readonly externalRef?: ExternalWorkflowRef | undefined
  readonly authToken?: string
}

export interface ClaimWorkflowExecutionInput extends TelemetryContextFields {
  readonly workflowRunId: WorkflowRunId
}

export interface MarkWorkflowExecutionFailedInput extends TelemetryContextFields {
  readonly workflowRunId: WorkflowRunId
  readonly incomingDispatchToken?: string | undefined
  readonly summary: string
}

export interface RecordSandboxExecutionInput extends TelemetryContextFields {
  readonly workflowRunId: WorkflowRunId
  readonly incomingDispatchToken?: string | undefined
  readonly executionGroupId?: VerificationExecutionGroup['id'] | undefined
  readonly executionGroupClaimToken?: string | undefined
  readonly idempotencyKey?: string | undefined
  readonly provider: string
  readonly sandboxId: string
  readonly providerSessionId?: ProviderProcessId | undefined
  readonly providerCommandId?: ProviderProcessId | undefined
  readonly command: string
  readonly status: 'succeeded' | 'failed'
  readonly exitCode?: number | undefined
  readonly stdout: string
  readonly stderr?: string | undefined
  readonly policy?: SandboxPolicy | undefined
  readonly startedAt: number
  readonly completedAt: number
}

export interface RecordRuntimeSessionStartedInput extends TelemetryContextFields {
  readonly workflowRunId: WorkflowRunId
  readonly provider: string
  readonly sandboxId: string
  readonly sessionId: string
  readonly commandId: string
  readonly startedAt: number
}

export interface MarkRuntimeSessionStatusInput extends TelemetryContextFields {
  readonly runtimeSessionId: RuntimeSession['id']
  readonly status: RuntimeSessionStatus
  readonly completedAt?: number | undefined
}

export interface GetActiveRuntimeSessionInput extends TelemetryContextFields {
  readonly workflowRunId: WorkflowRunId
}

export interface RecordRuntimeEventInput extends TelemetryContextFields {
  readonly workflowRunId: WorkflowRunId
  readonly provider: string
  readonly type: string
  readonly occurredAt: number
  readonly summary?: string | undefined
  readonly payloadJson?: string | undefined
  readonly idempotencyKey?: string | undefined
  readonly sourceSessionId?: string | undefined
  readonly sourceCommandId?: string | undefined
  readonly sourceStream?: 'stdout' | 'stderr' | undefined
  readonly sourceLine?: number | undefined
  readonly sourceOffset?: number | undefined
}

export interface RecordEvidenceArtifactInput extends TelemetryContextFields {
  readonly workflowRunId: WorkflowRunId
  readonly producer?: string | undefined
  readonly subjectDigest?: string | undefined
  readonly traceId?: string | undefined
  readonly kind: EvidenceArtifactKind
  readonly label?: string | undefined
  readonly storageProvider: 'cloudflare-r2'
  readonly storageKey: string
  readonly contentType: string
  readonly sizeBytes: number
  readonly sha256: string
  readonly retentionPolicy?: string | undefined
  readonly createdAt?: number | undefined
}

export interface GetEvidenceArtifactInput extends TelemetryContextFields {
  readonly artifactId: EvidenceArtifact['id']
  readonly workflowRunId?: WorkflowRunId | undefined
  readonly authToken?: string | undefined
}

export interface CandidateFreezeInput extends TelemetryContextFields {
  readonly workflowRunId: WorkflowRunId
  readonly leaseToken: string
}

export interface FailCandidateFreezeInput extends CandidateFreezeInput {
  readonly summary: string
}

export interface IncomingDispatchClaimInput extends TelemetryContextFields {
  readonly workflowRunId: WorkflowRunId
  readonly candidatePatchSetId: CandidatePatchSet['id']
  readonly dispatchToken: string
}

export interface StartIncomingDispatchInput extends IncomingDispatchClaimInput {
  readonly sandboxId: string
}

export interface GetCandidatePatchSetForWorkflowInput extends TelemetryContextFields {
  readonly workflowRunId: WorkflowRunId
}

export interface RecordCandidatePatchSetInput extends TelemetryContextFields {
  readonly workflowRunId: WorkflowRunId
  readonly sandboxExecutionId?: SandboxExecution['id'] | undefined
  readonly subject?: CandidateSubject | undefined
  readonly candidateFreezeLeaseToken?: string | undefined
  readonly status: CandidatePatchSetStatus
  readonly candidateDigest?: string | undefined
  readonly baseRef?: string | undefined
  readonly baseSha?: GitCommitSha | undefined
  readonly headRef?: string | undefined
  readonly headSha?: GitCommitSha | undefined
  readonly diffArtifactId?: EvidenceArtifact['id'] | undefined
  readonly summary?: string | undefined
  readonly stats?:
    | {
        readonly filesChanged: number
        readonly additions: number
        readonly deletions: number
      }
    | undefined
  readonly idempotencyKey: string
  readonly createdAt: number
}

export interface RecordVerificationPlanInput extends TelemetryContextFields {
  readonly workflowRunId: WorkflowRunId
  readonly version: 'verification-plan-v1'
  readonly sources: ReadonlyArray<VerificationPlanSource>
  readonly requirements: ReadonlyArray<VerificationPlanRequirementV1>
  readonly digest: VerificationPlanV1['digest']
  readonly createdAt: number
}

export interface RecordVerificationRequirementInput extends TelemetryContextFields {
  readonly workflowRunId: WorkflowRunId
  readonly verificationPlanId?: VerificationPlanV1['id'] | undefined
  readonly key: string
  readonly label: string
  readonly kind: VerificationRequirementKind
  readonly required: boolean
  readonly command?: string | undefined
  readonly platform?: VerificationPlatform | undefined
  readonly architecture?: string | undefined
  readonly timeoutSeconds?: number | undefined
  readonly requiredArtifactKinds: ReadonlyArray<EvidenceArtifactKind>
  readonly source: VerificationRequirementSource
  readonly createdAt: number
}

export interface StartIncomingVerificationPlanInput extends TelemetryContextFields {
  readonly workflowRunId: WorkflowRunId
  readonly verificationPlanId: VerificationPlanV1['id']
  readonly candidatePatchSetId: CandidatePatchSet['id']
  readonly incomingDispatchToken: string
}

export interface ClaimVerificationExecutionGroupInput extends TelemetryContextFields {
  readonly workflowRunId: WorkflowRunId
  readonly verificationPlanId: VerificationPlanV1['id']
  readonly requirementId: VerificationRequirement['id']
  readonly candidatePatchSetId: CandidatePatchSet['id']
  readonly stableKey: string
  readonly claimToken: string
  readonly incomingDispatchToken: string
  readonly provider: string
  readonly platform: VerificationPlatform
  readonly architecture: VerificationExecutionGroup['architecture']
  readonly commandDigest?:
    | VerificationExecutionGroup['commandDigest']
    | undefined
  readonly timeoutSeconds?:
    | VerificationExecutionGroup['timeoutSeconds']
    | undefined
  readonly claimedAt: VerificationExecutionGroup['claimedAt']
}

export interface StartVerificationExecutionGroupInput extends TelemetryContextFields {
  readonly workflowRunId: WorkflowRunId
  readonly executionGroupId: VerificationExecutionGroup['id']
  readonly claimToken: string
  readonly sandboxId: string
}

export interface RecordVerificationExecutionCommandInput extends TelemetryContextFields {
  readonly workflowRunId: WorkflowRunId
  readonly executionGroupId: VerificationExecutionGroup['id']
  readonly claimToken: string
  readonly sandboxId: string
  readonly providerSessionId: ProviderProcessId
  readonly providerCommandId: ProviderProcessId
}

export interface FailVerificationExecutionGroupInput extends TelemetryContextFields {
  readonly workflowRunId: WorkflowRunId
  readonly executionGroupId: VerificationExecutionGroup['id']
  readonly claimToken: string
  readonly status: 'failed' | 'blocked' | 'cancelled'
  readonly completedAt: NonNullable<VerificationExecutionGroup['completedAt']>
}

export interface GetVerificationExecutionStateInput extends TelemetryContextFields {
  readonly workflowRunId: WorkflowRunId
  readonly verificationPlanId: VerificationPlanV1['id']
  readonly candidatePatchSetId: CandidatePatchSet['id']
}

export interface VerificationExecutionState {
  readonly groups: ReadonlyArray<VerificationExecutionGroup>
  readonly results: ReadonlyArray<VerificationResult>
  readonly sandboxExecutions: ReadonlyArray<SandboxExecution>
}

export interface RecordVerificationResultInput extends TelemetryContextFields {
  readonly workflowRunId: WorkflowRunId
  readonly verificationPlanId?: VerificationPlanV1['id'] | undefined
  readonly executionGroupId?: VerificationExecutionGroup['id'] | undefined
  readonly executionGroupClaimToken?: string | undefined
  readonly requirementId: VerificationRequirement['id']
  readonly candidatePatchSetId: CandidatePatchSet['id']
  readonly sandboxExecutionId?: SandboxExecution['id'] | undefined
  readonly provider: string
  readonly command?: string | undefined
  readonly commandDigest?: VerificationResult['commandDigest'] | undefined
  readonly platform: VerificationPlatform
  readonly architecture: VerificationResult['architecture']
  readonly environmentImage?: string | undefined
  readonly providerSessionId?: ProviderProcessId | undefined
  readonly providerCommandId?: ProviderProcessId | undefined
  readonly status: VerificationResultStatus
  readonly exitCode?: number | undefined
  readonly summary?: string | undefined
  readonly passedCount?: number | undefined
  readonly failedCount?: number | undefined
  readonly skippedCount?: number | undefined
  readonly artifactIds: ReadonlyArray<EvidenceArtifact['id']>
  readonly producedArtifactKinds: ReadonlyArray<EvidenceArtifactKind>
  readonly stdoutArtifactId?: EvidenceArtifact['id'] | undefined
  readonly stderrArtifactId?: EvidenceArtifact['id'] | undefined
  readonly stdoutCaptureStatus?: 'captured' | 'truncated' | 'failed' | undefined
  readonly stderrCaptureStatus?: 'captured' | 'truncated' | 'failed' | undefined
  readonly cleanupStatus?:
    | 'deleted'
    | 'failed'
    | 'retained'
    | 'not-started'
    | undefined
  readonly candidateDigestBefore?:
    | VerificationResult['candidateDigestBefore']
    | undefined
  readonly candidateDigestAfter?:
    | VerificationResult['candidateDigestAfter']
    | undefined
  readonly startedAt: VerificationResult['startedAt']
  readonly completedAt?: VerificationResult['completedAt'] | undefined
  readonly idempotencyKey: string
}

export interface RecordReviewRunInput extends TelemetryContextFields {
  readonly workflowRunId: WorkflowRunId
  readonly sandboxExecutionId?: SandboxExecution['id'] | undefined
  readonly candidatePatchSetId?: CandidatePatchSet['id'] | undefined
  readonly kind: ReviewRunKind
  readonly reviewer: string
  readonly status: ReviewRunStatus
  readonly summary?: string | undefined
  readonly startedAt: number
  readonly completedAt?: number | undefined
  readonly idempotencyKey: string
  readonly createdAt?: number | undefined
}

export interface RecordReviewFindingInput extends TelemetryContextFields {
  readonly workflowRunId: WorkflowRunId
  readonly reviewRunId?: ReviewRun['id'] | undefined
  readonly severity: ReviewFindingSeverity
  readonly category: ReviewFindingCategory
  readonly message: string
  readonly path?: string | undefined
  readonly startLine?: number | undefined
  readonly endLine?: number | undefined
  readonly evidenceArtifactId?: EvidenceArtifact['id'] | undefined
  readonly idempotencyKey: string
  readonly createdAt?: number | undefined
}

export interface RecordPolicyDecisionInput extends TelemetryContextFields {
  readonly workflowRunId: WorkflowRunId
  readonly reviewRunId?: ReviewRun['id'] | undefined
  readonly candidatePatchSetId?: CandidatePatchSet['id'] | undefined
  readonly status: PolicyDecisionStatus
  readonly summary: string
  readonly reason?: string | undefined
  readonly policyVersion?: string | undefined
  readonly inputDigest?: string | undefined
  readonly verificationResultIds?:
    | ReadonlyArray<VerificationResult['id']>
    | undefined
  readonly reviewFindingIds?: ReadonlyArray<ReviewFinding['id']> | undefined
  readonly missingRequirementIds?:
    | ReadonlyArray<VerificationRequirement['id']>
    | undefined
  readonly idempotencyKey: string
  readonly createdAt?: number | undefined
}

export interface RecordPublicationResultInput extends TelemetryContextFields {
  readonly workflowRunId: WorkflowRunId
  readonly humanDecisionId?: HumanDecision['id'] | undefined
  readonly candidatePatchSetId?: CandidatePatchSet['id'] | undefined
  readonly targetSha?: GitCommitSha | undefined
  readonly provider: string
  readonly kind: PublicationResultKind
  readonly status: PublicationResultStatus
  readonly externalId?: string | undefined
  readonly url?: string | undefined
  readonly summary?: string | undefined
  readonly error?: string | undefined
  readonly dispatchToken?: string | undefined
  readonly createdAt?: number | undefined
  readonly idempotencyKey?: string | undefined
}

export interface RecordProvenanceEventInput extends TelemetryContextFields {
  readonly workflowRunId: WorkflowRunId
  readonly traceId: string
  readonly parentEventId?: ProvenanceEvent['id'] | undefined
  readonly type: string
  readonly operation: string
  readonly pluginName?: string | undefined
  readonly status: ProvenanceEventStatus
  readonly startedAt: number
  readonly completedAt?: number | undefined
  readonly summary?: string | undefined
  readonly artifactRefs?: ReadonlyArray<string> | undefined
  readonly errorCategory?: string | undefined
  readonly idempotencyKey?: string | undefined
}

export class StorageService extends Context.Service<
  StorageService,
  {
    readonly createWorkflowFromIntake: (
      input: WorkflowIntake,
    ) => Effect.Effect<WorkflowStart, StorageError>
    readonly createWorkflowFromPrompt: (
      input: CreateWorkflowFromPromptInput,
    ) => Effect.Effect<WorkflowStart, StorageError>
    readonly listRecentWorkflowStarts: (
      input: StorageListRecentWorkflowStartsInput,
    ) => Effect.Effect<ReadonlyArray<WorkflowStart>, StorageError>
    readonly claimWorkflowExecution: (
      input: ClaimWorkflowExecutionInput,
    ) => Effect.Effect<boolean, StorageError>
    readonly markWorkflowExecutionFailed: (
      input: MarkWorkflowExecutionFailedInput,
    ) => Effect.Effect<boolean, StorageError>
    readonly recordSandboxExecution: (
      input: RecordSandboxExecutionInput,
    ) => Effect.Effect<SandboxExecution, StorageError>
    readonly recordRuntimeEvents: (
      input: ReadonlyArray<RecordRuntimeEventInput>,
    ) => Effect.Effect<ReadonlyArray<StoredRuntimeEvent>, StorageError>
    readonly recordRuntimeSessionStarted: (
      input: RecordRuntimeSessionStartedInput,
    ) => Effect.Effect<RuntimeSession, StorageError>
    readonly markRuntimeSessionStatus: (
      input: MarkRuntimeSessionStatusInput,
    ) => Effect.Effect<RuntimeSession, StorageError>
    readonly getActiveRuntimeSession: (
      input: GetActiveRuntimeSessionInput,
    ) => Effect.Effect<Option.Option<RuntimeSession>, StorageError>
    readonly recordEvidenceArtifact: (
      input: RecordEvidenceArtifactInput,
    ) => Effect.Effect<EvidenceArtifact, StorageError>
    readonly getEvidenceArtifact: (
      input: GetEvidenceArtifactInput,
    ) => Effect.Effect<Option.Option<EvidenceArtifact>, StorageError>
    readonly getCandidatePatchSetForWorkflow: (
      input: GetCandidatePatchSetForWorkflowInput,
    ) => Effect.Effect<Option.Option<CandidatePatchSet>, StorageError>
    readonly claimCandidateFreeze: (
      input: CandidateFreezeInput,
    ) => Effect.Effect<boolean, StorageError>
    readonly releaseCandidateFreeze: (
      input: CandidateFreezeInput,
    ) => Effect.Effect<boolean, StorageError>
    readonly failCandidateFreeze: (
      input: FailCandidateFreezeInput,
    ) => Effect.Effect<boolean, StorageError>
    readonly claimIncomingDispatch: (
      input: IncomingDispatchClaimInput,
    ) => Effect.Effect<boolean, StorageError>
    readonly validateIncomingDispatch: (
      input: IncomingDispatchClaimInput,
    ) => Effect.Effect<boolean, StorageError>
    readonly startIncomingDispatch: (
      input: StartIncomingDispatchInput,
    ) => Effect.Effect<boolean, StorageError>
    readonly recordCandidatePatchSet: (
      input: RecordCandidatePatchSetInput,
    ) => Effect.Effect<CandidatePatchSet, StorageError>
    readonly recordVerificationPlan: (
      input: RecordVerificationPlanInput,
    ) => Effect.Effect<VerificationPlanV1, StorageError>
    readonly recordVerificationRequirement: (
      input: RecordVerificationRequirementInput,
    ) => Effect.Effect<VerificationRequirement, StorageError>
    readonly startIncomingVerificationPlan: (
      input: StartIncomingVerificationPlanInput,
    ) => Effect.Effect<boolean, StorageError>
    readonly claimVerificationExecutionGroup: (
      input: ClaimVerificationExecutionGroupInput,
    ) => Effect.Effect<VerificationExecutionGroup | undefined, StorageError>
    readonly startVerificationExecutionGroup: (
      input: StartVerificationExecutionGroupInput,
    ) => Effect.Effect<boolean, StorageError>
    readonly recordVerificationExecutionCommand?: (
      input: RecordVerificationExecutionCommandInput,
    ) => Effect.Effect<boolean, StorageError>
    readonly failVerificationExecutionGroup: (
      input: FailVerificationExecutionGroupInput,
    ) => Effect.Effect<boolean, StorageError>
    readonly getVerificationExecutionState: (
      input: GetVerificationExecutionStateInput,
    ) => Effect.Effect<VerificationExecutionState, StorageError>
    readonly recordVerificationResult: (
      input: RecordVerificationResultInput,
    ) => Effect.Effect<VerificationResult, StorageError>
    readonly recordReviewRun: (
      input: RecordReviewRunInput,
    ) => Effect.Effect<ReviewRun, StorageError>
    readonly recordReviewFinding: (
      input: RecordReviewFindingInput,
    ) => Effect.Effect<ReviewFinding, StorageError>
    readonly recordPolicyDecision: (
      input: RecordPolicyDecisionInput,
    ) => Effect.Effect<PolicyDecision, StorageError>
    readonly recordPublicationResult: (
      input: RecordPublicationResultInput,
    ) => Effect.Effect<PublicationResult, StorageError>
    readonly recordProvenanceEvent: (
      input: RecordProvenanceEventInput,
    ) => Effect.Effect<ProvenanceEvent, StorageError>
  }
>()('@patchplane/core/services/StorageService') {}
