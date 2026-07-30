import { Option, Schema } from 'effect'
import { EvidenceArtifactKind } from '@patchplane/domain/evidence-artifact'
import type { SandboxExecution } from '@patchplane/domain/sandbox-execution'
import { EffectiveSandboxPolicy } from '@patchplane/domain/sandbox-environment'
import {
  VerificationPlatform,
  VerificationRequirementKind,
  type VerificationRequirement,
  type VerificationResult,
} from '@patchplane/domain/verification'
import {
  EpochMillis,
  GitCommitSha,
  Sha256Digest,
} from '@patchplane/domain/refinements'
import { type SandboxCommandResult } from '../services/sandbox-service'
import { type PersistedVerificationPlanV1 } from './persist-sandbox-verification-evidence'

const commandLogMaxBytes = 1024 * 1024
const inlineLogPreviewBytes = 16 * 1024
export const defaultRequirementTimeoutSeconds = 900
// Hosted alpha admits one requirement only. Its lifecycle allowance covers
// create/start (240s), ten bounded probes and session cleanup (350s), command
// polling grace (15s), sandbox deletion/confirmation (149s), and provider
// readback slack. The separate route deadline remains authoritative.
export const hostedGroupLifecycleAllowanceSeconds = 800

export function hex(bytes: Uint8Array) {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join(
    '',
  )
}

export function boundedUtf8(value: string) {
  const encoded = new TextEncoder().encode(value)
  if (encoded.byteLength <= commandLogMaxBytes) {
    return { body: value, status: 'captured' as const }
  }
  return {
    body: `${new TextDecoder().decode(encoded.slice(0, commandLogMaxBytes))}\n\n…truncated by PatchPlane…`,
    status: 'truncated' as const,
  }
}

const TrustedProviderEnvelope = Schema.Struct({
  provider: Schema.NonEmptyString,
  sandboxId: Schema.NonEmptyString,
  sessionId: Schema.optional(Schema.NonEmptyString),
  commandId: Schema.optional(Schema.NonEmptyString),
  command: Schema.NonEmptyString,
  exitCode: Schema.optional(Schema.Int),
  stdout: Schema.String,
  stderr: Schema.optional(Schema.String),
  policy: Schema.optional(EffectiveSandboxPolicy),
  evidenceArtifacts: Schema.optional(
    Schema.Array(
      Schema.Struct({
        kind: EvidenceArtifactKind,
        label: Schema.optional(Schema.String),
        contentType: Schema.NonEmptyString,
        body: Schema.Unknown,
        retentionPolicy: Schema.optional(Schema.NonEmptyString),
      }),
    ),
  ),
  verificationResults: Schema.optional(
    Schema.Array(
      Schema.Struct({
        requirementKey: Schema.optional(Schema.NonEmptyString),
        kind: VerificationRequirementKind,
        command: Schema.NonEmptyString,
        status: Schema.Literals(['succeeded', 'failed']),
        exitCode: Schema.optional(Schema.Int),
        message: Schema.optional(Schema.String),
        provider: Schema.optional(Schema.NonEmptyString),
        platform: Schema.optional(VerificationPlatform),
        architecture: Schema.optional(Schema.NonEmptyString),
        candidateDigestBefore: Schema.optional(Sha256Digest),
        candidateDigestAfter: Schema.optional(Sha256Digest),
        startedAt: Schema.optional(EpochMillis),
        completedAt: Schema.optional(EpochMillis),
      }),
    ),
  ),
  repositoryHeadBefore: Schema.optional(GitCommitSha),
  repositoryHeadAfter: Schema.optional(GitCommitSha),
  baseSha: Schema.optional(GitCommitSha),
  candidateStateDigest: Schema.optional(Sha256Digest),
  initialCandidateStateDigest: Schema.optional(Sha256Digest),
  startedAt: EpochMillis,
  completedAt: EpochMillis,
  cleanupStatus: Schema.optional(
    Schema.Literals(['deleted', 'failed', 'retained', 'not-started']),
  ),
})
const decodeTrustedProviderEnvelope = Schema.decodeUnknownOption(
  TrustedProviderEnvelope,
)

function artifactBodyByteLength(body: unknown): number | undefined {
  if (typeof body === 'string') return new TextEncoder().encode(body).byteLength
  if (body instanceof Uint8Array) return body.byteLength
  return undefined
}

export function isTrustedProviderEnvelopeBounded(input: {
  readonly expectedCommand: string
  readonly result: SandboxCommandResult
}) {
  const decoded = decodeTrustedProviderEnvelope(input.result)
  if (Option.isNone(decoded)) return false
  const result = decoded.value
  const outputBytes =
    new TextEncoder().encode(result.stdout).byteLength +
    new TextEncoder().encode(result.stderr ?? '').byteLength
  return (
    result.command === input.expectedCommand &&
    result.provider.length > 0 &&
    result.provider.length <= 128 &&
    result.sandboxId.length > 0 &&
    result.sandboxId.length <= 256 &&
    result.sessionId !== undefined &&
    result.sessionId.length <= 256 &&
    result.commandId !== undefined &&
    result.commandId.length <= 256 &&
    Number.isSafeInteger(result.startedAt) &&
    Number.isSafeInteger(result.completedAt) &&
    result.startedAt >= 0 &&
    result.completedAt >= result.startedAt &&
    result.completedAt <= Date.now() + 60_000 &&
    outputBytes <= commandLogMaxBytes * 2 &&
    (result.policy?.environment === undefined ||
      (result.policy.environment.sandboxClass.length <= 128 &&
        result.policy.environment.operatingSystem.length <= 128 &&
        result.policy.environment.architecture.length <= 128 &&
        result.policy.environment.image.length <= 512 &&
        result.policy.environment.target.length <= 256 &&
        result.policy.environment.providerState.length <= 128 &&
        result.policy.environment.observedAt >= result.startedAt &&
        result.policy.environment.observedAt <= result.completedAt)) &&
    (result.verificationResults?.length ?? 0) === 1 &&
    (result.evidenceArtifacts?.length ?? 0) <= 14 &&
    (result.verificationResults ?? []).every(
      (verification) =>
        (verification.requirementKey?.length ?? 0) <= 256 &&
        verification.command.length <= 16_384 &&
        (verification.message?.length ?? 0) <= 16_384 &&
        (verification.provider?.length ?? 0) <= 128 &&
        (verification.architecture?.length ?? 0) <= 128 &&
        (verification.completedAt === undefined ||
          verification.startedAt === undefined ||
          verification.completedAt >= verification.startedAt),
    ) &&
    (result.evidenceArtifacts ?? []).every((artifact) => {
      const size = artifactBodyByteLength(artifact.body)
      return (
        artifact.contentType.length > 0 &&
        artifact.contentType.length <= 256 &&
        (artifact.label?.length ?? 0) <= 512 &&
        (artifact.retentionPolicy?.length ?? 0) <= 128 &&
        size !== undefined &&
        size <= 5_000_000
      )
    })
  )
}

export function invalidProviderEnvelopeCleanupStatus() {
  return 'failed' as const
}

export function verificationProtectedSourcePolicyMatches(
  protectedExecution:
    | NonNullable<SandboxCommandResult['policy']>['protectedExecution']
    | undefined,
) {
  return (
    protectedExecution?.version === 'linux-v1' &&
    protectedExecution.effectiveUid === 65_534 &&
    protectedExecution.effectiveGid === 65_534 &&
    protectedExecution.noNewPrivileges === true &&
    protectedExecution.capabilitySetsCleared === true &&
    protectedExecution.sourceReadOnly === true &&
    protectedExecution.gitMetadataReadOnly === true &&
    protectedExecution.privatePidNamespace === true &&
    protectedExecution.privateNetworkNamespace === true &&
    protectedExecution.nestedNamespaceCreationBlocked === true &&
    protectedExecution.descendantsTerminated === true
  )
}

export function verificationCandidateIntegrityFailureStatus(
  candidateStateMatches: boolean,
) {
  return candidateStateMatches ? undefined : ('invalidated' as const)
}

export function verificationCandidateStateMatches(input: {
  readonly candidateDigest: string
  readonly candidateHeadSha: string
  readonly transientDigestBefore?: string | undefined
  readonly transientDigestAfter?: string | undefined
  readonly initialCandidateStateDigest?: string | undefined
  readonly finalCandidateStateDigest?: string | undefined
  readonly repositoryHeadBefore?: string | undefined
  readonly repositoryHeadAfter?: string | undefined
  readonly compatibilityBaseSha?: string | undefined
}) {
  return (
    input.transientDigestBefore !== undefined &&
    input.transientDigestBefore === input.transientDigestAfter &&
    input.transientDigestBefore === input.initialCandidateStateDigest &&
    input.transientDigestAfter === input.finalCandidateStateDigest &&
    input.repositoryHeadBefore === input.candidateHeadSha &&
    input.repositoryHeadAfter === input.candidateHeadSha &&
    input.compatibilityBaseSha === input.candidateHeadSha &&
    input.transientDigestBefore === input.candidateDigest
  )
}

export function preview(value: string) {
  return value.length <= inlineLogPreviewBytes
    ? value
    : `${value.slice(0, inlineLogPreviewBytes)}\n\n…truncated; full bounded output stored as evidence artifact…`
}

export function sameRequirement(
  planned: PersistedVerificationPlanV1['plan']['requirements'][number],
  persisted: VerificationRequirement,
) {
  return (
    persisted.verificationPlanId !== undefined &&
    persisted.key === planned.key &&
    persisted.label === planned.label &&
    persisted.kind === planned.kind &&
    persisted.required === planned.required &&
    persisted.command === planned.command &&
    persisted.platform === planned.platform &&
    persisted.architecture === planned.architecture &&
    persisted.timeoutSeconds === planned.timeoutSeconds &&
    JSON.stringify(persisted.requiredArtifactKinds) ===
      JSON.stringify(planned.requiredArtifactKinds)
  )
}

export interface IncomingVerificationPlanExecution {
  readonly sandboxExecutions: ReadonlyArray<SandboxExecution>
  readonly verificationResults: ReadonlyArray<VerificationResult>
  readonly complete: boolean
}

/** Executes every trusted requirement in its own fresh, non-shared Daytona sandbox. */
