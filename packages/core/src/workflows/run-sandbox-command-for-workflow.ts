import { Effect } from 'effect'
import type { WorkflowStart } from '@patchplane/domain/workflow-start'
import { PrepareRepositoryClone } from '../repository/prepare-repository-clone'
import { SandboxService } from '../services/sandbox-service'
import { StorageService } from '../services/storage-service'
import { CaptureEvidenceArtifact } from './capture-evidence-artifact'
import { CaptureSandboxResultArtifacts } from './capture-sandbox-result-artifacts'
import { ProposeMergeDecision } from './propose-merge-decision'

const inlineLogPreviewBytes = 16 * 1024

function shouldCaptureAsArtifact(value: string | undefined) {
  return value !== undefined && value.length > inlineLogPreviewBytes
}

function truncatePreview(value: string) {
  if (value.length <= inlineLogPreviewBytes) return value
  return `${value.slice(0, inlineLogPreviewBytes)}\n\n…truncated; full output stored as evidence artifact…`
}

export const RunSandboxCommandForWorkflow = Effect.fn(
  '@patchplane/core/workflows/RunSandboxCommandForWorkflow',
)(function*(input: {
  readonly workflowStart: WorkflowStart
  readonly command: string
  readonly timeoutSeconds?: number | undefined
  readonly evidenceTestReportCommand?: string | undefined
  readonly evidenceBrowserScreenshotCommand?: string | undefined
}) {
  const clone = yield* PrepareRepositoryClone(input.workflowStart)

  if (clone === undefined) {
    return undefined
  }

  yield* Effect.annotateCurrentSpan({
    traceId: input.workflowStart.workflowRun.traceId,
    workflowRunId: input.workflowStart.workflowRun.id,
    repositoryFullName: clone.repositoryFullName,
  })

  const sandbox = yield* SandboxService
  const storage = yield* StorageService
  const result = yield* sandbox.runRepositoryCommand({
    ...clone,
    command: input.command,
    timeoutSeconds: input.timeoutSeconds,
    evidenceTestReportCommand: input.evidenceTestReportCommand,
    evidenceBrowserScreenshotCommand: input.evidenceBrowserScreenshotCommand,
    traceId: input.workflowStart.workflowRun.traceId,
  })

  if (shouldCaptureAsArtifact(result.stdout)) {
    yield* CaptureEvidenceArtifact({
      workflowRunId: input.workflowStart.workflowRun.id,
      traceId: input.workflowStart.workflowRun.traceId,
      kind: 'stdout',
      label: 'Sandbox stdout',
      contentType: 'text/plain',
      body: result.stdout,
      retentionPolicy: 'alpha-14d',
    })
  }

  if (shouldCaptureAsArtifact(result.stderr)) {
    yield* CaptureEvidenceArtifact({
      workflowRunId: input.workflowStart.workflowRun.id,
      traceId: input.workflowStart.workflowRun.traceId,
      kind: 'stderr',
      label: 'Sandbox stderr',
      contentType: 'text/plain',
      body: result.stderr!,
      retentionPolicy: 'alpha-14d',
    })
  }

  const evidenceArtifacts = yield* CaptureSandboxResultArtifacts({
    workflowRunId: input.workflowStart.workflowRun.id,
    traceId: input.workflowStart.workflowRun.traceId,
    result,
  })

  const sandboxExecution = yield* storage.recordSandboxExecution({
    workflowRunId: input.workflowStart.workflowRun.id,
    provider: result.provider,
    sandboxId: result.sandboxId,
    command: result.command,
    status: result.exitCode === 0 ? 'succeeded' : 'failed',
    ...(result.exitCode === undefined ? {} : { exitCode: result.exitCode }),
    stdout: truncatePreview(result.stdout),
    ...(result.stderr === undefined ? {} : { stderr: truncatePreview(result.stderr) }),
    ...(result.policy === undefined ? {} : { policy: result.policy }),
    startedAt: result.startedAt,
    completedAt: result.completedAt,
  })

  const diffArtifact = evidenceArtifacts.find((artifact) => artifact.kind === 'diff')
  yield* storage.recordCandidatePatchSet({
    workflowRunId: input.workflowStart.workflowRun.id,
    status: diffArtifact === undefined ? 'empty' : 'captured',
    ...(result.baseSha === undefined ? {} : { baseSha: result.baseSha }),
    ...(diffArtifact === undefined ? {} : { diffArtifactId: diffArtifact.id }),
    summary: diffArtifact === undefined
      ? 'Sandbox completed without a captured candidate diff.'
      : 'Captured candidate patch diff from sandbox worktree.',
    createdAt: result.completedAt,
    traceId: input.workflowStart.workflowRun.traceId,
    operation: 'runSandboxCommandForWorkflow.recordCandidatePatchSet',
  })

  yield* ProposeMergeDecision({
    workflowRunId: input.workflowStart.workflowRun.id,
    sandboxExecution,
    evidenceArtifacts,
    verificationResults: result.verificationResults,
    traceId: input.workflowStart.workflowRun.traceId,
    operation: 'runSandboxCommandForWorkflow.proposeMergeDecision',
  })

  return sandboxExecution
})
