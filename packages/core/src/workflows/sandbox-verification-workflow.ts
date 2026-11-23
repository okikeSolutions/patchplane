import { Cause, Duration, Effect, Exit, Option, Schedule, Schema } from 'effect'
import * as Digest from 'effect/crypto/Digest'
import type * as Redacted from 'effect/Redacted'
import {
  ArtifactKey,
  type ArtifactRecord,
  ChangeRequestId,
  EnvironmentQuarantineId,
  InboxItemId,
  SandboxCleanupError,
  SandboxExecutionError,
  type SandboxId,
  sanitizeErrorMessage,
  Sha256Hex,
  VerificationAttemptId,
} from '@patchplane/domain'
import { ArtifactStore } from '../services/artifact-store'
import {
  buildAttemptSandboxLabels,
  buildValidatedSandboxEnv,
  PATCHPLANE_ATTEMPT_ID_LABEL,
  PATCHPLANE_CHANGE_REQUEST_ID_LABEL,
  PATCHPLANE_MANAGED_LABEL,
  type ShortLivedAttemptModelCredential,
} from '../services/sandbox-credential-policy'
import { SandboxLifecycleStore } from '../services/sandbox-lifecycle-store'
import { SandboxProvider } from '../services/sandbox-provider'

export const DEFAULT_CLEANUP_TIMEOUT_MS = 5 * 60 * 1000
export const DEFAULT_CLEANUP_POLL_INTERVAL_MS = 1_000

const textEncoder = new TextEncoder()

export interface CleanupPolicyOptions {
  readonly cleanupTimeoutMs?: number
  readonly cleanupPollIntervalMs?: number
}

export interface IsolatedSandboxCheckResult {
  readonly sandboxId: SandboxId
  readonly exitCode: number
  readonly output: string
  readonly artifact: ArtifactRecord
  readonly cleanupConfirmed: true
}

export interface LeakReconciliationReport {
  readonly discoveredCount: number
  readonly cleanedSandboxIds: ReadonlyArray<SandboxId>
  readonly quarantinedSandboxIds: ReadonlyArray<SandboxId>
}

const quarantineOnCleanupFailure = Effect.fn(
  'SandboxLifecycle.quarantineOnCleanupFailure',
)(function* (input: {
  readonly sandboxId: SandboxId
  readonly attemptId: VerificationAttemptId
  readonly changeRequestId: ChangeRequestId
  readonly labels: Readonly<Record<string, string>>
  readonly error: SandboxCleanupError
}) {
  const lifecycleStore = yield* SandboxLifecycleStore
  const quarantineId = EnvironmentQuarantineId.make(
    `quarantine:${input.attemptId}:${input.sandboxId}`,
  )
  const inboxItemId = InboxItemId.make(
    `inbox:cleanup:${input.attemptId}:${input.sandboxId}`,
  )
  yield* lifecycleStore.quarantineSandboxEnvironment({
    quarantineId,
    inboxItemId,
    attemptId: input.attemptId,
    changeRequestId: input.changeRequestId,
    sandboxId: input.sandboxId,
    labels: input.labels,
    reason: input.error.reason,
  })
})

/**
 * Deletes a sandbox and confirms deletion by readback (`getSandbox` returning
 * `Option.none()`). Never ignores deletion failures: if deletion fails or the
 * sandbox is still observed after the cleanup timeout (default 5 minutes), the
 * environment is quarantined and a Decision Inbox item is created atomically.
 */
export const confirmSandboxDeletion = Effect.fn(
  'SandboxLifecycle.confirmSandboxDeletion',
)(function* (input: {
  readonly sandboxId: SandboxId
  readonly attemptId: VerificationAttemptId
  readonly changeRequestId: ChangeRequestId
  readonly labels: Readonly<Record<string, string>>
  readonly options?: CleanupPolicyOptions
}) {
  const provider = yield* SandboxProvider
  const lifecycleStore = yield* SandboxLifecycleStore
  const timeoutMs =
    input.options?.cleanupTimeoutMs ?? DEFAULT_CLEANUP_TIMEOUT_MS
  const pollIntervalMs =
    input.options?.cleanupPollIntervalMs ?? DEFAULT_CLEANUP_POLL_INTERVAL_MS

  const deleteAndVerify = Effect.gen(function* () {
    yield* provider.deleteSandbox({
      sandboxId: input.sandboxId,
      attemptId: input.attemptId,
    })

    const observed = yield* provider.getSandbox(input.sandboxId).pipe(
      Effect.mapError(
        (cause) =>
          new SandboxCleanupError({
            sandboxId: input.sandboxId,
            attemptId: input.attemptId,
            reason: `Readback failed during cleanup: ${sanitizeErrorMessage(cause)}`,
            timedOut: false,
            cause,
          }),
      ),
      Effect.repeat({
        schedule: Schedule.spaced(Duration.millis(pollIntervalMs)),
        until: (result) => Option.isNone(result),
      }),
    )

    if (Option.isSome(observed)) {
      return yield* new SandboxCleanupError({
        sandboxId: input.sandboxId,
        attemptId: input.attemptId,
        reason: `Sandbox ${input.sandboxId} still observed in state "${observed.value.state}" after delete`,
        timedOut: false,
      })
    }
    return yield* Effect.void
  }).pipe(
    Effect.timeoutOrElse({
      duration: Duration.millis(timeoutMs),
      orElse: () =>
        Effect.fail(
          new SandboxCleanupError({
            sandboxId: input.sandboxId,
            attemptId: input.attemptId,
            reason: `Sandbox cleanup timed out after ${timeoutMs}ms without confirmed deletion readback`,
            timedOut: true,
          }),
        ),
    }),
  )

  const exit = yield* Effect.exit(deleteAndVerify)
  if (Exit.isFailure(exit)) {
    const cleanupError = Option.getOrElse(
      Cause.findErrorOption(exit.cause),
      () =>
        new SandboxCleanupError({
          sandboxId: input.sandboxId,
          attemptId: input.attemptId,
          reason: sanitizeErrorMessage(exit.cause),
          timedOut: false,
          cause: exit.cause,
        }),
    )
    yield* quarantineOnCleanupFailure({
      sandboxId: input.sandboxId,
      attemptId: input.attemptId,
      changeRequestId: input.changeRequestId,
      labels: input.labels,
      error: cleanupError,
    })
    return yield* cleanupError
  }

  return yield* lifecycleStore.markSandboxDeleted(input.sandboxId)
})

/**
 * Executes an isolated check inside an attempt-labeled sandbox, hashes and
 * persists the resulting artifact to R2 with SHA-256 readback verification,
 * and always runs confirmed sandbox deletion (with quarantine + Decision Inbox
 * creation if cleanup fails or exceeds the 5-minute timeout).
 */
export const runIsolatedCheckInSandbox = Effect.fn(
  'SandboxLifecycle.runIsolatedCheckInSandbox',
)(function* (input: {
  readonly attemptId: VerificationAttemptId
  readonly changeRequestId: ChangeRequestId
  readonly command: string
  readonly commandTimeoutMs?: number
  readonly artifactKey?: ArtifactKey
  readonly modelCredential: ShortLivedAttemptModelCredential
  readonly extraEnv?: Readonly<Record<string, string | Redacted.Redacted>>
  readonly cleanup?: CleanupPolicyOptions
}) {
  const provider = yield* SandboxProvider
  const artifactStore = yield* ArtifactStore
  const lifecycleStore = yield* SandboxLifecycleStore
  const digest = yield* Digest.Digest

  // 1. Validate credentials BEFORE any sandbox is created (fail-closed)
  const validatedEnv = yield* buildValidatedSandboxEnv({
    attemptId: input.attemptId,
    modelCredential: input.modelCredential,
    ...(input.extraEnv !== undefined ? { extraEnv: input.extraEnv } : {}),
  })

  // 2. Create attempt-labeled sandbox and persist active record
  const labels = buildAttemptSandboxLabels({
    attemptId: input.attemptId,
    changeRequestId: input.changeRequestId,
  })
  const created = yield* provider.createSandbox({
    attemptId: input.attemptId,
    changeRequestId: input.changeRequestId,
    labels,
    env: validatedEnv,
    autoDeleteIntervalMinutes: 30,
  })

  yield* lifecycleStore.recordSandboxCreated({
    sandboxId: created.sandboxId,
    attemptId: input.attemptId,
    changeRequestId: input.changeRequestId,
    labels,
  })

  // 3. Execute check + store SHA-256-verified artifact, ALWAYS running confirmed cleanup
  const artifactKey =
    input.artifactKey ??
    ArtifactKey.make(`attempts/${input.attemptId}/check-output.log`)

  const runWork = Effect.gen(function* () {
    const execResult = yield* provider.execCommand({
      sandboxId: created.sandboxId,
      command: input.command,
      ...(input.commandTimeoutMs !== undefined
        ? { timeoutMs: input.commandTimeoutMs }
        : {}),
    })

    const bytes = textEncoder.encode(execResult.output)
    const rawSha256 = yield* digest.digestHex(Digest.sha256, bytes)
    const expectedSha256 = yield* Schema.decodeEffect(Sha256Hex)(
      rawSha256,
    ).pipe(
      Effect.mapError(
        (cause) =>
          new SandboxExecutionError({
            operation: 'SandboxLifecycle.hashArtifact',
            message: sanitizeErrorMessage(cause),
            sandboxId: created.sandboxId,
            cause,
          }),
      ),
    )

    const storedArtifact = yield* artifactStore.putVerifiedArtifact({
      attemptId: input.attemptId,
      artifactKey,
      body: bytes,
      contentType: 'text/plain; charset=utf-8',
      expectedSha256,
    })

    yield* lifecycleStore.recordArtifactMetadata(storedArtifact)

    return {
      exitCode: execResult.exitCode,
      output: execResult.output,
      artifact: storedArtifact,
    }
  })

  const workExit = yield* Effect.exit(runWork)

  // Always run confirmed deletion (never Effect.ignore). If cleanup fails or
  // times out, quarantine + Decision Inbox item are written and SandboxCleanupError surfaces.
  yield* confirmSandboxDeletion({
    sandboxId: created.sandboxId,
    attemptId: input.attemptId,
    changeRequestId: input.changeRequestId,
    labels,
    ...(input.cleanup !== undefined ? { options: input.cleanup } : {}),
  })

  const workResult = yield* workExit

  return {
    sandboxId: created.sandboxId,
    exitCode: workResult.exitCode,
    output: workResult.output,
    artifact: workResult.artifact,
    cleanupConfirmed: true,
  } satisfies IsolatedSandboxCheckResult
})

/**
 * Discovers leaked sandboxes via deterministic Patchplane attempt labels
 * (`patchplane.managed=true`) and cleans up any sandbox whose attempt is not
 * currently active, confirming deletion by readback or quarantining on failure.
 */
export const reconcileLeakedSandboxes = Effect.fn(
  'SandboxLifecycle.reconcileLeakedSandboxes',
)(function* (input: {
  readonly activeAttemptIds: ReadonlySet<VerificationAttemptId>
  readonly cleanup?: CleanupPolicyOptions
}) {
  const provider = yield* SandboxProvider
  const listed = yield* provider.listSandboxesByLabels({
    [PATCHPLANE_MANAGED_LABEL]: 'true',
  })

  const cleanedSandboxIds: Array<SandboxId> = []
  const quarantinedSandboxIds: Array<SandboxId> = []
  let discoveredCount = 0

  for (const sandbox of listed) {
    const rawAttemptId = sandbox.labels[PATCHPLANE_ATTEMPT_ID_LABEL]
    const rawCrId = sandbox.labels[PATCHPLANE_CHANGE_REQUEST_ID_LABEL]
    if (rawAttemptId === undefined || rawAttemptId.length === 0) continue

    const attemptId = yield* Schema.decodeEffect(VerificationAttemptId)(
      rawAttemptId,
    ).pipe(
      Effect.mapError(
        (cause) =>
          new SandboxExecutionError({
            operation: 'SandboxLifecycle.reconcileLeakedSandboxes',
            message: sanitizeErrorMessage(cause),
            sandboxId: sandbox.sandboxId,
            cause,
          }),
      ),
    )

    if (input.activeAttemptIds.has(attemptId)) continue
    discoveredCount += 1

    const changeRequestId = yield* Schema.decodeEffect(ChangeRequestId)(
      rawCrId !== undefined && rawCrId.length > 0 ? rawCrId : 'unknown',
    ).pipe(
      Effect.mapError(
        (cause) =>
          new SandboxExecutionError({
            operation: 'SandboxLifecycle.reconcileLeakedSandboxes',
            message: sanitizeErrorMessage(cause),
            sandboxId: sandbox.sandboxId,
            cause,
          }),
      ),
    )

    const cleanupExit = yield* Effect.exit(
      confirmSandboxDeletion({
        sandboxId: sandbox.sandboxId,
        attemptId,
        changeRequestId,
        labels: sandbox.labels,
        ...(input.cleanup !== undefined ? { options: input.cleanup } : {}),
      }),
    )

    if (Exit.isSuccess(cleanupExit)) {
      cleanedSandboxIds.push(sandbox.sandboxId)
    } else {
      quarantinedSandboxIds.push(sandbox.sandboxId)
    }
  }

  return {
    discoveredCount,
    cleanedSandboxIds,
    quarantinedSandboxIds,
  } satisfies LeakReconciliationReport
})
