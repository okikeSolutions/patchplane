import { Effect } from 'effect'
import type { RuntimeSession } from '@patchplane/domain/runtime-session'
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

export const RunSandboxAgentForWorkflow = Effect.fn(
  '@patchplane/core/workflows/RunSandboxAgentForWorkflow',
)(function*(input: {
  readonly workflowStart: WorkflowStart
  readonly provider: string
  readonly model: string
  readonly thinking?: string | undefined
  readonly mode?: 'json' | 'rpc' | undefined
  readonly timeoutSeconds?: number | undefined
  readonly evidenceTestReportCommand?: string | undefined
  readonly evidenceBrowserScreenshotCommand?: string | undefined
}) {
  const clone = yield* PrepareRepositoryClone(input.workflowStart)

  if (clone === undefined) {
    return undefined
  }

  const sandbox = yield* SandboxService
  const storage = yield* StorageService
  let runtimeSession: RuntimeSession | undefined
  const result = yield* sandbox.runRepositoryAgent({
    ...clone,
    prompt: input.workflowStart.promptRequest.prompt,
    provider: input.provider,
    model: input.model,
    thinking: input.thinking,
    mode: input.mode,
    timeoutSeconds: input.timeoutSeconds,
    evidenceTestReportCommand: input.evidenceTestReportCommand,
    evidenceBrowserScreenshotCommand: input.evidenceBrowserScreenshotCommand,
    traceId: input.workflowStart.workflowRun.traceId,
    onRuntimeSessionStarted: (session) =>
      Effect.gen(function* () {
        runtimeSession = yield* storage.recordRuntimeSessionStarted({
          workflowRunId: input.workflowStart.workflowRun.id,
          provider: session.provider,
          sandboxId: session.sandboxId,
          sessionId: session.sessionId,
          commandId: session.commandId,
          startedAt: session.startedAt,
          traceId: input.workflowStart.workflowRun.traceId,
        })
      }),
    onRuntimeEvents: (events) =>
      storage.recordRuntimeEvents(events.map((event) => ({
        workflowRunId: input.workflowStart.workflowRun.id,
        provider: event.provider,
        type: event.type,
        occurredAt: event.occurredAt,
        ...(event.summary === undefined ? {} : { summary: event.summary }),
        ...(event.payloadJson === undefined ? {} : { payloadJson: event.payloadJson }),
        ...(event.idempotencyKey === undefined ? {} : { idempotencyKey: event.idempotencyKey }),
        ...(event.sourceSessionId === undefined ? {} : { sourceSessionId: event.sourceSessionId }),
        ...(event.sourceCommandId === undefined ? {} : { sourceCommandId: event.sourceCommandId }),
        ...(event.sourceStream === undefined ? {} : { sourceStream: event.sourceStream }),
        ...(event.sourceLine === undefined ? {} : { sourceLine: event.sourceLine }),
        ...(event.sourceOffset === undefined ? {} : { sourceOffset: event.sourceOffset }),
        traceId: input.workflowStart.workflowRun.traceId,
      }))),
  })

  runtimeSession = runtimeSession ?? (result.sessionId !== undefined && result.commandId !== undefined
    ? yield* storage.recordRuntimeSessionStarted({
        workflowRunId: input.workflowStart.workflowRun.id,
        provider: result.provider,
        sandboxId: result.sandboxId,
        sessionId: result.sessionId,
        commandId: result.commandId,
        startedAt: result.startedAt,
        traceId: input.workflowStart.workflowRun.traceId,
      })
    : undefined)

  if (result.runtimeEvents !== undefined && result.runtimeEvents.length > 0) {
    yield* storage.recordRuntimeEvents(result.runtimeEvents.map((event) => ({
      workflowRunId: input.workflowStart.workflowRun.id,
      provider: event.provider,
      type: event.type,
      occurredAt: event.occurredAt,
      ...(event.summary === undefined ? {} : { summary: event.summary }),
      ...(event.payloadJson === undefined ? {} : { payloadJson: event.payloadJson }),
      ...(event.idempotencyKey === undefined ? {} : { idempotencyKey: event.idempotencyKey }),
      ...(event.sourceSessionId === undefined ? {} : { sourceSessionId: event.sourceSessionId }),
      ...(event.sourceCommandId === undefined ? {} : { sourceCommandId: event.sourceCommandId }),
      ...(event.sourceStream === undefined ? {} : { sourceStream: event.sourceStream }),
      ...(event.sourceLine === undefined ? {} : { sourceLine: event.sourceLine }),
      ...(event.sourceOffset === undefined ? {} : { sourceOffset: event.sourceOffset }),
      traceId: input.workflowStart.workflowRun.traceId,
    })))
  }

  if (runtimeSession !== undefined) {
    yield* storage.markRuntimeSessionStatus({
      runtimeSessionId: runtimeSession.id,
      status: result.exitCode === undefined ? 'running' : result.exitCode === 0 ? 'completed' : 'failed',
      ...(result.exitCode === undefined ? {} : { completedAt: result.completedAt }),
      traceId: input.workflowStart.workflowRun.traceId,
    })
  }

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
  const candidatePatchSet = yield* storage.recordCandidatePatchSet({
    workflowRunId: input.workflowStart.workflowRun.id,
    status: diffArtifact === undefined ? 'empty' : 'captured',
    ...(result.baseSha === undefined ? {} : { baseSha: result.baseSha }),
    ...(diffArtifact === undefined ? {} : { diffArtifactId: diffArtifact.id }),
    summary: diffArtifact === undefined
      ? 'Sandbox completed without a captured candidate diff.'
      : 'Captured candidate patch diff from sandbox worktree.',
    createdAt: result.completedAt,
    traceId: input.workflowStart.workflowRun.traceId,
    operation: 'runSandboxAgentForWorkflow.recordCandidatePatchSet',
  })

  yield* ProposeMergeDecision({
    workflowRunId: input.workflowStart.workflowRun.id,
    sandboxExecution,
    candidatePatchSet,
    evidenceArtifacts,
    verificationResults: result.verificationResults,
    traceId: input.workflowStart.workflowRun.traceId,
    operation: 'runSandboxAgentForWorkflow.proposeMergeDecision',
  })

  return sandboxExecution
})
