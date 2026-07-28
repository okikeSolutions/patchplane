import { Schema } from 'effect'

export const ActorIdNamespace = Schema.Literals([
  'workos',
  'github',
  'github-app',
  'agent',
  'system',
])
export type ActorIdNamespace = Schema.Schema.Type<typeof ActorIdNamespace>

export const WorkspaceIdNamespace = Schema.Literals(['workos', 'system'])
export type WorkspaceIdNamespace = Schema.Schema.Type<
  typeof WorkspaceIdNamespace
>

/**
 * Stable PatchPlane actor identifier.
 *
 * @remarks
 * Actor ids are namespaced strings such as `workos:user_123` or
 * `github-app:987`. Use the constructor helpers in this module instead of
 * concatenating ids at call sites.
 */
export const ActorId = Schema.TemplateLiteral([
  ActorIdNamespace,
  ':',
  Schema.NonEmptyString,
]).pipe(Schema.brand('ActorId'))
export type ActorId = Schema.Schema.Type<typeof ActorId>

/**
 * Stable PatchPlane workspace identifier.
 *
 * @remarks
 * Workspace ids are namespaced strings, currently `workos:<organizationId>`
 * for customer workspaces and `system:<id>` for internal/system workflows.
 */
export const WorkspaceId = Schema.TemplateLiteral([
  WorkspaceIdNamespace,
  ':',
  Schema.NonEmptyString,
]).pipe(Schema.brand('WorkspaceId'))
export type WorkspaceId = Schema.Schema.Type<typeof WorkspaceId>

export const PromptRequestId = Schema.NonEmptyString.pipe(
  Schema.brand('PromptRequestId'),
)
export type PromptRequestId = Schema.Schema.Type<typeof PromptRequestId>

export const WorkflowRunId = Schema.NonEmptyString.pipe(
  Schema.brand('WorkflowRunId'),
)
export type WorkflowRunId = Schema.Schema.Type<typeof WorkflowRunId>

export const SandboxExecutionId = Schema.NonEmptyString.pipe(
  Schema.brand('SandboxExecutionId'),
)
export type SandboxExecutionId = Schema.Schema.Type<typeof SandboxExecutionId>

export const CandidatePatchSetId = Schema.NonEmptyString.pipe(
  Schema.brand('CandidatePatchSetId'),
)
export type CandidatePatchSetId = Schema.Schema.Type<typeof CandidatePatchSetId>

export const EvidenceArtifactId = Schema.NonEmptyString.pipe(
  Schema.brand('EvidenceArtifactId'),
)
export type EvidenceArtifactId = Schema.Schema.Type<typeof EvidenceArtifactId>

export const VerificationPlanId = Schema.NonEmptyString.pipe(
  Schema.brand('VerificationPlanId'),
)
export type VerificationPlanId = Schema.Schema.Type<typeof VerificationPlanId>

export const VerificationRequirementId = Schema.NonEmptyString.pipe(
  Schema.brand('VerificationRequirementId'),
)
export type VerificationRequirementId = Schema.Schema.Type<
  typeof VerificationRequirementId
>

export const VerificationResultId = Schema.NonEmptyString.pipe(
  Schema.brand('VerificationResultId'),
)
export type VerificationResultId = Schema.Schema.Type<
  typeof VerificationResultId
>

export const ReviewRunId = Schema.NonEmptyString.pipe(
  Schema.brand('ReviewRunId'),
)
export type ReviewRunId = Schema.Schema.Type<typeof ReviewRunId>

export const ReviewFindingId = Schema.NonEmptyString.pipe(
  Schema.brand('ReviewFindingId'),
)
export type ReviewFindingId = Schema.Schema.Type<typeof ReviewFindingId>

export const PolicyDecisionId = Schema.NonEmptyString.pipe(
  Schema.brand('PolicyDecisionId'),
)
export type PolicyDecisionId = Schema.Schema.Type<typeof PolicyDecisionId>

export const HumanDecisionId = Schema.NonEmptyString.pipe(
  Schema.brand('HumanDecisionId'),
)
export type HumanDecisionId = Schema.Schema.Type<typeof HumanDecisionId>

export const PublicationResultId = Schema.NonEmptyString.pipe(
  Schema.brand('PublicationResultId'),
)
export type PublicationResultId = Schema.Schema.Type<typeof PublicationResultId>

export const RuntimeSessionId = Schema.NonEmptyString.pipe(
  Schema.brand('RuntimeSessionId'),
)
export type RuntimeSessionId = Schema.Schema.Type<typeof RuntimeSessionId>

export const ProvenanceEventId = Schema.NonEmptyString.pipe(
  Schema.brand('ProvenanceEventId'),
)
export type ProvenanceEventId = Schema.Schema.Type<typeof ProvenanceEventId>

export const PatchReportId = Schema.NonEmptyString.pipe(
  Schema.brand('PatchReportId'),
)
export type PatchReportId = Schema.Schema.Type<typeof PatchReportId>

export const RuntimeEventId = Schema.NonEmptyString.pipe(
  Schema.brand('RuntimeEventId'),
)
export type RuntimeEventId = Schema.Schema.Type<typeof RuntimeEventId>

const decodeActorIdSync = Schema.decodeUnknownSync(ActorId)
const decodeWorkspaceIdSync = Schema.decodeUnknownSync(WorkspaceId)
const decodePromptRequestIdSync = Schema.decodeUnknownSync(PromptRequestId)
const decodeWorkflowRunIdSync = Schema.decodeUnknownSync(WorkflowRunId)

export const makeSandboxExecutionId =
  Schema.decodeUnknownSync(SandboxExecutionId)
export const makeCandidatePatchSetId =
  Schema.decodeUnknownSync(CandidatePatchSetId)
export const makeEvidenceArtifactId =
  Schema.decodeUnknownSync(EvidenceArtifactId)
export const makeVerificationPlanId =
  Schema.decodeUnknownSync(VerificationPlanId)
export const makeVerificationRequirementId = Schema.decodeUnknownSync(
  VerificationRequirementId,
)
export const makeVerificationResultId =
  Schema.decodeUnknownSync(VerificationResultId)
export const makeReviewRunId = Schema.decodeUnknownSync(ReviewRunId)
export const makeReviewFindingId = Schema.decodeUnknownSync(ReviewFindingId)
export const makePolicyDecisionId = Schema.decodeUnknownSync(PolicyDecisionId)
export const makeHumanDecisionId = Schema.decodeUnknownSync(HumanDecisionId)
export const makePublicationResultId =
  Schema.decodeUnknownSync(PublicationResultId)
export const makeRuntimeSessionId = Schema.decodeUnknownSync(RuntimeSessionId)
export const makeProvenanceEventId = Schema.decodeUnknownSync(ProvenanceEventId)
export const makePatchReportId = Schema.decodeUnknownSync(PatchReportId)
export const makeRuntimeEventId = Schema.decodeUnknownSync(RuntimeEventId)

export function makeWorkspaceId(workspaceId: string): WorkspaceId {
  return decodeWorkspaceIdSync(workspaceId)
}

export function makePromptRequestId(promptRequestId: string): PromptRequestId {
  return decodePromptRequestIdSync(promptRequestId)
}

export function makeWorkflowRunId(workflowRunId: string): WorkflowRunId {
  return decodeWorkflowRunIdSync(workflowRunId)
}

/** Creates a PatchPlane actor id for a WorkOS user id. */
export function makeWorkOSActorId(userId: string): ActorId {
  return decodeActorIdSync(`workos:${userId}`)
}

/** Creates a PatchPlane actor id for a GitHub App installation. */
export function makeGitHubAppActorId(installationId: string): ActorId {
  return decodeActorIdSync(`github-app:${installationId}`)
}

export function makeSystemActorId(actorId: string): ActorId {
  return decodeActorIdSync(`system:${actorId}`)
}

/** Creates a PatchPlane workspace id for a WorkOS organization id. */
export function makeWorkOSWorkspaceId(organizationId: string): WorkspaceId {
  return decodeWorkspaceIdSync(`workos:${organizationId}`)
}

export function makeSystemWorkspaceId(workspaceId: string): WorkspaceId {
  return decodeWorkspaceIdSync(`system:${workspaceId}`)
}
