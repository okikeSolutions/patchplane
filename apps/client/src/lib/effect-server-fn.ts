import { createServerOnlyFn } from '@tanstack/react-start'
import { Cause, Effect, Exit, Schema } from 'effect'
import type { AuthService } from '@patchplane/core/services/auth-service'
import type { StorageService } from '@patchplane/core/services/storage-service'
import type { TelemetryService } from '@patchplane/core/services/telemetry-service'
import { ValidationError } from '@patchplane/domain/errors'
import type {
  ServerFunctionContext,
  ServerFunctionResult,
} from '@patchplane/domain/server-function'

type ServerFnMethod = 'GET' | 'POST'
type RuntimeRequirements = AuthService | StorageService | TelemetryService

class ServerFunctionRuntimeError extends Schema.TaggedError<ServerFunctionRuntimeError>()(
  'ServerFunctionRuntimeError',
  {
    operation: Schema.String,
    message: Schema.String,
    cause: Schema.Defect(),
  },
) {}

const loadServerFunctionModules = createServerOnlyFn(
  Effect.fnUntraced(function* () {
    const [telemetryModule, errorsModule, runtimeModule] = yield* Effect.all([
      Effect.tryPromise({
        try: () => import('@patchplane/core/services/telemetry-service'),
        catch: (cause) =>
          new ServerFunctionRuntimeError({
            operation: 'server-function.telemetry-module',
            message: 'Could not load telemetry module',
            cause,
          }),
      }),
      Effect.tryPromise({
        try: () => import('@patchplane/domain/errors'),
        catch: (cause) =>
          new ServerFunctionRuntimeError({
            operation: 'server-function.error-module',
            message: 'Could not load error module',
            cause,
          }),
      }),
      Effect.tryPromise({
        try: () => import('@/effect/runtime'),
        catch: (cause) =>
          new ServerFunctionRuntimeError({
            operation: 'server-function.runtime-module',
            message: 'Could not load runtime module',
            cause,
          }),
      }),
    ])
    return { telemetryModule, errorsModule, runtimeModule }
  }),
)

type EffectServerFnBaseOptions<
  S extends Schema.ConstraintDecoder<unknown>,
  A,
  E,
> = {
  readonly method?: ServerFnMethod
  readonly input: S
  readonly operation: string
  readonly effect: (
    data: S['Type'],
    context: ServerFunctionContext,
  ) => Effect.Effect<A, E, RuntimeRequirements>
  readonly provide?: (
    effect: Effect.Effect<A, E, RuntimeRequirements>,
    data: S['Type'],
    context: ServerFunctionContext,
  ) => Effect.Effect<A, E, RuntimeRequirements>
}

type EffectServerFnOptions<
  S extends Schema.ConstraintDecoder<unknown>,
  A,
  E,
  Success extends object,
  Failure extends object,
> = EffectServerFnBaseOptions<S, A, E> & {
  readonly success?: (value: A, context: ServerFunctionContext) => Success
  readonly failure?: (cause: unknown, context: ServerFunctionContext) => Failure
}

export interface EffectServerFnHandlers<
  S extends Schema.ConstraintDecoder<unknown>,
  Success extends object,
  Failure extends object,
> {
  readonly validator: (input: unknown) => Promise<S['Type']>
  readonly handler: (input: {
    readonly data: S['Type']
  }) => Promise<ServerFunctionResult<Success, Failure>>
}

export function effectServerFnHandlers<
  S extends Schema.ConstraintDecoder<unknown>,
  A,
  E,
>(
  options: EffectServerFnBaseOptions<S, A, E>,
): EffectServerFnHandlers<S, { readonly data: A }, { readonly error: string }>
export function effectServerFnHandlers<
  S extends Schema.ConstraintDecoder<unknown>,
  A,
  E,
  Success extends object,
>(
  options: EffectServerFnBaseOptions<S, A, E> & {
    readonly success: (value: A, context: ServerFunctionContext) => Success
  },
): EffectServerFnHandlers<S, Success, { readonly error: string }>
export function effectServerFnHandlers<
  S extends Schema.ConstraintDecoder<unknown>,
  A,
  E,
  Failure extends object,
>(
  options: EffectServerFnBaseOptions<S, A, E> & {
    readonly failure: (
      cause: unknown,
      context: ServerFunctionContext,
    ) => Failure
  },
): EffectServerFnHandlers<S, { readonly data: A }, Failure>
export function effectServerFnHandlers<
  S extends Schema.ConstraintDecoder<unknown>,
  A,
  E,
  Success extends object,
  Failure extends object,
>(
  options: EffectServerFnOptions<S, A, E, Success, Failure> & {
    readonly success: (value: A, context: ServerFunctionContext) => Success
    readonly failure: (
      cause: unknown,
      context: ServerFunctionContext,
    ) => Failure
  },
): EffectServerFnHandlers<S, Success, Failure>
export function effectServerFnHandlers<
  S extends Schema.ConstraintDecoder<unknown>,
  A,
  E,
  Success extends object,
  Failure extends object,
>(options: EffectServerFnOptions<S, A, E, Success, Failure>) {
  const runServerFunction = Effect.fn('EffectServerFn.run')(function* (
    data: S['Type'],
  ) {
    const { telemetryModule, errorsModule, runtimeModule } =
      yield* loadServerFunctionModules()
    const {
      captureTelemetryCause,
      withCriticalPathBreadcrumbScope,
      withTelemetrySpan,
    } = telemetryModule
    const { publicErrorMessage } = errorsModule
    const { patchPlaneRuntime } = runtimeModule
    const traceId = globalThis.crypto.randomUUID()
    const context: ServerFunctionContext = {
      traceId,
      operation: options.operation,
    }
    const fallback = `${context.operation} failed`

    const program = Effect.suspend(() => {
      const baseEffect = options.effect(data, context)
      return options.provide === undefined
        ? baseEffect
        : options.provide(baseEffect, data, context)
    }).pipe(
      (effect) =>
        withTelemetrySpan(
          {
            traceId: context.traceId,
            operation: context.operation,
            name: context.operation,
          },
          effect,
        ),
      Effect.withLogSpan(context.operation),
      Effect.tapCause((cause) =>
        Effect.all(
          [
            Effect.logError(`${context.operation} failed`, {
              traceId: context.traceId,
              error: publicErrorMessage(Cause.squash(cause), fallback),
              cause: Cause.pretty(cause),
            }),
            captureTelemetryCause({
              traceId: context.traceId,
              operation: context.operation,
              cause,
              message: `${context.operation} failed`,
            }),
          ],
          { concurrency: 'unbounded', discard: true },
        ),
      ),
      withCriticalPathBreadcrumbScope,
    )

    const exit = yield* Effect.tryPromise({
      try: () => patchPlaneRuntime.runPromiseExit(program),
      catch: (cause) =>
        new ServerFunctionRuntimeError({
          operation: 'server-function.runtime',
          message: 'Could not run server function',
          cause,
        }),
    })

    if (Exit.isSuccess(exit)) {
      const successBody =
        options.success === undefined
          ? { data: exit.value }
          : options.success(exit.value, context)
      return { ok: true as const, ...successBody }
    }

    const errorCause = Cause.squash(exit.cause)
    const failureBody =
      options.failure === undefined
        ? { error: publicErrorMessage(errorCause, fallback) }
        : options.failure(errorCause, context)
    return { ok: false as const, traceId: context.traceId, ...failureBody }
  })

  return {
    validator: (input: unknown) =>
      Effect.runPromise(
        Schema.decodeUnknownEffect(options.input)(input).pipe(
          Effect.mapError(
            (cause) =>
              new ValidationError({
                message: 'Invalid server function input',
                cause,
              }),
          ),
        ),
      ),
    handler: ({ data }: { readonly data: S['Type'] }) => {
      if (!import.meta.env.SSR) {
        return Promise.resolve({
          ok: false as const,
          traceId: globalThis.crypto?.randomUUID?.() ?? 'client',
          error: 'Server functions must run on the server',
        })
      }
      return Effect.runPromise(runServerFunction(data))
    },
  }
}
