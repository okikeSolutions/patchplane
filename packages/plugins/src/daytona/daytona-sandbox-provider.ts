import { Duration, Effect, Layer, Option, Schema } from 'effect'
import * as Redacted from 'effect/Redacted'
import {
  SANDBOX_ATTEMPT_ID_ENV,
  SANDBOX_MODEL_GATEWAY_URL_ENV,
  SANDBOX_MODEL_TOKEN_ENV,
  SandboxProvider,
  type SandboxSummary,
} from '@patchplane/core'
import {
  SandboxCleanupError,
  SandboxExecutionError,
  SandboxId,
  sanitizeErrorMessage,
} from '@patchplane/domain'

export interface DaytonaSandboxExecPort<E = unknown> {
  readonly sandboxId: string
  readonly state?: string | undefined
  readonly labels?: Readonly<Record<string, string | undefined>> | undefined
  readonly exec: (
    command: string,
    options?: { readonly timeout?: Duration.Input },
  ) => Effect.Effect<{ readonly exitCode: number; readonly result: string }, E>
}

export interface DaytonaListedSandboxPort {
  readonly id: string
  readonly state?: string | undefined
  readonly labels?: Readonly<Record<string, string | undefined>> | undefined
}

function normalizeLabels(
  raw: Readonly<Record<string, string | undefined>> | undefined,
): Readonly<Record<string, string>> {
  if (raw === undefined) return {}
  const entries: Array<readonly [string, string]> = []
  for (const [key, value] of Object.entries(raw)) {
    if (value !== undefined) {
      entries.push([key, value])
    }
  }
  return Object.fromEntries(entries)
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

const decodeSandboxId = (rawId: string, operation: string) =>
  Schema.decodeEffect(SandboxId)(rawId).pipe(
    Effect.mapError(
      (cause) =>
        new SandboxExecutionError({
          operation,
          message: sanitizeErrorMessage(cause),
          cause,
        }),
    ),
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
              autoDeleteInterval: autoDeleteIntervalMinutes ?? 30,
            })
            .pipe(
              Effect.mapError(
                (cause) =>
                  new SandboxExecutionError({
                    operation: 'DaytonaSandboxProvider.createSandbox',
                    message: sanitizeErrorMessage(cause),
                    cause,
                  }),
              ),
            )

          const sandboxId = yield* decodeSandboxId(
            created.sandboxId,
            'DaytonaSandboxProvider.createSandbox',
          )

          return {
            sandboxId,
            state: created.state ?? 'started',
            labels:
              created.labels !== undefined
                ? normalizeLabels(created.labels)
                : labels,
          } satisfies SandboxSummary
        },
      ),

      execCommand: Effect.fn('DaytonaSandboxProvider.execCommand')(function* ({
        sandboxId,
        command,
        timeoutMs,
      }) {
        const handle = yield* client.get(sandboxId).pipe(
          Effect.mapError(
            (cause) =>
              new SandboxExecutionError({
                operation: 'DaytonaSandboxProvider.execCommand',
                message: sanitizeErrorMessage(cause),
                sandboxId,
                cause,
              }),
          ),
        )

        if (handle === undefined) {
          return yield* new SandboxExecutionError({
            operation: 'DaytonaSandboxProvider.execCommand',
            message: `Sandbox ${sandboxId} not found`,
            sandboxId,
          })
        }

        const result = yield* handle
          .exec(
            command,
            timeoutMs !== undefined
              ? { timeout: Duration.millis(timeoutMs) }
              : undefined,
          )
          .pipe(
            Effect.mapError(
              (cause) =>
                new SandboxExecutionError({
                  operation: 'DaytonaSandboxProvider.execCommand',
                  message: sanitizeErrorMessage(cause),
                  sandboxId,
                  cause,
                }),
            ),
          )

        return {
          exitCode: result.exitCode,
          output: result.result,
        }
      }),

      getSandbox: Effect.fn('DaytonaSandboxProvider.getSandbox')(
        function* (sandboxId) {
          const handle = yield* client.get(sandboxId).pipe(
            Effect.mapError(
              (cause) =>
                new SandboxExecutionError({
                  operation: 'DaytonaSandboxProvider.getSandbox',
                  message: sanitizeErrorMessage(cause),
                  sandboxId,
                  cause,
                }),
            ),
          )

          if (handle === undefined) {
            return Option.none()
          }

          const verifiedId = yield* decodeSandboxId(
            handle.sandboxId,
            'DaytonaSandboxProvider.getSandbox',
          )
          return Option.some({
            sandboxId: verifiedId,
            state: handle.state ?? 'started',
            labels: normalizeLabels(handle.labels),
          } satisfies SandboxSummary)
        },
      ),

      listSandboxesByLabels: Effect.fn(
        'DaytonaSandboxProvider.listSandboxesByLabels',
      )(function* (labels) {
        const items = yield* client.list({ labels: { ...labels } }).pipe(
          Effect.mapError(
            (cause) =>
              new SandboxExecutionError({
                operation: 'DaytonaSandboxProvider.listSandboxesByLabels',
                message: sanitizeErrorMessage(cause),
                cause,
              }),
          ),
        )

        return yield* Effect.forEach(items, (item) =>
          Effect.gen(function* () {
            const sandboxId = yield* decodeSandboxId(
              item.id,
              'DaytonaSandboxProvider.listSandboxesByLabels',
            )
            return {
              sandboxId,
              state: item.state ?? 'unknown',
              labels: normalizeLabels(item.labels),
            } satisfies SandboxSummary
          }),
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
                  cause,
                }),
            ),
          )
        },
      ),
    }),
  )
