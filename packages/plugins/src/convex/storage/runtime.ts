import { Effect, Option, Redacted } from 'effect'
import { convexMutation, convexQuery } from '../http-client'
import { StorageError } from '@patchplane/domain/errors'
import { decodeEvidenceArtifact } from '@patchplane/domain/evidence-artifact'
import { decodeRuntimeEvents } from '@patchplane/domain/runtime-event'
import { decodeRuntimeSession } from '@patchplane/domain/runtime-session'
import { decodeSandboxExecution } from '@patchplane/domain/sandbox-execution'
import {
  type GetActiveRuntimeSessionInput,
  type MarkRuntimeSessionStatusInput,
  type GetEvidenceArtifactInput,
  type RecordEvidenceArtifactInput,
  type RecordRuntimeEventInput,
  type RecordRuntimeSessionStartedInput,
  type RecordSandboxExecutionInput,
} from '@patchplane/core/services/storage-service'
import {
  settleWithin,
  recordRuntimeEventsMutation,
  recordRuntimeSessionStartedMutation,
  markRuntimeSessionStatusMutation,
  getActiveRuntimeSessionQuery,
  recordSandboxExecutionMutation,
  recordEvidenceArtifactMutation,
  getEvidenceArtifactQuery,
} from './shared'

export interface ConvexStorageContext {
  readonly convexUrl: string
  readonly systemIngestionSecret:
    | import('effect').Redacted.Redacted<string>
    | undefined
}

export function makeRuntimeStorageOperations(context: ConvexStorageContext) {
  const { convexUrl, systemIngestionSecret } = context

  const recordRuntimeEvents = Effect.fn(
    '@patchplane/plugins/convex/recordRuntimeEvents',
  )(function* (input: ReadonlyArray<RecordRuntimeEventInput>) {
    if (input.length === 0) {
      return []
    }
    if (systemIngestionSecret === undefined) {
      return yield* new StorageError({
        operation: 'recordRuntimeEvents.config',
        message:
          'PATCHPLANE_SYSTEM_INGESTION_SECRET is required to record runtime events',
        cause: undefined,
      })
    }

    const value = yield* convexMutation({
      url: convexUrl,
      reference: recordRuntimeEventsMutation,
      args: {
        systemSecret: Redacted.value(systemIngestionSecret),
        events: input.map((event) => ({
          workflowRunId: event.workflowRunId,
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
        })),
      },
      catch: (cause) =>
        new StorageError({
          operation: 'recordRuntimeEvents',
          message: 'Convex failed to record runtime events',
          cause,
        }),
    })

    return yield* decodeRuntimeEvents(value).pipe(
      Effect.mapError(
        (cause) =>
          new StorageError({
            operation: 'recordRuntimeEvents.decode',
            message: 'Convex returned invalid runtime events',
            cause,
          }),
      ),
    )
  })

  const recordRuntimeSessionStarted = Effect.fn(
    '@patchplane/plugins/convex/recordRuntimeSessionStarted',
  )(function* (input: RecordRuntimeSessionStartedInput) {
    if (systemIngestionSecret === undefined) {
      return yield* new StorageError({
        operation: 'recordRuntimeSessionStarted.config',
        message:
          'PATCHPLANE_SYSTEM_INGESTION_SECRET is required to record runtime sessions',
        cause: undefined,
      })
    }
    const value = yield* convexMutation({
      url: convexUrl,
      reference: recordRuntimeSessionStartedMutation,
      args: {
        systemSecret: Redacted.value(systemIngestionSecret),
        workflowRunId: input.workflowRunId,
        provider: input.provider,
        sandboxId: input.sandboxId,
        sessionId: input.sessionId,
        commandId: input.commandId,
        startedAt: input.startedAt,
      },
      catch: (cause) =>
        new StorageError({
          operation: 'recordRuntimeSessionStarted',
          message: 'Convex failed to record runtime session',
          cause,
        }),
    })
    return yield* decodeRuntimeSession(value).pipe(
      Effect.mapError(
        (cause) =>
          new StorageError({
            operation: 'recordRuntimeSessionStarted.decode',
            message: 'Convex returned invalid runtime session',
            cause,
          }),
      ),
    )
  })

  const markRuntimeSessionStatus = Effect.fn(
    '@patchplane/plugins/convex/markRuntimeSessionStatus',
  )(function* (input: MarkRuntimeSessionStatusInput) {
    if (systemIngestionSecret === undefined) {
      return yield* new StorageError({
        operation: 'markRuntimeSessionStatus.config',
        message:
          'PATCHPLANE_SYSTEM_INGESTION_SECRET is required to update runtime sessions',
        cause: undefined,
      })
    }
    const value = yield* convexMutation({
      url: convexUrl,
      reference: markRuntimeSessionStatusMutation,
      args: {
        systemSecret: Redacted.value(systemIngestionSecret),
        runtimeSessionId: input.runtimeSessionId,
        status: input.status,
        ...(input.completedAt === undefined
          ? {}
          : { completedAt: input.completedAt }),
      },
      catch: (cause) =>
        new StorageError({
          operation: 'markRuntimeSessionStatus',
          message: 'Convex failed to update runtime session',
          cause,
        }),
    })
    return yield* decodeRuntimeSession(value).pipe(
      Effect.mapError(
        (cause) =>
          new StorageError({
            operation: 'markRuntimeSessionStatus.decode',
            message: 'Convex returned invalid runtime session',
            cause,
          }),
      ),
    )
  })

  const getActiveRuntimeSession = Effect.fn(
    '@patchplane/plugins/convex/getActiveRuntimeSession',
  )(function* (input: GetActiveRuntimeSessionInput) {
    if (systemIngestionSecret === undefined) {
      return yield* new StorageError({
        operation: 'getActiveRuntimeSession.config',
        message:
          'PATCHPLANE_SYSTEM_INGESTION_SECRET is required to read runtime sessions',
        cause: undefined,
      })
    }
    const value = yield* convexQuery({
      url: convexUrl,
      reference: getActiveRuntimeSessionQuery,
      args: {
        systemSecret: Redacted.value(systemIngestionSecret),
        workflowRunId: input.workflowRunId,
      },
      catch: (cause) =>
        new StorageError({
          operation: 'getActiveRuntimeSession',
          message: 'Convex failed to read runtime session',
          cause,
        }),
    })
    if (value === null) return Option.none()
    const session = yield* decodeRuntimeSession(value).pipe(
      Effect.mapError(
        (cause) =>
          new StorageError({
            operation: 'getActiveRuntimeSession.decode',
            message: 'Convex returned invalid runtime session',
            cause,
          }),
      ),
    )
    return Option.some(session)
  })

  const recordSandboxExecution = Effect.fn(
    '@patchplane/plugins/convex/recordSandboxExecution',
  )(function* (input: RecordSandboxExecutionInput) {
    if (systemIngestionSecret === undefined) {
      return yield* new StorageError({
        operation: 'recordSandboxExecution.config',
        message:
          'PATCHPLANE_SYSTEM_INGESTION_SECRET is required to record sandbox executions',
        cause: undefined,
      })
    }

    const value = yield* settleWithin({
      operationEffect: convexMutation({
        url: convexUrl,
        reference: recordSandboxExecutionMutation,
        args: {
          systemSecret: Redacted.value(systemIngestionSecret),
          workflowRunId: input.workflowRunId,
          ...(input.incomingDispatchToken === undefined
            ? {}
            : { incomingDispatchToken: input.incomingDispatchToken }),
          ...(input.executionGroupId === undefined
            ? {}
            : { executionGroupId: input.executionGroupId }),
          ...(input.executionGroupClaimToken === undefined
            ? {}
            : {
                executionGroupClaimToken: input.executionGroupClaimToken,
              }),
          ...(input.idempotencyKey === undefined
            ? {}
            : { idempotencyKey: input.idempotencyKey }),
          provider: input.provider,
          sandboxId: input.sandboxId,
          ...(input.providerSessionId === undefined
            ? {}
            : { providerSessionId: input.providerSessionId }),
          ...(input.providerCommandId === undefined
            ? {}
            : { providerCommandId: input.providerCommandId }),
          command: input.command,
          status: input.status,
          ...(input.exitCode === undefined ? {} : { exitCode: input.exitCode }),
          stdout: input.stdout,
          ...(input.stderr === undefined ? {} : { stderr: input.stderr }),
          ...(input.policy === undefined ? {} : { policy: input.policy }),
          startedAt: input.startedAt,
          completedAt: input.completedAt,
        },
        catch: (cause) =>
          new StorageError({
            operation: 'recordSandboxExecution',
            message: 'Convex failed to record sandbox execution',
            cause,
          }),
      }),
      timeoutMs: 15_000,
      operation: 'recordSandboxExecution',
      message: 'Convex failed to record sandbox execution',
    })

    return yield* decodeSandboxExecution(value).pipe(
      Effect.mapError(
        (cause) =>
          new StorageError({
            operation: 'recordSandboxExecution.decode',
            message: 'Convex returned an invalid sandbox execution',
            cause,
          }),
      ),
    )
  })

  const recordEvidenceArtifact = Effect.fn(
    '@patchplane/plugins/convex/recordEvidenceArtifact',
  )(function* (input: RecordEvidenceArtifactInput) {
    if (systemIngestionSecret === undefined) {
      return yield* new StorageError({
        operation: 'recordEvidenceArtifact.config',
        message:
          'PATCHPLANE_SYSTEM_INGESTION_SECRET is required to record evidence artifacts',
        cause: undefined,
      })
    }
    const value = yield* convexMutation({
      url: convexUrl,
      reference: recordEvidenceArtifactMutation,
      args: {
        systemSecret: Redacted.value(systemIngestionSecret),
        workflowRunId: input.workflowRunId,
        ...(input.producer === undefined ? {} : { producer: input.producer }),
        ...(input.subjectDigest === undefined
          ? {}
          : { subjectDigest: input.subjectDigest }),
        ...(input.traceId === undefined ? {} : { traceId: input.traceId }),
        kind: input.kind,
        ...(input.label === undefined ? {} : { label: input.label }),
        storageProvider: input.storageProvider,
        storageKey: input.storageKey,
        contentType: input.contentType,
        sizeBytes: input.sizeBytes,
        sha256: input.sha256,
        ...(input.retentionPolicy === undefined
          ? {}
          : { retentionPolicy: input.retentionPolicy }),
        ...(input.createdAt === undefined
          ? {}
          : { createdAt: input.createdAt }),
      },
      catch: (cause) =>
        new StorageError({
          operation: 'recordEvidenceArtifact',
          message: 'Convex failed to record evidence artifact',
          cause,
        }),
    })
    return yield* decodeEvidenceArtifact(value).pipe(
      Effect.mapError(
        (cause) =>
          new StorageError({
            operation: 'recordEvidenceArtifact.decode',
            message: 'Convex returned invalid evidence artifact',
            cause,
          }),
      ),
    )
  })

  const getEvidenceArtifact = Effect.fn(
    '@patchplane/plugins/convex/getEvidenceArtifact',
  )(function* (input: GetEvidenceArtifactInput) {
    if (input.authToken === undefined && systemIngestionSecret === undefined) {
      return yield* new StorageError({
        operation: 'getEvidenceArtifact.config',
        message:
          'authToken or PATCHPLANE_SYSTEM_INGESTION_SECRET is required to read evidence artifacts',
        cause: undefined,
      })
    }
    const value = yield* convexQuery({
      url: convexUrl,
      ...(input.authToken === undefined ? {} : { auth: input.authToken }),
      reference: getEvidenceArtifactQuery,
      args: {
        artifactId: input.artifactId,
        ...(input.workflowRunId === undefined
          ? {}
          : { workflowRunId: input.workflowRunId }),
        ...(input.authToken !== undefined || systemIngestionSecret === undefined
          ? {}
          : { systemSecret: Redacted.value(systemIngestionSecret) }),
      },
      catch: (cause) =>
        new StorageError({
          operation: 'getEvidenceArtifact',
          message: 'Convex failed to read evidence artifact',
          cause,
        }),
    })
    if (value === null) return Option.none()
    const artifact = yield* decodeEvidenceArtifact(value).pipe(
      Effect.mapError(
        (cause) =>
          new StorageError({
            operation: 'getEvidenceArtifact.decode',
            message: 'Convex returned invalid evidence artifact',
            cause,
          }),
      ),
    )
    return Option.some(artifact)
  })

  return {
    recordRuntimeEvents,
    recordRuntimeSessionStarted,
    markRuntimeSessionStatus,
    getActiveRuntimeSession,
    recordSandboxExecution,
    recordEvidenceArtifact,
    getEvidenceArtifact,
  }
}
