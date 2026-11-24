import { Schema } from 'effect'

export const ChangeRequestId = Schema.NonEmptyString.pipe(
  Schema.brand('ChangeRequestId'),
)
export type ChangeRequestId = typeof ChangeRequestId.Type

const hasControlCharacter = (value: string): boolean => {
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i)
    if (code <= 0x1f || code === 0x7f) return true
  }
  return false
}

const isSafeRelativeIdentifier = (value: string): boolean =>
  !hasControlCharacter(value) &&
  !value.startsWith('/') &&
  !value.endsWith('/') &&
  !value.includes('\\') &&
  !value
    .split('/')
    .some((segment) => segment === '' || segment === '.' || segment === '..')

export const VerificationAttemptId = Schema.NonEmptyString.check(
  Schema.makeFilter(
    (value) => isSafeRelativeIdentifier(value) && !value.includes('/'),
    {
      title: 'SafeVerificationAttemptId',
      description:
        'Non-empty identifier without path separators or control characters',
    },
  ),
).pipe(Schema.brand('VerificationAttemptId'))
export type VerificationAttemptId = typeof VerificationAttemptId.Type

export const DeliveryId = Schema.NonEmptyString.pipe(Schema.brand('DeliveryId'))
export type DeliveryId = typeof DeliveryId.Type

export const DecisionId = Schema.NonEmptyString.pipe(Schema.brand('DecisionId'))
export type DecisionId = typeof DecisionId.Type

export const ActorId = Schema.NonEmptyString.pipe(Schema.brand('ActorId'))
export type ActorId = typeof ActorId.Type

export const PrepareDigest = Schema.NonEmptyString.pipe(
  Schema.brand('PrepareDigest'),
)
export type PrepareDigest = typeof PrepareDigest.Type

export const SandboxId = Schema.NonEmptyString.pipe(Schema.brand('SandboxId'))
export type SandboxId = typeof SandboxId.Type

export const ArtifactKey = Schema.NonEmptyString.check(
  Schema.makeFilter(isSafeRelativeIdentifier, {
    title: 'SafeArtifactKey',
    description:
      'Relative artifact key without "..", leading "/", backslashes, or control characters',
  }),
).pipe(Schema.brand('ArtifactKey'))
export type ArtifactKey = typeof ArtifactKey.Type

export const Sha256Hex = Schema.String.check(
  Schema.isPattern(/^[0-9a-f]{64}$/),
).pipe(Schema.brand('Sha256Hex'))
export type Sha256Hex = typeof Sha256Hex.Type

export const InboxItemId = Schema.NonEmptyString.pipe(
  Schema.brand('InboxItemId'),
)
export type InboxItemId = typeof InboxItemId.Type

export const EnvironmentQuarantineId = Schema.NonEmptyString.pipe(
  Schema.brand('EnvironmentQuarantineId'),
)
export type EnvironmentQuarantineId = typeof EnvironmentQuarantineId.Type

const PG_INT4_MAX = 2_147_483_647

/**
 * Scrubs embedded URI credentials, password query parameters, and bearer tokens
 * before an external error is persisted in workflow journals or emitted to logs.
 */
export const sanitizeErrorMessage = (cause: unknown): string => {
  const raw =
    cause instanceof Error && cause.message.length > 0
      ? `${cause.name}: ${cause.message}`
      : String(cause)
  return raw
    .replace(/\b([a-z][a-z0-9+.-]*:\/\/)([^/\s@]+)@/gi, '$1<redacted>@')
    .replace(
      /([?&](?:password|passwd|pwd|token|secret|api[_-]?key|x-amz-signature|x-amz-credential|x-amz-security-token|sig|signature|policy|auth)=)[^&\s]+/gi,
      '$1<redacted>',
    )
    .replace(/\b(Bearer\s+)[A-Za-z0-9._~+/=-]+/gi, '$1<redacted>')
    .replace(
      /\b(?:gh[pousr]_[A-Za-z0-9_]+|github_pat_[A-Za-z0-9_]+|whsec_[A-Za-z0-9_]+|sk_(?:live|test)_[A-Za-z0-9_]+)\b/g,
      '<redacted-token>',
    )
}

export const ProposalVersion = Schema.Number.check(
  Schema.isInt(),
  Schema.isGreaterThan(0),
  Schema.isLessThanOrEqualTo(PG_INT4_MAX),
).pipe(Schema.brand('ProposalVersion'))
export type ProposalVersion = typeof ProposalVersion.Type

export const AttemptGeneration = Schema.Number.check(
  Schema.isInt(),
  Schema.isGreaterThan(0),
  Schema.isLessThanOrEqualTo(PG_INT4_MAX),
).pipe(Schema.brand('AttemptGeneration'))
export type AttemptGeneration = typeof AttemptGeneration.Type

export const AttemptStatus = Schema.Literals([
  'pending',
  'running',
  'passed',
  'incomplete',
  'failed',
  'cancelled',
])
export type AttemptStatus = typeof AttemptStatus.Type

/**
 * Idempotency key for one attempt state transition. A replay that presents the
 * same key for an already-applied transition returns the persisted row instead
 * of failing ownership fencing, so a workflow activity that crashed after the
 * database commit (but before its journal entry) can be retried safely.
 */
export const AttemptTransitionKey = Schema.NonEmptyString.pipe(
  Schema.brand('AttemptTransitionKey'),
)
export type AttemptTransitionKey = typeof AttemptTransitionKey.Type

const ATTEMPT_TRANSITIONS: {
  readonly [From in AttemptStatus]: ReadonlyArray<AttemptStatus>
} = {
  pending: ['running', 'cancelled'],
  running: ['passed', 'failed', 'incomplete', 'cancelled'],
  passed: [],
  incomplete: [],
  failed: [],
  cancelled: [],
}

/** Terminal attempts never re-open; every other transition must be listed. */
export const canTransitionAttempt = (
  from: AttemptStatus,
  to: AttemptStatus,
): boolean => ATTEMPT_TRANSITIONS[from].includes(to)

export const DecisionKind = Schema.Literals(['approve', 'reject', 'waive'])
export type DecisionKind = typeof DecisionKind.Type

export const ChangeRequest = Schema.Struct({
  id: ChangeRequestId,
  provider: Schema.Literal('github'),
  repositoryId: Schema.NonEmptyString,
  headSha: Schema.NonEmptyString,
})
export interface ChangeRequest extends Schema.Schema.Type<
  typeof ChangeRequest
> {}

export const VerificationAttempt = Schema.Struct({
  id: VerificationAttemptId,
  changeRequestId: ChangeRequestId,
  status: AttemptStatus,
  generation: AttemptGeneration,
})
export interface VerificationAttempt extends Schema.Schema.Type<
  typeof VerificationAttempt
> {}

export const AcceptanceDecision = Schema.Struct({
  id: DecisionId,
  attemptId: VerificationAttemptId,
  proposalVersion: ProposalVersion,
  kind: DecisionKind,
  actorId: ActorId,
})
export interface AcceptanceDecision extends Schema.Schema.Type<
  typeof AcceptanceDecision
> {}

export const SandboxStatus = Schema.Literals([
  'active',
  'deleted',
  'quarantined',
])
export type SandboxStatus = typeof SandboxStatus.Type

export const SandboxRecord = Schema.Struct({
  sandboxId: SandboxId,
  attemptId: VerificationAttemptId,
  changeRequestId: ChangeRequestId,
  status: SandboxStatus,
  labels: Schema.Record(Schema.String, Schema.String),
})
export interface SandboxRecord extends Schema.Schema.Type<
  typeof SandboxRecord
> {}

export const SandboxSummary = Schema.Struct({
  sandboxId: SandboxId,
  state: Schema.NonEmptyString,
  labels: Schema.Record(Schema.String, Schema.String),
})
export interface SandboxSummary extends Schema.Schema.Type<
  typeof SandboxSummary
> {}

export const SandboxExecOutput = Schema.Struct({
  exitCode: Schema.Number.check(
    Schema.isInt(),
    Schema.isGreaterThanOrEqualTo(-255),
    Schema.isLessThanOrEqualTo(65_535),
  ),
  output: Schema.String,
})
export interface SandboxExecOutput extends Schema.Schema.Type<
  typeof SandboxExecOutput
> {}

export const SafeContentType = Schema.NonEmptyString.check(
  Schema.makeFilter((value) => !/[\r\n]/.test(value), {
    title: 'SafeContentType',
    description: 'Content-Type header value without CR/LF characters',
  }),
)

export const ArtifactRecord = Schema.Struct({
  artifactKey: ArtifactKey,
  attemptId: VerificationAttemptId,
  sha256: Sha256Hex,
  byteLength: Schema.Int.check(
    Schema.isGreaterThanOrEqualTo(0),
    Schema.isLessThanOrEqualTo(PG_INT4_MAX),
  ),
  contentType: SafeContentType,
})
export interface ArtifactRecord extends Schema.Schema.Type<
  typeof ArtifactRecord
> {}

export const DecisionInboxItemKind = Schema.Literals(['cleanup_quarantine'])
export type DecisionInboxItemKind = typeof DecisionInboxItemKind.Type

export const DecisionInboxItemStatus = Schema.Literals(['open', 'resolved'])
export type DecisionInboxItemStatus = typeof DecisionInboxItemStatus.Type

export const DecisionInboxItem = Schema.Struct({
  id: InboxItemId,
  attemptId: VerificationAttemptId,
  kind: DecisionInboxItemKind,
  status: DecisionInboxItemStatus,
  summary: Schema.NonEmptyString,
  sandboxId: Schema.optionalKey(SandboxId),
})
export interface DecisionInboxItem extends Schema.Schema.Type<
  typeof DecisionInboxItem
> {}

export const EnvironmentQuarantineStatus = Schema.Literals([
  'quarantined',
  'released',
])
export type EnvironmentQuarantineStatus =
  typeof EnvironmentQuarantineStatus.Type

export const EnvironmentQuarantine = Schema.Struct({
  id: EnvironmentQuarantineId,
  attemptId: VerificationAttemptId,
  sandboxId: SandboxId,
  reason: Schema.NonEmptyString,
  status: EnvironmentQuarantineStatus,
})
export interface EnvironmentQuarantine extends Schema.Schema.Type<
  typeof EnvironmentQuarantine
> {}

export class AttemptNotFoundError extends Schema.TaggedError<
  AttemptNotFoundError,
  { readonly brand: unique symbol }
>()('AttemptNotFoundError', {
  attemptId: VerificationAttemptId,
}) {}

export class ActiveAttemptConflictError extends Schema.TaggedError<
  ActiveAttemptConflictError,
  { readonly brand: unique symbol }
>()('ActiveAttemptConflictError', {
  changeRequestId: ChangeRequestId,
}) {}

export class StaleAttemptOwnershipError extends Schema.TaggedError<
  StaleAttemptOwnershipError,
  { readonly brand: unique symbol }
>()('StaleAttemptOwnershipError', {
  attemptId: VerificationAttemptId,
  expectedGeneration: AttemptGeneration,
}) {}

export class InvalidAttemptTransitionError extends Schema.TaggedError<
  InvalidAttemptTransitionError,
  { readonly brand: unique symbol }
>()('InvalidAttemptTransitionError', {
  attemptId: VerificationAttemptId,
  from: AttemptStatus,
  to: AttemptStatus,
}) {}

export class ConflictingDecisionError extends Schema.TaggedError<
  ConflictingDecisionError,
  { readonly brand: unique symbol }
>()('ConflictingDecisionError', {
  attemptId: VerificationAttemptId,
  proposalVersion: ProposalVersion,
  existingKind: DecisionKind,
  requestedKind: DecisionKind,
  existingActorId: ActorId,
  requestedActorId: ActorId,
}) {}

export class PersistenceError extends Schema.TaggedError<
  PersistenceError,
  { readonly brand: unique symbol }
>()('PersistenceError', {
  operation: Schema.NonEmptyString,
  message: Schema.String,
  cause: Schema.optionalKey(Schema.Defect()),
}) {}

export class StepRunnerError extends Schema.TaggedError<
  StepRunnerError,
  { readonly brand: unique symbol }
>()('StepRunnerError', {
  operation: Schema.NonEmptyString,
  message: Schema.String,
  cause: Schema.optionalKey(Schema.Defect()),
}) {}

export class MigrationFailureError extends Schema.TaggedError<
  MigrationFailureError,
  { readonly brand: unique symbol }
>()('MigrationFailureError', {
  migrationName: Schema.NonEmptyString,
  reason: Schema.String,
  cause: Schema.optionalKey(Schema.Defect()),
}) {}

export class SandboxCredentialPolicyError extends Schema.TaggedError<
  SandboxCredentialPolicyError,
  { readonly brand: unique symbol }
>()('SandboxCredentialPolicyError', {
  key: Schema.NonEmptyString,
  reason: Schema.NonEmptyString,
}) {}

export class SandboxExecutionError extends Schema.TaggedError<
  SandboxExecutionError,
  { readonly brand: unique symbol }
>()('SandboxExecutionError', {
  operation: Schema.NonEmptyString,
  message: Schema.String,
  sandboxId: Schema.optionalKey(SandboxId),
  cause: Schema.optionalKey(Schema.Defect()),
}) {}

export class SandboxCleanupError extends Schema.TaggedError<
  SandboxCleanupError,
  { readonly brand: unique symbol }
>()('SandboxCleanupError', {
  sandboxId: SandboxId,
  attemptId: VerificationAttemptId,
  reason: Schema.NonEmptyString,
  timedOut: Schema.Boolean,
  cause: Schema.optionalKey(Schema.Defect()),
}) {}

export class ArtifactStorageError extends Schema.TaggedError<
  ArtifactStorageError,
  { readonly brand: unique symbol }
>()('ArtifactStorageError', {
  operation: Schema.NonEmptyString,
  artifactKey: ArtifactKey,
  message: Schema.String,
  cause: Schema.optionalKey(Schema.Defect()),
}) {}

export class ArtifactIntegrityError extends Schema.TaggedError<
  ArtifactIntegrityError,
  { readonly brand: unique symbol }
>()('ArtifactIntegrityError', {
  artifactKey: ArtifactKey,
  expectedSha256: Sha256Hex,
  actualSha256: Schema.String,
}) {}

export const GitCommitSha = Schema.String.check(
  Schema.isPattern(/^[0-9a-f]{40}$/),
).pipe(Schema.brand('GitCommitSha'))
export type GitCommitSha = typeof GitCommitSha.Type

export const CloudDeviceRunId = Schema.NonEmptyString.check(
  Schema.makeFilter(
    (value) => isSafeRelativeIdentifier(value) && !value.includes('/'),
    {
      title: 'SafeCloudDeviceRunId',
      description:
        'Non-empty cloud device run identifier without path separators or control characters',
    },
  ),
).pipe(Schema.brand('CloudDeviceRunId'))
export type CloudDeviceRunId = typeof CloudDeviceRunId.Type

export const AndroidPackageName = Schema.String.check(
  Schema.isPattern(/^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/),
).pipe(Schema.brand('AndroidPackageName'))
export type AndroidPackageName = typeof AndroidPackageName.Type

export const CloudDeviceProviderId = Schema.NonEmptyString.check(
  Schema.makeFilter(
    (value) =>
      isSafeRelativeIdentifier(value) &&
      !value.includes('/') &&
      !/\s/.test(value),
    {
      title: 'SafeCloudDeviceProviderId',
      description:
        'Non-empty provider identifier without path separators, whitespace, or control characters',
    },
  ),
).pipe(Schema.brand('CloudDeviceProviderId'))
export type CloudDeviceProviderId = typeof CloudDeviceProviderId.Type

export const CloudDeviceRunStatus = Schema.Literals([
  'dispatched',
  'passed',
  'failed',
])
export type CloudDeviceRunStatus = typeof CloudDeviceRunStatus.Type

export const AndroidApkBuildRecord = Schema.Struct({
  attemptId: VerificationAttemptId,
  changeRequestId: ChangeRequestId,
  sourceSha: GitCommitSha,
  apkArtifactKey: ArtifactKey,
  apkSha256: Sha256Hex,
  apkByteLength: Schema.Int.check(
    Schema.isGreaterThan(0),
    Schema.isLessThanOrEqualTo(Number.MAX_SAFE_INTEGER),
  ),
  buildSandboxId: SandboxId,
  packageName: AndroidPackageName,
})
export interface AndroidApkBuildRecord extends Schema.Schema.Type<
  typeof AndroidApkBuildRecord
> {}

export const ArbeoJourneyObservation = Schema.Struct({
  observedApkSha256: Sha256Hex,
  apkSha256Verified: Schema.Boolean,
  cleanEmulatorBooted: Schema.Boolean,
  kvmAccelerated: Schema.optionalKey(Schema.Boolean),
  importPreviewDuration: Schema.NonEmptyString,
  importConfirmedDuration: Schema.NonEmptyString,
  persistedAfterOfflineRestart: Schema.Boolean,
  cleanupConfirmed: Schema.Boolean,
})
export interface ArbeoJourneyObservation extends Schema.Schema.Type<
  typeof ArbeoJourneyObservation
> {}

export const CloudDeviceRunRecord = Schema.Struct({
  runId: CloudDeviceRunId,
  attemptId: VerificationAttemptId,
  changeRequestId: ChangeRequestId,
  providerId: CloudDeviceProviderId,
  sourceSha: GitCommitSha,
  apkArtifactKey: ArtifactKey,
  apkSha256: Sha256Hex,
  status: CloudDeviceRunStatus,
  observation: Schema.optionalKey(ArbeoJourneyObservation),
  artifactKeys: Schema.Array(ArtifactKey),
})
export interface CloudDeviceRunRecord extends Schema.Schema.Type<
  typeof CloudDeviceRunRecord
> {}

export class CloudDevicePolicyError extends Schema.TaggedError<
  CloudDevicePolicyError,
  { readonly brand: unique symbol }
>()('CloudDevicePolicyError', {
  field: Schema.NonEmptyString,
  reason: Schema.NonEmptyString,
}) {}

export class CloudDeviceExecutionError extends Schema.TaggedError<
  CloudDeviceExecutionError,
  { readonly brand: unique symbol }
>()('CloudDeviceExecutionError', {
  operation: Schema.NonEmptyString,
  providerId: CloudDeviceProviderId,
  message: Schema.String,
  runId: Schema.optionalKey(CloudDeviceRunId),
}) {}

export class ApkIntegrityError extends Schema.TaggedError<
  ApkIntegrityError,
  { readonly brand: unique symbol }
>()('ApkIntegrityError', {
  expectedSha256: Sha256Hex,
  actualSha256: Schema.String,
  reason: Schema.NonEmptyString,
}) {}

// ---------------------------------------------------------------------------
// V2 Stack Proof 5: WorkOS GitHub OAuth, Forge Authority, and MCP Delegation
// ---------------------------------------------------------------------------

export const EpochMillis = Schema.Int.check(Schema.isGreaterThan(0))

const makeSafeSingleSegmentId = (
  title: string,
  description: string,
  maxLength = 128,
) =>
  Schema.NonEmptyString.check(
    Schema.isMaxLength(maxLength),
    Schema.makeFilter(
      (value) =>
        isSafeRelativeIdentifier(value) &&
        !value.includes('/') &&
        !/\s/.test(value),
      { title, description },
    ),
  )

export const OrganizationId = makeSafeSingleSegmentId(
  'SafeOrganizationId',
  'Non-empty organization identifier without whitespace, slashes, or control characters',
).pipe(Schema.brand('OrganizationId'))
export type OrganizationId = typeof OrganizationId.Type

export const HumanPrincipalId = makeSafeSingleSegmentId(
  'SafeHumanPrincipalId',
  'Non-empty human principal identifier without whitespace, slashes, or control characters',
).pipe(Schema.brand('HumanPrincipalId'))
export type HumanPrincipalId = typeof HumanPrincipalId.Type

export const WorkOsSessionId = makeSafeSingleSegmentId(
  'SafeWorkOsSessionId',
  'Non-empty WorkOS session identifier without whitespace, slashes, or control characters',
).pipe(Schema.brand('WorkOsSessionId'))
export type WorkOsSessionId = typeof WorkOsSessionId.Type

export const ForgeUserLogin = Schema.String.check(
  Schema.isMaxLength(64),
  Schema.isPattern(/^[A-Za-z0-9](?:[A-Za-z0-9]|[-_.](?=[A-Za-z0-9])){0,63}$/),
).pipe(Schema.brand('ForgeUserLogin'))
export type ForgeUserLogin = typeof ForgeUserLogin.Type

/**
 * Provider-neutral repository path supporting both two-segment (`owner/repo`)
 * and nested-group (`group/subgroup/repo`) forges without traversal segments.
 */
export const RepositoryId = Schema.String.check(
  Schema.isMaxLength(256),
  Schema.isPattern(/^[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)+$/),
  Schema.makeFilter(
    (value) => !value.split('/').some((seg) => seg === '.' || seg === '..'),
    {
      title: 'SafeRepositoryId',
      description:
        'Provider-neutral repository path without traversal segments',
    },
  ),
).pipe(Schema.brand('RepositoryId'))
export type RepositoryId = typeof RepositoryId.Type

export const normalizeRepositoryKey = (repositoryId: RepositoryId): string =>
  repositoryId.toLowerCase()

export const ForgeProviderId = makeSafeSingleSegmentId(
  'SafeForgeProviderId',
  'Non-empty forge provider identifier',
).pipe(Schema.brand('ForgeProviderId'))
export type ForgeProviderId = typeof ForgeProviderId.Type

export const ForgeInstanceId = makeSafeSingleSegmentId(
  'SafeForgeInstanceId',
  'Non-empty forge host/instance identifier (e.g. github.com or git.company.internal)',
  256,
).pipe(Schema.brand('ForgeInstanceId'))
export type ForgeInstanceId = typeof ForgeInstanceId.Type

export const ForgeInstallationId = makeSafeSingleSegmentId(
  'SafeForgeInstallationId',
  'Non-empty forge installation identifier',
).pipe(Schema.brand('ForgeInstallationId'))
export type ForgeInstallationId = typeof ForgeInstallationId.Type

export const McpSessionId = makeSafeSingleSegmentId(
  'SafeMcpSessionId',
  'Non-empty MCP session identifier',
).pipe(Schema.brand('McpSessionId'))
export type McpSessionId = typeof McpSessionId.Type

export const McpGrantId = makeSafeSingleSegmentId(
  'SafeMcpGrantId',
  'Non-empty delegated MCP grant identifier',
).pipe(Schema.brand('McpGrantId'))
export type McpGrantId = typeof McpGrantId.Type

export const PolicyRuleId = makeSafeSingleSegmentId(
  'SafePolicyRuleId',
  'Non-empty approval policy rule identifier',
).pipe(Schema.brand('PolicyRuleId'))
export type PolicyRuleId = typeof PolicyRuleId.Type

export const AuditEventId = makeSafeSingleSegmentId(
  'SafeAuditEventId',
  'Non-empty authority audit event identifier',
).pipe(Schema.brand('AuditEventId'))
export type AuditEventId = typeof AuditEventId.Type

export const ConfigVersion = Schema.Int.check(
  Schema.isGreaterThan(0),
  Schema.isLessThanOrEqualTo(PG_INT4_MAX),
).pipe(Schema.brand('ConfigVersion'))
export type ConfigVersion = typeof ConfigVersion.Type

export const RepositoryPermissionLevel = Schema.Literals([
  'none',
  'read',
  'triage',
  'write',
  'maintain',
  'admin',
])
export type RepositoryPermissionLevel = typeof RepositoryPermissionLevel.Type

export const canApproveWithRepositoryPermission = (
  permission: RepositoryPermissionLevel,
): boolean =>
  permission === 'write' || permission === 'maintain' || permission === 'admin'

export const canReadWithRepositoryPermission = (
  permission: RepositoryPermissionLevel,
): boolean => permission !== 'none'

export const ApprovalActionCategory = Schema.Literals([
  'requirement_approval',
  'extension_activation',
  'waiver',
])
export type ApprovalActionCategory = typeof ApprovalActionCategory.Type

export const ApprovalRuleMode = Schema.Literals(['manual', 'auto_policy'])
export type ApprovalRuleMode = typeof ApprovalRuleMode.Type

export const MaxWallClockMinutes = Schema.Int.check(
  Schema.isGreaterThanOrEqualTo(1),
  Schema.isLessThanOrEqualTo(120),
)

export const ConfigFieldKey = Schema.Literals([
  'approval.requirement_approval',
  'approval.extension_activation',
  'approval.waiver',
  'verification.max_wall_clock_minutes',
  'verification.auto_cancel_superseded',
])
export type ConfigFieldKey = typeof ConfigFieldKey.Type

export const ConfigFieldValue = Schema.Union([
  ApprovalRuleMode,
  MaxWallClockMinutes,
  Schema.Boolean,
])
export type ConfigFieldValue = typeof ConfigFieldValue.Type

export const RepositoryConfigValues = Schema.Struct({
  'approval.requirement_approval': ApprovalRuleMode,
  'approval.extension_activation': ApprovalRuleMode,
  'approval.waiver': ApprovalRuleMode,
  'verification.max_wall_clock_minutes': MaxWallClockMinutes,
  'verification.auto_cancel_superseded': Schema.Boolean,
})
export interface RepositoryConfigValues extends Schema.Schema.Type<
  typeof RepositoryConfigValues
> {}

export const DEFAULT_REPOSITORY_CONFIG_VALUES: RepositoryConfigValues = {
  'approval.requirement_approval': 'manual',
  'approval.extension_activation': 'manual',
  'approval.waiver': 'manual',
  'verification.max_wall_clock_minutes': 30,
  'verification.auto_cancel_superseded': true,
}

export const WorkOsAuthenticatedIdentity = Schema.Struct({
  principalId: HumanPrincipalId,
  workOsUserId: Schema.NonEmptyString,
  workOsSessionId: WorkOsSessionId,
  organizationId: OrganizationId,
  forgeUserLogin: ForgeUserLogin,
  email: Schema.NonEmptyString,
  expiresAtMs: EpochMillis,
})
export interface WorkOsAuthenticatedIdentity extends Schema.Schema.Type<
  typeof WorkOsAuthenticatedIdentity
> {}

export const ForgeCapabilities = Schema.Struct({
  supportsPullRequests: Schema.Boolean,
  supportsWebhooks: Schema.Boolean,
  supportsInstallationTokens: Schema.Boolean,
  supportsRepositoryPermissions: Schema.Boolean,
  supportsStatusChecks: Schema.Boolean,
})
export interface ForgeCapabilities extends Schema.Schema.Type<
  typeof ForgeCapabilities
> {}

export const ForgeRepositoryAuthority = Schema.Struct({
  provider: ForgeProviderId,
  instanceId: ForgeInstanceId,
  repositoryId: RepositoryId,
  installationId: ForgeInstallationId,
  forgeUserLogin: ForgeUserLogin,
  permission: RepositoryPermissionLevel,
  canApprove: Schema.Boolean,
})
export interface ForgeRepositoryAuthority extends Schema.Schema.Type<
  typeof ForgeRepositoryAuthority
> {}

export const ForgePullRequestCandidate = Schema.Struct({
  provider: ForgeProviderId,
  instanceId: ForgeInstanceId,
  changeRequestId: ChangeRequestId,
  repositoryId: RepositoryId,
  pullNumber: Schema.Int.check(Schema.isGreaterThan(0)),
  headSha: GitCommitSha,
  isFork: Schema.Boolean,
  forkRepositoryId: Schema.optionalKey(RepositoryId),
})
export interface ForgePullRequestCandidate extends Schema.Schema.Type<
  typeof ForgePullRequestCandidate
> {}

export const HumanPrincipalAttribution = Schema.TaggedStruct('HumanPrincipal', {
  principalId: HumanPrincipalId,
  organizationId: OrganizationId,
  forgeUserLogin: ForgeUserLogin,
  workOsSessionId: WorkOsSessionId,
})
export interface HumanPrincipalAttribution extends Schema.Schema.Type<
  typeof HumanPrincipalAttribution
> {}

export const DelegatedAgentAttribution = Schema.TaggedStruct('DelegatedAgent', {
  agentActorId: ActorId,
  humanDelegatorId: HumanPrincipalId,
  organizationId: OrganizationId,
  grantId: McpGrantId,
  sessionId: McpSessionId,
})
export interface DelegatedAgentAttribution extends Schema.Schema.Type<
  typeof DelegatedAgentAttribution
> {}

export const PolicyRuleAttribution = Schema.TaggedStruct('PolicyRule', {
  policyRuleId: PolicyRuleId,
  policyVersion: ConfigVersion,
  proposalVersion: ProposalVersion,
})
export interface PolicyRuleAttribution extends Schema.Schema.Type<
  typeof PolicyRuleAttribution
> {}

export const ActionAttribution = Schema.Union([
  HumanPrincipalAttribution,
  DelegatedAgentAttribution,
  PolicyRuleAttribution,
])
export type ActionAttribution = typeof ActionAttribution.Type

export const McpSessionStatus = Schema.Literals(['active', 'terminated'])
export type McpSessionStatus = typeof McpSessionStatus.Type

export const McpSessionRecord = Schema.Struct({
  sessionId: McpSessionId,
  organizationId: OrganizationId,
  principalId: HumanPrincipalId,
  principalForgeLogin: ForgeUserLogin,
  agentActorId: ActorId,
  status: McpSessionStatus,
  createdAtMs: EpochMillis,
  terminatedAtMs: Schema.optionalKey(EpochMillis),
})
export interface McpSessionRecord extends Schema.Schema.Type<
  typeof McpSessionRecord
> {}

export const DelegatedMcpGrantStatus = Schema.Literals([
  'active',
  'revoked',
  'expired',
])
export type DelegatedMcpGrantStatus = typeof DelegatedMcpGrantStatus.Type

export const DelegatedMcpGrant = Schema.Struct({
  grantId: McpGrantId,
  organizationId: OrganizationId,
  repositoryId: RepositoryId,
  humanDelegatorId: HumanPrincipalId,
  humanDelegatorForgeLogin: ForgeUserLogin,
  agentActorId: ActorId,
  sessionId: McpSessionId,
  allowedFields: Schema.Array(ConfigFieldKey).check(Schema.isMinLength(1)),
  scope: Schema.Literal('session'),
  status: DelegatedMcpGrantStatus,
  createdAtMs: EpochMillis,
  expiresAtMs: EpochMillis,
  revokedAtMs: Schema.optionalKey(EpochMillis),
  revokedBy: Schema.optionalKey(HumanPrincipalId),
})
export interface DelegatedMcpGrant extends Schema.Schema.Type<
  typeof DelegatedMcpGrant
> {}

export const RepositoryConfigRecord = Schema.Struct({
  repositoryId: RepositoryId,
  organizationId: OrganizationId,
  version: ConfigVersion,
  values: RepositoryConfigValues,
  updatedBy: ActionAttribution,
  updatedAtMs: EpochMillis,
})
export interface RepositoryConfigRecord extends Schema.Schema.Type<
  typeof RepositoryConfigRecord
> {}

export const ActiveAttemptConfigNotice = Schema.Struct({
  attemptId: VerificationAttemptId,
  repositoryId: RepositoryId,
  configVersion: ConfigVersion,
  message: Schema.NonEmptyString,
})
export interface ActiveAttemptConfigNotice extends Schema.Schema.Type<
  typeof ActiveAttemptConfigNotice
> {}

export const AuthorityAuditEvent = Schema.Struct({
  eventId: AuditEventId,
  organizationId: OrganizationId,
  repositoryId: RepositoryId,
  action: Schema.NonEmptyString,
  attemptId: Schema.optionalKey(VerificationAttemptId),
  proposalVersion: Schema.optionalKey(ProposalVersion),
  attribution: ActionAttribution,
  grantId: Schema.optionalKey(McpGrantId),
  beforeConfigVersion: Schema.optionalKey(ConfigVersion),
  afterConfigVersion: Schema.optionalKey(ConfigVersion),
  createdAtMs: EpochMillis,
})
export interface AuthorityAuditEvent extends Schema.Schema.Type<
  typeof AuthorityAuditEvent
> {}

export class AuthenticationError extends Schema.TaggedError<
  AuthenticationError,
  { readonly brand: unique symbol }
>()('AuthenticationError', {
  reason: Schema.NonEmptyString,
}) {}

export class RepositoryAuthorityError extends Schema.TaggedError<
  RepositoryAuthorityError,
  { readonly brand: unique symbol }
>()('RepositoryAuthorityError', {
  repositoryId: RepositoryId,
  forgeUserLogin: ForgeUserLogin,
  permission: RepositoryPermissionLevel,
  reason: Schema.NonEmptyString,
}) {}

export const McpAuthorizationErrorCode = Schema.Literals([
  'missing_grant',
  'wrong_actor',
  'wrong_repository',
  'field_not_permitted',
  'invalid_input',
  'grant_expired',
  'grant_revoked',
  'session_terminated',
  'self_authorization_forbidden',
])
export type McpAuthorizationErrorCode = typeof McpAuthorizationErrorCode.Type

export class McpAuthorizationError extends Schema.TaggedError<
  McpAuthorizationError,
  { readonly brand: unique symbol }
>()('McpAuthorizationError', {
  code: McpAuthorizationErrorCode,
  reason: Schema.NonEmptyString,
}) {}

export class ProposalVersionNotFoundError extends Schema.TaggedError<
  ProposalVersionNotFoundError,
  { readonly brand: unique symbol }
>()('ProposalVersionNotFoundError', {
  attemptId: VerificationAttemptId,
  reason: Schema.NonEmptyString,
}) {}

export class ManualApprovalRequiredError extends Schema.TaggedError<
  ManualApprovalRequiredError,
  { readonly brand: unique symbol }
>()('ManualApprovalRequiredError', {
  repositoryId: RepositoryId,
  category: ApprovalActionCategory,
  reason: Schema.NonEmptyString,
}) {}

export class StaleProposalVersionError extends Schema.TaggedError<
  StaleProposalVersionError,
  { readonly brand: unique symbol }
>()('StaleProposalVersionError', {
  attemptId: VerificationAttemptId,
  expectedVersion: ProposalVersion,
  actualVersion: ProposalVersion,
}) {}

export class StaleConfigVersionError extends Schema.TaggedError<
  StaleConfigVersionError,
  { readonly brand: unique symbol }
>()('StaleConfigVersionError', {
  repositoryId: RepositoryId,
  expectedVersion: Schema.NullOr(ConfigVersion),
  actualVersion: Schema.NullOr(ConfigVersion),
}) {}

export class ForgeWebhookVerificationError extends Schema.TaggedError<
  ForgeWebhookVerificationError,
  { readonly brand: unique symbol }
>()('ForgeWebhookVerificationError', {
  provider: ForgeProviderId,
  reason: Schema.NonEmptyString,
}) {}

export class ForgeAdapterError extends Schema.TaggedError<
  ForgeAdapterError,
  { readonly brand: unique symbol }
>()('ForgeAdapterError', {
  provider: ForgeProviderId,
  operation: Schema.NonEmptyString,
  message: Schema.String,
}) {}
