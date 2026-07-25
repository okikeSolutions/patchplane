import { Effect } from 'effect'
import type { CandidatePatchSet } from '@patchplane/domain/decision-review'
import type { EvidenceArtifact, EvidenceArtifactKind } from '@patchplane/domain/evidence-artifact'
import type { SandboxExecution } from '@patchplane/domain/sandbox-execution'
import type { VerificationResult } from '@patchplane/domain/verification'
import type { SandboxCommandResult, SandboxVerificationResult } from '../services/sandbox-service'
import { StorageService } from '../services/storage-service'
import type { TelemetryContextFields } from '../services/telemetry-service'

/** Persists configured sandbox checks as candidate-bound verification evidence. */
export const PersistSandboxVerificationEvidence = Effect.fn(
  '@patchplane/core/workflows/PersistSandboxVerificationEvidence',
)(function*(input: TelemetryContextFields & {
  readonly workflowRunId: string
  readonly sandboxExecution: SandboxExecution
  readonly candidatePatchSet: CandidatePatchSet
  readonly evidenceArtifacts: ReadonlyArray<EvidenceArtifact>
  readonly sandboxResult: SandboxCommandResult
}) {
  const storage = yield* StorageService
  const candidateDigest = input.candidatePatchSet.candidateDigest
  const transientResults = input.sandboxResult.verificationResults ?? []

  if (candidateDigest === undefined || transientResults.length === 0) {
    return { requirements: [], results: [] }
  }

  const records = yield* Effect.forEach(transientResults, (transient, index) =>
    Effect.gen(function* () {
      const requiredArtifactKind = artifactKindFor(transient.kind)
      const artifacts = input.evidenceArtifacts.filter((artifact) => artifact.kind === requiredArtifactKind)
      const requirement = yield* storage.recordVerificationRequirement({
        workflowRunId: input.workflowRunId,
        key: `sandbox:${transient.kind}`,
        label: transient.kind === 'test' ? 'Configured test verification' : 'Configured browser verification',
        kind: transient.kind,
        required: true,
        command: transient.command,
        platform: transient.platform ?? 'linux',
        architecture: transient.architecture ?? 'unknown',
        requiredArtifactKinds: [requiredArtifactKind],
        source: 'policy',
        createdAt: transient.startedAt ?? input.sandboxExecution.startedAt,
        traceId: input.traceId,
        pluginName: input.pluginName,
        operation: 'persistSandboxVerificationEvidence.recordRequirement',
      })

      const candidateUnchanged =
        transient.candidateDigestBefore !== undefined &&
        transient.candidateDigestBefore === transient.candidateDigestAfter &&
        transient.candidateDigestAfter === input.sandboxResult.candidateStateDigest &&
        input.sandboxResult.candidateStateDigest === candidateDigest
      const status = deriveDurableVerificationStatus(transient, candidateUnchanged, artifacts.length > 0)
      const result = yield* storage.recordVerificationResult({
        workflowRunId: input.workflowRunId,
        requirementId: requirement.id,
        candidatePatchSetId: input.candidatePatchSet.id,
        sandboxExecutionId: input.sandboxExecution.id,
        provider: transient.provider ?? input.sandboxResult.provider,
        command: transient.command,
        platform: transient.platform ?? 'linux',
        architecture: transient.architecture ?? 'unknown',
        status,
        ...(transient.exitCode === undefined ? {} : { exitCode: transient.exitCode }),
        ...(transient.message === undefined ? {} : { summary: transient.message }),
        artifactIds: artifacts.map((artifact) => artifact.id),
        producedArtifactKinds: artifacts.map((artifact) => artifact.kind),
        candidateDigestBefore: transient.candidateDigestBefore ?? 'unavailable',
        ...(transient.candidateDigestAfter === undefined
          ? {}
          : { candidateDigestAfter: transient.candidateDigestAfter }),
        startedAt: transient.startedAt ?? input.sandboxExecution.startedAt,
        completedAt: transient.completedAt ?? input.sandboxExecution.completedAt,
        idempotencyKey: `${input.candidatePatchSet.id}:${requirement.key}:${index}`,
        traceId: input.traceId,
        pluginName: input.pluginName,
        operation: 'persistSandboxVerificationEvidence.recordResult',
      })
      return { requirement, result }
    }),
  )

  return {
    requirements: records.map((record) => record.requirement),
    results: records.map((record) => record.result),
  }
})

function artifactKindFor(kind: SandboxVerificationResult['kind']): EvidenceArtifactKind {
  return kind === 'test' ? 'test-report' : 'screenshot'
}

export function deriveDurableVerificationStatus(
  result: SandboxVerificationResult,
  candidateUnchanged: boolean,
  requiredArtifactPresent: boolean,
): VerificationResult['status'] {
  if (!candidateUnchanged) return 'invalidated'
  if (result.status === 'failed') {
    return result.exitCode === 0 ? 'error' : 'failed'
  }
  if (!requiredArtifactPresent) return 'error'
  return result.exitCode === 0 ? 'passed' : 'error'
}
