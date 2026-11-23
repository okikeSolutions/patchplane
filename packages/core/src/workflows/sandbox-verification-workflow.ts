import { Cause, Duration, Effect, Exit, Option, Schedule, Schema } from 'effect'
import * as Digest from 'effect/crypto/Digest'
import type * as Redacted from 'effect/Redacted'
import { Activity, Workflow } from 'effect/workflow'
import {
  ArtifactIntegrityError,
  ArtifactKey,
  ArtifactRecord,
  ArtifactStorageError,
  ChangeRequestId,
  EnvironmentQuarantineId,
  InboxItemId,
  PersistenceError,
  SandboxCleanupError,
  SandboxCredentialPolicyError,
  SandboxExecutionError,
  SandboxId,
  sanitizeErrorMessage,
  Sha256Hex,
  VerificationAttemptId,
} from '@patchplane/domain'
import { ArtifactStore } from '../services/artifact-store'
import { ModelCredentialIssuer } from '../services/model-credential-issuer'
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
export const MAX_CLEANUP_TIMEOUT_MS = 10 * 60 * 1000
export const DEFAULT_CLEANUP_POLL_INTERVAL_MS = 1_000
export const MIN_CLEANUP_POLL_INTERVAL_MS = 10
export const MAX_CLEANUP_POLL_INTERVAL_MS = 30_000

export const DEFAULT_COMMAND_TIMEOUT_MS = 5 * 60 * 1000
export const MAX_COMMAND_TIMEOUT_MS = 30 * 60 * 1000

/** Cap single check artifact payload to 16 MiB to protect lite containers. */
export const MAX_ARTIFACT_BYTES = 16 * 1024 * 1024

const textEncoder = new TextEncoder()

export interface CleanupPolicyOptions {
  readonly cleanupTimeoutMs?: number
  readonly cleanupPollIntervalMs?: number
}

export const IsolatedSandboxCheckResult = Schema.Struct({
  sandboxId: SandboxId,
  exitCode: Schema.Number.check(Schema.isInt()),
  output: Schema.String,
  artifact: ArtifactRecord,
  cleanupConfirmed: Schema.Literal(true),
})
export interface IsolatedSandboxCheckResult extends Schema.Schema.Type<
  typeof IsolatedSandboxCheckResult
> {}

export interface LeakReconciliationReport {
  readonly discoveredCount: number
  readonly cleanedSandboxIds: ReadonlyArray<SandboxId>
  readonly quarantinedSandboxIds: ReadonlyArray<SandboxId>
}

const normalizePositiveBound = (
  value: number | undefined,
  fallback: number,
  min: number,
  max: number,
): number => {
  if (value === undefined || !Number.isFinite(value)) return fallback
  return Math.min(max, Math.max(min, Math.trunc(value)))
}

const nonEmptyReason = (raw: string, fallback: string): string => {
  const trimmed = raw.trim()
  return trimmed.length > 0 ? trimmed : fallback
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
    reason: nonEmptyReason(input.error.reason, 'Sandbox cleanup failed'),
  })
})

/**
 * Deletes a sandbox and confirms deletion by BOTH `getSandbox` readback AND
 * `listSandboxesByLabels` readback (so sandboxes stuck in `"destroying"` —
 * which Daytona's `CreateSandboxHttp.get()` collapses to `undefined` — are
 * still observed until truly gone).
 *
 * Runs uninterruptibly so caller cancellation cannot leak a live sandbox or
 * trigger a false quarantine; on deletion failure or timeout (default 5 min),
 * atomically quarantines the environment and creates a Decision Inbox item.
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
  const timeoutMs = normalizePositiveBound(
    input.options?.cleanupTimeoutMs,
    DEFAULT_CLEANUP_TIMEOUT_MS,
    100,
    MAX_CLEANUP_TIMEOUT_MS,
  )
  const pollIntervalMs = normalizePositiveBound(
    input.options?.cleanupPollIntervalMs,
    DEFAULT_CLEANUP_POLL_INTERVAL_MS,
    MIN_CLEANUP_POLL_INTERVAL_MS,
    MAX_CLEANUP_POLL_INTERVAL_MS,
  )

  const readbackStillPresent = Effect.gen(function* () {
    const byId = yield* provider.getSandbox(input.sandboxId)
    if (Option.isSome(byId) && byId.value.state !== 'destroyed') {
      return Option.some(byId.value.state)
    }
    // Check list by managed attempt labels as well: Daytona's `get()` treats
    // `"destroying"` as `undefined`, whereas `list()` exposes stuck sandboxes.
    const listFilter: Record<string, string> = {
      [PATCHPLANE_MANAGED_LABEL]: 'true',
      ...(input.labels[PATCHPLANE_ATTEMPT_ID_LABEL] !== undefined
        ? {
            [PATCHPLANE_ATTEMPT_ID_LABEL]:
              input.labels[PATCHPLANE_ATTEMPT_ID_LABEL],
          }
        : {}),
    }
    const listed = yield* provider.listSandboxesByLabels(listFilter)
    const match = listed.find(
      (entry) =>
        entry.sandboxId === input.sandboxId && entry.state !== 'destroyed',
    )
    return match !== undefined ? Option.some(match.state) : Option.none()
  }).pipe(
    Effect.mapError(
      (cause) =>
        new SandboxCleanupError({
          sandboxId: input.sandboxId,
          attemptId: input.attemptId,
          reason: nonEmptyReason(
            `Readback failed during cleanup: ${sanitizeErrorMessage(cause)}`,
            'Readback failed during cleanup',
          ),
          timedOut: false,
        }),
    ),
  )

  const deleteAndVerify = Effect.gen(function* () {
    yield* provider.deleteSandbox({
      sandboxId: input.sandboxId,
      attemptId: input.attemptId,
    })

    const observedState = yield* readbackStillPresent.pipe(
      Effect.repeat({
        schedule: Schedule.spaced(Duration.millis(pollIntervalMs)),
        until: (state) => Option.isNone(state),
      }),
    )

    if (Option.isSome(observedState)) {
      return yield* new SandboxCleanupError({
        sandboxId: input.sandboxId,
        attemptId: input.attemptId,
        reason: `Sandbox ${input.sandboxId} still observed in state "${observedState.value}" after delete`,
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

  const exit = yield* Effect.exit(Effect.uninterruptible(deleteAndVerify))
  if (Exit.isFailure(exit)) {
    if (Cause.hasInterruptsOnly(exit.cause)) {
      return yield* Effect.failCause(exit.cause)
    }
    const cleanupError = Option.getOrElse(
      Cause.findErrorOption(exit.cause),
      () =>
        new SandboxCleanupError({
          sandboxId: input.sandboxId,
          attemptId: input.attemptId,
          reason: nonEmptyReason(
            sanitizeErrorMessage(exit.cause),
            'Sandbox cleanup failed with defect',
          ),
          timedOut: false,
        }),
    )
    yield* Effect.uninterruptible(
      quarantineOnCleanupFailure({
        sandboxId: input.sandboxId,
        attemptId: input.attemptId,
        changeRequestId: input.changeRequestId,
        labels: input.labels,
        error: cleanupError,
      }),
    )
    return yield* cleanupError
  }

  return yield* Effect.uninterruptible(
    lifecycleStore.markSandboxDeleted({
      sandboxId: input.sandboxId,
      attemptId: input.attemptId,
      changeRequestId: input.changeRequestId,
      labels: input.labels,
    }),
  )
})

/**
 * Executes an isolated check inside an attempt-labeled sandbox, hashes and
 * persists the resulting artifact to R2 with SHA-256 readback verification,
 * and ALWAYS runs confirmed sandbox deletion (even on DB failure or fiber
 * interruption) using `Effect.uninterruptibleMask`.
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

  // 1. Validate credentials and artifact key scope BEFORE any sandbox is created
  const validatedEnv = yield* buildValidatedSandboxEnv({
    attemptId: input.attemptId,
    modelCredential: input.modelCredential,
    ...(input.extraEnv !== undefined ? { extraEnv: input.extraEnv } : {}),
  })

  const expectedPrefix = `attempts/${input.attemptId}/`
  const artifactKey =
    input.artifactKey ?? ArtifactKey.make(`${expectedPrefix}check-output.log`)
  if (!artifactKey.startsWith(expectedPrefix)) {
    return yield* new SandboxExecutionError({
      operation: 'SandboxLifecycle.validateArtifactKey',
      message: `Artifact key "${artifactKey}" must be scoped under "${expectedPrefix}"`,
    })
  }

  const commandTimeoutMs = normalizePositiveBound(
    input.commandTimeoutMs,
    DEFAULT_COMMAND_TIMEOUT_MS,
    1_000,
    MAX_COMMAND_TIMEOUT_MS,
  )

  const labels = buildAttemptSandboxLabels({
    attemptId: input.attemptId,
    changeRequestId: input.changeRequestId,
  })

  // 2. Acquire sandbox uninterruptibly; any DB error, execution error, or
  //    interruption in the body still triggers confirmed sandbox deletion.
  return yield* Effect.uninterruptibleMask((restore) =>
    Effect.gen(function* () {
      const created = yield* provider.createSandbox({
        attemptId: input.attemptId,
        changeRequestId: input.changeRequestId,
        labels,
        env: validatedEnv,
        autoDeleteIntervalMinutes: 30,
      })

      const workExit = yield* Effect.exit(
        restore(
          Effect.gen(function* () {
            yield* lifecycleStore.recordSandboxCreated({
              sandboxId: created.sandboxId,
              attemptId: input.attemptId,
              changeRequestId: input.changeRequestId,
              labels,
            })

            const execResult = yield* provider.execCommand({
              sandboxId: created.sandboxId,
              command: input.command,
              timeoutMs: commandTimeoutMs,
            })

            const bytes = textEncoder.encode(execResult.output)
            if (bytes.byteLength > MAX_ARTIFACT_BYTES) {
              return yield* new SandboxExecutionError({
                operation: 'SandboxLifecycle.checkArtifactSize',
                message: `Check output (${bytes.byteLength} bytes) exceeds maximum artifact size (${MAX_ARTIFACT_BYTES} bytes)`,
                sandboxId: created.sandboxId,
              })
            }

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
          }),
        ),
      )

      // Confirmed deletion ALWAYS runs uninterruptibly (never Effect.ignore).
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
    }),
  )
})

const UNKNOWN_ATTEMPT_ID = VerificationAttemptId.make('unlabeled-orphan')
const UNKNOWN_CHANGE_REQUEST_ID = ChangeRequestId.make('unknown')

/**
 * Discovers leaked sandboxes via deterministic Patchplane attempt labels
 * (`patchplane.managed=true`) and cleans up any sandbox whose attempt is not
 * currently active, confirming deletion by readback or quarantining on failure.
 *
 * Isolates per-sandbox malformed labels (falling back to orphan IDs instead of
 * aborting the sweep) and only counts a sandbox as quarantined when
 * `SandboxCleanupError` confirmed quarantine persistence (propagating
 * `PersistenceError`, defects, and interrupts).
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
    if (sandbox.state === 'destroyed') continue

    const rawAttemptId = sandbox.labels[PATCHPLANE_ATTEMPT_ID_LABEL]
    const decodedAttemptId =
      rawAttemptId !== undefined && rawAttemptId.length > 0
        ? Schema.decodeOption(VerificationAttemptId)(rawAttemptId)
        : Option.none()
    const attemptId = Option.getOrElse(
      decodedAttemptId,
      () => UNKNOWN_ATTEMPT_ID,
    )

    if (
      Option.isSome(decodedAttemptId) &&
      input.activeAttemptIds.has(attemptId)
    ) {
      continue
    }

    discoveredCount += 1

    const rawCrId = sandbox.labels[PATCHPLANE_CHANGE_REQUEST_ID_LABEL]
    const changeRequestId = Option.getOrElse(
      rawCrId !== undefined && rawCrId.length > 0
        ? Schema.decodeOption(ChangeRequestId)(rawCrId)
        : Option.none(),
      () => UNKNOWN_CHANGE_REQUEST_ID,
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
      continue
    }

    const typedError = Cause.findErrorOption(cleanupExit.cause)
    if (
      Option.isSome(typedError) &&
      typedError.value._tag === 'SandboxCleanupError'
    ) {
      // Only recorded as quarantined when confirmSandboxDeletion succeeded in
      // persisting the quarantine + Decision Inbox item before failing with SandboxCleanupError.
      quarantinedSandboxIds.push(sandbox.sandboxId)
      continue
    }

    // PersistenceError, defects, or interrupts mean quarantine was NOT confirmed:
    // fail visibly instead of falsely claiming the leak is quarantined.
    return yield* Effect.failCause(cleanupExit.cause)
  }

  return {
    discoveredCount,
    cleanedSandboxIds,
    quarantinedSandboxIds,
  } satisfies LeakReconciliationReport
})

export const SandboxVerificationWorkflowPayload = Schema.Struct({
  attemptId: VerificationAttemptId,
  changeRequestId: ChangeRequestId,
  command: Schema.NonEmptyString,
  commandTimeoutMs: Schema.optionalKey(
    Schema.Number.check(
      Schema.isInt(),
      Schema.isGreaterThanOrEqualTo(1_000),
      Schema.isLessThanOrEqualTo(MAX_COMMAND_TIMEOUT_MS),
    ),
  ),
  cleanupTimeoutMs: Schema.optionalKey(
    Schema.Number.check(
      Schema.isInt(),
      Schema.isGreaterThanOrEqualTo(100),
      Schema.isLessThanOrEqualTo(MAX_CLEANUP_TIMEOUT_MS),
    ),
  ),
  cleanupPollIntervalMs: Schema.optionalKey(
    Schema.Number.check(
      Schema.isInt(),
      Schema.isGreaterThanOrEqualTo(MIN_CLEANUP_POLL_INTERVAL_MS),
      Schema.isLessThanOrEqualTo(MAX_CLEANUP_POLL_INTERVAL_MS),
    ),
  ),
})
export interface SandboxVerificationWorkflowPayload extends Schema.Schema.Type<
  typeof SandboxVerificationWorkflowPayload
> {}

export const SandboxVerificationWorkflowError = Schema.Union([
  SandboxCredentialPolicyError,
  SandboxExecutionError,
  SandboxCleanupError,
  ArtifactStorageError,
  ArtifactIntegrityError,
  PersistenceError,
])

export const SandboxVerificationWorkflow = Workflow.make(
  'SandboxVerificationWorkflow',
  {
    payload: SandboxVerificationWorkflowPayload,
    success: IsolatedSandboxCheckResult,
    error: SandboxVerificationWorkflowError,
    idempotencyKey: ({ attemptId }) => `sandbox-check:${attemptId}`,
  },
)

export const SandboxVerificationWorkflowLayer =
  SandboxVerificationWorkflow.toLayer(
    Effect.fn('SandboxVerificationWorkflow.execute')(function* (payload) {
      return yield* Activity.make({
        name: 'run-isolated-sandbox-check',
        success: IsolatedSandboxCheckResult,
        error: SandboxVerificationWorkflowError,
        execute: Effect.gen(function* () {
          // Mint a fresh short-lived attempt credential at execution time so
          // zero credentials are ever persisted into workflow journal payloads.
          const issuer = yield* ModelCredentialIssuer
          const modelCredential = yield* issuer.issueAttemptCredential(
            payload.attemptId,
          )
          return yield* runIsolatedCheckInSandbox({
            attemptId: payload.attemptId,
            changeRequestId: payload.changeRequestId,
            command: payload.command,
            ...(payload.commandTimeoutMs !== undefined
              ? { commandTimeoutMs: payload.commandTimeoutMs }
              : {}),
            modelCredential,
            cleanup: {
              ...(payload.cleanupTimeoutMs !== undefined
                ? { cleanupTimeoutMs: payload.cleanupTimeoutMs }
                : {}),
              ...(payload.cleanupPollIntervalMs !== undefined
                ? { cleanupPollIntervalMs: payload.cleanupPollIntervalMs }
                : {}),
            },
          })
        }),
      })
    }),
  )
