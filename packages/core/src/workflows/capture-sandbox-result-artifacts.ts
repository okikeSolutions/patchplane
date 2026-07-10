import { Effect } from 'effect'
import type { EvidenceArtifact } from '@patchplane/domain/evidence-artifact'
import type { WorkflowRunId } from '@patchplane/domain/ids'
import type { SandboxCommandResult } from '../services/sandbox-service'
import { CaptureEvidenceArtifact } from './capture-evidence-artifact'

export const CaptureSandboxResultArtifacts = Effect.fn(
  '@patchplane/core/workflows/CaptureSandboxResultArtifacts',
)(function*(input: {
  readonly workflowRunId: WorkflowRunId
  readonly traceId: string
  readonly result: SandboxCommandResult
}) {
  const captured: Array<EvidenceArtifact> = []
  for (const artifact of input.result.evidenceArtifacts ?? []) {
    const evidenceArtifact = yield* CaptureEvidenceArtifact({
      workflowRunId: input.workflowRunId,
      traceId: input.traceId,
      kind: artifact.kind,
      ...(artifact.label === undefined ? {} : { label: artifact.label }),
      contentType: artifact.contentType,
      body: artifact.body,
      ...(artifact.retentionPolicy === undefined ? {} : { retentionPolicy: artifact.retentionPolicy }),
    })
    captured.push(evidenceArtifact)
  }
  return captured
})
