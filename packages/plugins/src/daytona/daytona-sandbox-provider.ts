import { Duration, Effect, Layer, Option, Schema } from 'effect'
import * as Redacted from 'effect/Redacted'
import {
  SANDBOX_ATTEMPT_ID_ENV,
  SANDBOX_MODEL_GATEWAY_URL_ENV,
  SANDBOX_MODEL_TOKEN_ENV,
  SandboxProvider,
} from '@patchplane/core'
import {
  SandboxCleanupError,
  SandboxExecOutput,
  SandboxExecutionError,
  type SandboxId,
  SandboxSummary,
  sanitizeErrorMessage,
} from '@patchplane/domain'

const MIN_AUTO_DELETE_MINUTES = 1
const MAX_AUTO_DELETE_MINUTES = 60

export interface DaytonaSandboxExecPort<E = unknown> {
  readonly sandboxId: string
  readonly state?: string | undefined
  readonly labels?: Readonly<Record<string, string | undefined>> | undefined
  readonly exec: (
    command: string,
    options?: { readonly timeout?: Duration.Input },
  ) => Effect.Effect<{ readonly exitCode: number; readonly result: string }, E>
  readonly readFile?: (path: string) => Effect.Effect<Uint8Array, E>
}

export interface DaytonaListedSandboxPort {
  readonly id: string
  readonly state?: string | undefined
  readonly labels?: Readonly<Record<string, string | undefined>> | undefined
}

export interface DaytonaCreateSandboxPort<
  ECreate = unknown,
  EGet = unknown,
  EList = unknown,
  EDelete = unknown,
  EExec = unknown,
> {
  readonly create: (input?: {
    readonly labels?: Record<string, string>
    readonly env?: Record<string, string | undefined>
    readonly public?: boolean
    readonly autoDeleteInterval?: number
  }) => Effect.Effect<DaytonaSandboxExecPort<EExec>, ECreate>

  readonly get: (
    idOrName: string,
  ) => Effect.Effect<DaytonaSandboxExecPort<EExec> | undefined, EGet>

  readonly list: (input?: {
    readonly labels?: Record<string, string>
  }) => Effect.Effect<ReadonlyArray<DaytonaListedSandboxPort>, EList>

  readonly delete: (idOrName: string) => Effect.Effect<void, EDelete>
}

function normalizeLabels(
  raw: Readonly<Record<string, string | undefined>> | undefined,
): Record<string, string> {
  if (raw === undefined) return {}
  const entries: Array<readonly [string, string]> = []
  for (const [key, value] of Object.entries(raw)) {
    if (value !== undefined) {
      entries.push([key, value])
    }
  }
  return Object.fromEntries(entries)
}

function clampAutoDeleteInterval(minutes: number | undefined): number {
  if (minutes === undefined || !Number.isFinite(minutes)) return 30
  return Math.min(
    MAX_AUTO_DELETE_MINUTES,
    Math.max(MIN_AUTO_DELETE_MINUTES, Math.trunc(minutes)),
  )
}

/**
 * Maps Daytona SDK failures to `SandboxExecutionError` using only sanitized
 * messages (dropping raw SDK error objects that may reference request env maps).
 */
const sandboxExecutionError = (operation: string, sandboxId?: SandboxId) =>
  Effect.mapError(
    (cause: unknown) =>
      new SandboxExecutionError({
        operation,
        message: sanitizeErrorMessage(cause),
        ...(sandboxId !== undefined ? { sandboxId } : {}),
      }),
  )

const decodeSandboxSummary = (
  raw: {
    readonly sandboxId: unknown
    readonly state: unknown
    readonly labels: unknown
  },
  operation: string,
) =>
  Schema.decodeUnknownEffect(SandboxSummary)(raw).pipe(
    sandboxExecutionError(operation),
  )

const decodeExecOutput = (
  raw: { readonly exitCode: unknown; readonly output: unknown },
  operation: string,
  sandboxId: SandboxId,
) =>
  Schema.decodeUnknownEffect(SandboxExecOutput)(raw).pipe(
    sandboxExecutionError(operation, sandboxId),
  )

export const makeDaytonaSandboxProviderLayer = <
  ECreate,
  EGet,
  EList,
  EDelete,
  EExec,
>(
  client: DaytonaCreateSandboxPort<ECreate, EGet, EList, EDelete, EExec>,
) =>
  Layer.succeed(
    SandboxProvider,
    SandboxProvider.of({
      createSandbox: Effect.fn('DaytonaSandboxProvider.createSandbox')(
        function* ({ labels, env, autoDeleteIntervalMinutes }) {
          const operation = 'DaytonaSandboxProvider.createSandbox'
          // Unwrap the short-lived attempt-scoped model token only at the
          // Daytona createSandbox boundary after core policy validation.
          const envMap: Record<string, string> = {
            [SANDBOX_ATTEMPT_ID_ENV]: env.attemptId,
            [SANDBOX_MODEL_TOKEN_ENV]: Redacted.value(env.modelToken),
            ...(env.gatewayUrl !== undefined
              ? { [SANDBOX_MODEL_GATEWAY_URL_ENV]: env.gatewayUrl }
              : {}),
          }

          const created = yield* client
            .create({
              labels: { ...labels },
              env: envMap,
              public: false,
              autoDeleteInterval: clampAutoDeleteInterval(
                autoDeleteIntervalMinutes,
              ),
            })
            .pipe(sandboxExecutionError(operation))

          return yield* decodeSandboxSummary(
            {
              sandboxId: created.sandboxId,
              state: created.state ?? 'started',
              labels:
                created.labels !== undefined
                  ? normalizeLabels(created.labels)
                  : labels,
            },
            operation,
          )
        },
      ),

      execCommand: Effect.fn('DaytonaSandboxProvider.execCommand')(function* ({
        sandboxId,
        command,
        timeoutMs,
      }) {
        const operation = 'DaytonaSandboxProvider.execCommand'
        const handle = yield* client
          .get(sandboxId)
          .pipe(sandboxExecutionError(operation, sandboxId))

        if (handle === undefined) {
          return yield* new SandboxExecutionError({
            operation,
            message: `Sandbox ${sandboxId} not found`,
            sandboxId,
          })
        }

        const result = yield* handle
          .exec(command, { timeout: Duration.millis(timeoutMs) })
          .pipe(sandboxExecutionError(operation, sandboxId))

        return yield* decodeExecOutput(
          {
            exitCode: result.exitCode,
            output: result.result,
          },
          operation,
          sandboxId,
        )
      }),

      readFileBytes: Effect.fn('DaytonaSandboxProvider.readFileBytes')(
        function* ({ sandboxId, path, maxBytes }) {
          const operation = 'DaytonaSandboxProvider.readFileBytes'
          const handle = yield* client
            .get(sandboxId)
            .pipe(sandboxExecutionError(operation, sandboxId))

          if (handle === undefined) {
            return yield* new SandboxExecutionError({
              operation,
              message: `Sandbox ${sandboxId} not found`,
              sandboxId,
            })
          }
          if (handle.readFile === undefined) {
            return yield* new SandboxExecutionError({
              operation,
              message: `Sandbox ${sandboxId} handle does not expose file reads`,
              sandboxId,
            })
          }

          const bytes = yield* handle
            .readFile(path)
            .pipe(sandboxExecutionError(operation, sandboxId))

          if (bytes.byteLength > maxBytes) {
            return yield* new SandboxExecutionError({
              operation,
              message: `File "${path}" (${bytes.byteLength} bytes) exceeds max allowed size (${maxBytes} bytes)`,
              sandboxId,
            })
          }
          return bytes
        },
      ),

      getSandbox: Effect.fn('DaytonaSandboxProvider.getSandbox')(
        function* (sandboxId) {
          const operation = 'DaytonaSandboxProvider.getSandbox'
          const handle = yield* client
            .get(sandboxId)
            .pipe(sandboxExecutionError(operation, sandboxId))

          if (handle === undefined) {
            return Option.none()
          }

          const decoded = yield* decodeSandboxSummary(
            {
              sandboxId: handle.sandboxId,
              state: handle.state ?? 'started',
              labels: normalizeLabels(handle.labels),
            },
            operation,
          )
          return Option.some(decoded)
        },
      ),

      listSandboxesByLabels: Effect.fn(
        'DaytonaSandboxProvider.listSandboxesByLabels',
      )(function* (labels) {
        const operation = 'DaytonaSandboxProvider.listSandboxesByLabels'
        const items = yield* client
          .list({ labels: { ...labels } })
          .pipe(sandboxExecutionError(operation))

        return yield* Effect.forEach(items, (item) =>
          decodeSandboxSummary(
            {
              sandboxId: item.id,
              state: item.state ?? 'unknown',
              labels: normalizeLabels(item.labels),
            },
            operation,
          ),
        )
      }),

      deleteSandbox: Effect.fn('DaytonaSandboxProvider.deleteSandbox')(
        function* ({ sandboxId, attemptId }) {
          yield* client.delete(sandboxId).pipe(
            Effect.mapError(
              (cause) =>
                new SandboxCleanupError({
                  sandboxId,
                  attemptId,
                  reason: `Daytona delete failed: ${sanitizeErrorMessage(cause)}`,
                  timedOut: false,
                }),
            ),
          )
        },
      ),
    }),
  )
