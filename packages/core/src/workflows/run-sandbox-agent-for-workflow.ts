import { Clock, Effect, Match, Schema } from 'effect'
import { SandboxError } from '@patchplane/domain/errors'
import type { RuntimeSession } from '@patchplane/domain/runtime-session'
import type { VerificationPlatform } from '@patchplane/domain/verification'
import type { WorkflowStart } from '@patchplane/domain/workflow-start'
import { GitCommitSha } from '@patchplane/domain/refinements'
import { PrepareRepositoryClone } from '../repository/prepare-repository-clone'
import { SandboxService } from '../services/sandbox-service'
import { StorageService } from '../services/storage-service'
import {
  withAttemptClaimTransition,
  withCandidateFreezeTransition,
  withRequirementsPersistedTransition,
  withSandboxExecutionTransition,
  withVerificationTransition,
} from './sandbox-workflow-telemetry'
import { CaptureEvidenceArtifact } from './capture-evidence-artifact'
import { CaptureSandboxResultArtifacts } from './capture-sandbox-result-artifacts'
import { CandidatePatchStatsFromSandboxResult } from './candidate-patch-stats'
import type { IncomingPullRequestDispatch } from './freeze-incoming-pull-request-candidate'
import {
  PersistConfiguredVerificationRequirements,
  PersistLegacyConfiguredVerificationRequirements,
  PersistSandboxVerificationEvidence,
  isPersistedVerificationPlanV1,
  type PersistedVerificationPlanV1,
} from './persist-sandbox-verification-evidence'
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
)(function* (input: {
  readonly workflowStart: WorkflowStart
  readonly incomingDispatch?: IncomingPullRequestDispatch | undefined
  readonly provider: string
  readonly model: string
  readonly thinking?: string | undefined
  readonly mode?: 'json' | 'rpc' | undefined
  readonly timeoutSeconds?: number | undefined
  readonly evidenceTestReportCommand?: string | undefined
  readonly evidenceTestPlatform?: VerificationPlatform | undefined
  readonly evidenceBrowserScreenshotCommand?: string | undefined
  readonly verificationPlan?: PersistedVerificationPlanV1 | undefined
}) {
  const storage = yield* StorageService
  const transitionContext = {
    traceId: input.workflowStart.workflowRun.traceId,
    workflowRunId: input.workflowStart.workflowRun.id,
  } as const
  const frozenCandidate = input.incomingDispatch?.candidatePatchSet
  const workflowRun = input.workflowStart.workflowRun
  const suppliedPlan = input.verificationPlan
  if (
    (workflowRun.candidateIdentityVersion === 'incoming-pr-v1' &&
      suppliedPlan === undefined) ||
    (suppliedPlan !== undefined &&
      (!isPersistedVerificationPlanV1(suppliedPlan) ||
        suppliedPlan.plan.workflowRunId !== workflowRun.id ||
        suppliedPlan.requirements.length !==
          suppliedPlan.plan.requirements.length ||
        suppliedPlan.plan.requirements.some(
          (planned) =>
            !suppliedPlan.requirements.some(
              (persisted) =>
                persisted.verificationPlanId === suppliedPlan.plan.id &&
                persisted.key === planned.key &&
                persisted.label === planned.label &&
                persisted.kind === planned.kind &&
                persisted.required === planned.required &&
                persisted.command === planned.command &&
                persisted.platform === planned.platform &&
                persisted.architecture === planned.architecture &&
                persisted.timeoutSeconds === planned.timeoutSeconds &&
                JSON.stringify(persisted.requiredArtifactKinds) ===
                  JSON.stringify(planned.requiredArtifactKinds),
            ),
        )))
  ) {
    return yield* new SandboxError({
      operation: 'runSandboxAgentForWorkflow.validateVerificationPlan',
      message:
        'Persisted verification plan capability is incomplete or mismatched',
      cause: undefined,
    })
  }
  if (
    workflowRun.candidateIdentityVersion === 'incoming-pr-v1' &&
    (frozenCandidate?.subject?.kind !== 'incoming-pull-request' ||
      frozenCandidate.status !== 'captured' ||
      frozenCandidate.candidateDigest === undefined ||
      frozenCandidate.diffArtifactId === undefined ||
      frozenCandidate.workflowRunId !== workflowRun.id ||
      frozenCandidate.baseSha !== workflowRun.sourceBaseSha ||
      frozenCandidate.headSha !== workflowRun.sourceCommitSha ||
      frozenCandidate.subject.baseSha !== workflowRun.sourceBaseSha ||
      frozenCandidate.subject.headSha !== workflowRun.sourceCommitSha)
  ) {
    return yield* new SandboxError({
      operation: 'runSandboxAgentForWorkflow.requireFrozenCandidate',
      message:
        'Incoming PR workflow cannot dispatch before its candidate is frozen',
      cause: undefined,
    })
  }
  if (
    workflowRun.candidateIdentityVersion !== 'incoming-pr-v1' &&
    input.incomingDispatch !== undefined
  ) {
    return yield* new SandboxError({
      operation: 'runSandboxAgentForWorkflow.validateDispatch',
      message:
        'Incoming candidate dispatch cannot be used for a legacy workflow',
      cause: undefined,
    })
  }
  if (
    input.incomingDispatch !== undefined &&
    !(yield* storage.validateIncomingDispatch({
      workflowRunId: workflowRun.id,
      candidatePatchSetId: frozenCandidate!.id,
      dispatchToken: input.incomingDispatch.dispatchToken,
      traceId: workflowRun.traceId,
      operation: 'runSandboxAgentForWorkflow.validateDispatchLease',
    }))
  ) {
    return yield* new SandboxError({
      operation: 'runSandboxAgentForWorkflow.validateDispatchLease',
      message: 'Incoming candidate dispatch lease is not active',
      cause: undefined,
    })
  }
  const claimed =
    input.incomingDispatch !== undefined
      ? true
      : yield* withAttemptClaimTransition(
          {
            ...transitionContext,
            operation: 'runSandboxAgentForWorkflow.claimExecution',
          },
          storage.claimWorkflowExecution({
            workflowRunId: input.workflowStart.workflowRun.id,
            traceId: input.workflowStart.workflowRun.traceId,
            operation: 'runSandboxAgentForWorkflow.claimExecution',
          }),
        )
  if (!claimed) return undefined

  return yield* Effect.gen(function* () {
    const verificationRequirements =
      input.verificationPlan?.requirements ??
      (yield* withRequirementsPersistedTransition(
        {
          ...transitionContext,
          operation:
            'runSandboxAgentForWorkflow.persistVerificationRequirements',
        },
        workflowRun.candidateIdentityVersion === 'incoming-pr-v1'
          ? PersistConfiguredVerificationRequirements({
              workflowRunId: input.workflowStart.workflowRun.id,
              testCommand: input.evidenceTestReportCommand,
              testPlatform: input.evidenceTestPlatform,
              browserCommand: input.evidenceBrowserScreenshotCommand,
              timeoutSeconds: input.timeoutSeconds,
              createdAt: yield* Clock.currentTimeMillis,
              traceId: input.workflowStart.workflowRun.traceId,
              operation:
                'runSandboxAgentForWorkflow.persistVerificationRequirements',
            }).pipe(Effect.map((persisted) => persisted.requirements))
          : PersistLegacyConfiguredVerificationRequirements({
              workflowRunId: input.workflowStart.workflowRun.id,
              testCommand: input.evidenceTestReportCommand,
              testPlatform: input.evidenceTestPlatform,
              browserCommand: input.evidenceBrowserScreenshotCommand,
              timeoutSeconds: input.timeoutSeconds,
              createdAt: yield* Clock.currentTimeMillis,
              traceId: input.workflowStart.workflowRun.traceId,
              operation:
                'runSandboxAgentForWorkflow.persistLegacyVerificationRequirements',
            }),
      ))

    const clone = yield* PrepareRepositoryClone(input.workflowStart)
    if (clone === undefined) {
      return yield* new SandboxError({
        operation: 'runSandboxAgentForWorkflow.prepareRepository',
        message: 'Claimed workflow attempt has no repository clone target',
        cause: undefined,
      })
    }

    const sandbox = yield* SandboxService
    const runnableTestCommand =
      input.verificationPlan === undefined &&
      (input.evidenceTestPlatform === undefined ||
        input.evidenceTestPlatform === 'linux')
        ? input.evidenceTestReportCommand
        : undefined
    const runnableBrowserCommand =
      input.verificationPlan === undefined
        ? input.evidenceBrowserScreenshotCommand
        : undefined
    let runtimeSession: RuntimeSession | undefined
    const result = yield* withSandboxExecutionTransition(
      {
        ...transitionContext,
        operation: 'runSandboxAgentForWorkflow.executeSandbox',
      },
      sandbox.runRepositoryAgent({
        ...clone,
        ...(frozenCandidate?.baseSha === undefined
          ? {}
          : { candidateBaseSha: frozenCandidate.baseSha }),
        prompt: input.workflowStart.promptRequest.prompt,
        provider: input.provider,
        model: input.model,
        thinking: input.thinking,
        mode: input.mode,
        timeoutSeconds: input.timeoutSeconds,
        evidenceTestReportCommand: runnableTestCommand,
        evidenceBrowserScreenshotCommand: runnableBrowserCommand,
        traceId: input.workflowStart.workflowRun.traceId,
        ...(input.incomingDispatch === undefined
          ? {}
          : {
              onSandboxStarted: (sandboxId: string) =>
                storage
                  .startIncomingDispatch({
                    workflowRunId: input.workflowStart.workflowRun.id,
                    candidatePatchSetId:
                      input.incomingDispatch!.candidatePatchSet.id,
                    dispatchToken: input.incomingDispatch!.dispatchToken,
                    sandboxId,
                    traceId: input.workflowStart.workflowRun.traceId,
                    operation:
                      'runSandboxAgentForWorkflow.startIncomingDispatch',
                  })
                  .pipe(
                    Effect.filterOrFail(
                      (started) => started,
                      () =>
                        new SandboxError({
                          operation:
                            'runSandboxAgentForWorkflow.startIncomingDispatch',
                          message:
                            'Incoming candidate dispatch lease could not be started',
                          cause: input.workflowStart.workflowRun.id,
                        }),
                    ),
                    Effect.asVoid,
                  ),
            }),
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
          storage.recordRuntimeEvents(
            events.map((event) => ({
              workflowRunId: input.workflowStart.workflowRun.id,
              provider: event.provider,
              type: event.type,
              occurredAt: event.occurredAt,
              ...(event.summary === undefined
                ? {}
                : { summary: event.summary }),
              ...(event.payloadJson === undefined
                ? {}
                : { payloadJson: event.payloadJson }),
              ...(event.idempotencyKey === undefined
                ? {}
                : { idempotencyKey: event.idempotencyKey }),
              ...(event.sourceSessionId === undefined
                ? {}
                : { sourceSessionId: event.sourceSessionId }),
              ...(event.sourceCommandId === undefined
                ? {}
                : { sourceCommandId: event.sourceCommandId }),
              ...(event.sourceStream === undefined
                ? {}
                : { sourceStream: event.sourceStream }),
              ...(event.sourceLine === undefined
                ? {}
                : { sourceLine: event.sourceLine }),
              ...(event.sourceOffset === undefined
                ? {}
                : { sourceOffset: event.sourceOffset }),
              traceId: input.workflowStart.workflowRun.traceId,
            })),
          ),
      }),
    )

    runtimeSession =
      runtimeSession ??
      (result.sessionId !== undefined && result.commandId !== undefined
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
      yield* storage.recordRuntimeEvents(
        result.runtimeEvents.map((event) => ({
          workflowRunId: input.workflowStart.workflowRun.id,
          provider: event.provider,
          type: event.type,
          occurredAt: event.occurredAt,
          ...(event.summary === undefined ? {} : { summary: event.summary }),
          ...(event.payloadJson === undefined
            ? {}
            : { payloadJson: event.payloadJson }),
          ...(event.idempotencyKey === undefined
            ? {}
            : { idempotencyKey: event.idempotencyKey }),
          ...(event.sourceSessionId === undefined
            ? {}
            : { sourceSessionId: event.sourceSessionId }),
          ...(event.sourceCommandId === undefined
            ? {}
            : { sourceCommandId: event.sourceCommandId }),
          ...(event.sourceStream === undefined
            ? {}
            : { sourceStream: event.sourceStream }),
          ...(event.sourceLine === undefined
            ? {}
            : { sourceLine: event.sourceLine }),
          ...(event.sourceOffset === undefined
            ? {}
            : { sourceOffset: event.sourceOffset }),
          traceId: input.workflowStart.workflowRun.traceId,
        })),
      )
    }

    if (runtimeSession !== undefined) {
      yield* storage.markRuntimeSessionStatus({
        runtimeSessionId: runtimeSession.id,
        status: Match.value(result.exitCode).pipe(
          Match.when(undefined, () => 'running' as const),
          Match.when(0, () => 'completed' as const),
          Match.orElse(() => 'failed' as const),
        ),
        ...(result.exitCode === undefined
          ? {}
          : { completedAt: result.completedAt }),
        traceId: input.workflowStart.workflowRun.traceId,
      })
    }

    const sandboxExecution = yield* storage.recordSandboxExecution({
      workflowRunId: input.workflowStart.workflowRun.id,
      ...(input.incomingDispatch === undefined
        ? {}
        : { incomingDispatchToken: input.incomingDispatch.dispatchToken }),
      provider: result.provider,
      sandboxId: result.sandboxId,
      command: result.command,
      status: result.exitCode === 0 ? 'succeeded' : 'failed',
      ...(result.exitCode === undefined ? {} : { exitCode: result.exitCode }),
      stdout: truncatePreview(result.stdout),
      ...(result.stderr === undefined
        ? {}
        : { stderr: truncatePreview(result.stderr) }),
      ...(result.policy === undefined ? {} : { policy: result.policy }),
      startedAt: result.startedAt,
      completedAt: result.completedAt,
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
      ...(frozenCandidate?.candidateDigest === undefined
        ? {}
        : { subjectDigest: frozenCandidate.candidateDigest }),
      ...(result.initialCandidateStateDigest === undefined
        ? {}
        : { initialCandidateStateDigest: result.initialCandidateStateDigest }),
    })

    const candidatePatchSet =
      frozenCandidate ??
      (yield* Effect.gen(function* () {
        const diffArtifact = evidenceArtifacts.find(
          (artifact) => artifact.kind === 'diff',
        )
        const baseSha =
          result.baseSha === undefined
            ? undefined
            : yield* Schema.decodeUnknownEffect(GitCommitSha)(
                result.baseSha,
              ).pipe(
                Effect.mapError(
                  (cause) =>
                    new SandboxError({
                      operation: 'runSandboxAgentForWorkflow.decodeBaseSha',
                      message: 'Sandbox returned an invalid candidate base SHA',
                      cause,
                    }),
                ),
              )
        const captured = diffArtifact !== undefined && baseSha !== undefined
        const stats = yield* CandidatePatchStatsFromSandboxResult(result)
        return yield* withCandidateFreezeTransition(
          {
            ...transitionContext,
            operation: 'runSandboxAgentForWorkflow.recordCandidatePatchSet',
          },
          storage.recordCandidatePatchSet({
            workflowRunId: input.workflowStart.workflowRun.id,
            sandboxExecutionId: sandboxExecution.id,
            status: captured ? 'captured' : 'empty',
            ...(captured
              ? { candidateDigest: `sha256:${diffArtifact.sha256}` }
              : {}),
            ...(baseSha === undefined ? {} : { baseSha }),
            ...(captured ? { diffArtifactId: diffArtifact.id } : {}),
            ...(captured && stats !== undefined ? { stats } : {}),
            summary: captured
              ? 'Captured candidate patch diff from sandbox worktree.'
              : 'Sandbox completed without a candidate that could be bound to a base commit and diff artifact.',
            idempotencyKey: `${sandboxExecution.id}:candidate`,
            createdAt: result.completedAt,
            traceId: input.workflowStart.workflowRun.traceId,
            operation: 'runSandboxAgentForWorkflow.recordCandidatePatchSet',
          }),
        )
      }))

    const verificationEvidence = yield* withVerificationTransition(
      {
        ...transitionContext,
        operation: 'runSandboxAgentForWorkflow.persistVerificationEvidence',
      },
      PersistSandboxVerificationEvidence({
        workflowRunId: input.workflowStart.workflowRun.id,
        sandboxExecution,
        candidatePatchSet,
        evidenceArtifacts,
        sandboxResult: result,
        verificationRequirements,
        traceId: input.workflowStart.workflowRun.traceId,
        operation: 'runSandboxAgentForWorkflow.persistVerificationEvidence',
      }),
    )

    yield* ProposeMergeDecision({
      workflowRunId: input.workflowStart.workflowRun.id,
      sandboxExecution,
      candidatePatchSet,
      evidenceArtifacts,
      verificationRequirements: verificationEvidence.requirements,
      verificationResults: verificationEvidence.results,
      traceId: input.workflowStart.workflowRun.traceId,
      operation: 'runSandboxAgentForWorkflow.proposeMergeDecision',
    })

    return sandboxExecution
  }).pipe(
    Effect.tapCause(() =>
      storage.markWorkflowExecutionFailed({
        workflowRunId: input.workflowStart.workflowRun.id,
        ...(input.incomingDispatch === undefined
          ? {}
          : { incomingDispatchToken: input.incomingDispatch.dispatchToken }),
        summary: 'Workflow execution failed after the attempt was claimed.',
        traceId: input.workflowStart.workflowRun.traceId,
        operation: 'runSandboxAgentForWorkflow.markExecutionFailed',
      }),
    ),
  )
})
