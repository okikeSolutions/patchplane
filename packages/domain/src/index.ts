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
      /([?&](?:password|passwd|pwd|token|secret|api[_-]?key)=)[^&\s]+/gi,
      '$1<redacted>',
    )
    .replace(/\b(Bearer\s+)[A-Za-z0-9._~+/=-]+/gi, '$1<redacted>')
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

export const ArtifactRecord = Schema.Struct({
  artifactKey: ArtifactKey,
  attemptId: VerificationAttemptId,
  sha256: Sha256Hex,
  byteLength: Schema.Number.check(
    Schema.isInt(),
    Schema.isGreaterThanOrEqualTo(0),
    Schema.isLessThanOrEqualTo(PG_INT4_MAX),
  ),
  contentType: Schema.NonEmptyString.check(
    Schema.makeFilter((value) => !/[\r\n]/.test(value), {
      title: 'SafeContentType',
      description: 'Content-Type header value without CR/LF characters',
    }),
  ),
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

export const CloudDeviceProviderId = Schema.NonEmptyString.pipe(
  Schema.brand('CloudDeviceProviderId'),
)
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
  apkByteLength: Schema.Number.check(Schema.isInt(), Schema.isGreaterThan(0)),
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
  kvmAccelerated: Schema.Boolean,
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
