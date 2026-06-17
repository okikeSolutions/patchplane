import { createServerFn } from '@tanstack/react-start'
import { Cause, Effect, Exit, Schema } from 'effect'
import { AuthService } from '@patchplane/core/services/auth-service'
import { StorageService } from '@patchplane/core/services/storage-service'
import { publicErrorMessage, ValidationError } from '@patchplane/domain/errors'
import type {
  ServerFunctionContext,
  ServerFunctionResult,
} from '@patchplane/domain/server-function'

type ServerFnMethod = 'GET' | 'POST'
type RuntimeRequirements = AuthService | StorageService

type EffectServerFnBaseOptions<S extends Schema.Decoder<any>, A, E> = {
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
  S extends Schema.Decoder<any>,
  A,
  E,
  Success extends object,
  Failure extends object,
> = EffectServerFnBaseOptions<S, A, E> & {
  readonly success?: (value: A, context: ServerFunctionContext) => Success
  readonly failure?: (cause: unknown, context: ServerFunctionContext) => Failure
}

type EffectServerFn<
  S extends Schema.Decoder<any>,
  Success extends object,
  Failure extends object,
> = (input: {
  readonly data: S['Encoded']
  readonly headers?: HeadersInit
  readonly signal?: AbortSignal
  readonly fetch?: typeof fetch
}) => Promise<ServerFunctionResult<Success, Failure>>

export function effectServerFn<S extends Schema.Decoder<any>, A, E>(
  options: EffectServerFnBaseOptions<S, A, E>,
): EffectServerFn<S, { readonly data: A }, { readonly error: string }>
export function effectServerFn<
  S extends Schema.Decoder<any>,
  A,
  E,
  Success extends object,
>(
  options: EffectServerFnBaseOptions<S, A, E> & {
    readonly success: (value: A, context: ServerFunctionContext) => Success
  },
): EffectServerFn<S, Success, { readonly error: string }>
export function effectServerFn<
  S extends Schema.Decoder<any>,
  A,
  E,
  Failure extends object,
>(
  options: EffectServerFnBaseOptions<S, A, E> & {
    readonly failure: (cause: unknown, context: ServerFunctionContext) => Failure
  },
): EffectServerFn<S, { readonly data: A }, Failure>
export function effectServerFn<
  S extends Schema.Decoder<any>,
  A,
  E,
  Success extends object,
  Failure extends object,
>(
  options: EffectServerFnOptions<S, A, E, Success, Failure> & {
    readonly success: (value: A, context: ServerFunctionContext) => Success
    readonly failure: (cause: unknown, context: ServerFunctionContext) => Failure
  },
): EffectServerFn<S, Success, Failure>
export function effectServerFn<
  S extends Schema.Decoder<any>,
  A,
  E,
  Success extends object,
  Failure extends object,
>(
  options: EffectServerFnOptions<S, A, E, Success, Failure>,
) {
  const method = options.method ?? 'POST'
  const standardInput = Schema.toStandardSchemaV1(options.input)

  return createServerFn({ method, strict: false })
    .validator(async (input: unknown) => {
      const result = await standardInput['~standard'].validate(input)
      if ('issues' in result) {
        throw new ValidationError({
          message: 'Invalid server function input',
          cause: result.issues,
        })
      }
      return result.value
    })
    .handler(async ({ data }: { readonly data: S['Type'] }) => {
      const context: ServerFunctionContext = {
        traceId: crypto.randomUUID(),
        operation: options.operation,
      }
      const fallback = `${context.operation} failed`

      const program = Effect.suspend(() => {
        const baseEffect = options.effect(data, context)
        return options.provide === undefined
          ? baseEffect
          : options.provide(baseEffect, data, context)
      }).pipe(
        Effect.annotateLogs({
          traceId: context.traceId,
          entrypoint: context.operation,
        }),
        Effect.annotateSpans({
          traceId: context.traceId,
          entrypoint: context.operation,
        }),
        Effect.withLogSpan(context.operation),
        Effect.withSpan(context.operation, {
          attributes: { traceId: context.traceId },
        }),
        Effect.tapCause((cause) =>
          Effect.logError(`${context.operation} failed`, {
            traceId: context.traceId,
            error: publicErrorMessage(Cause.squash(cause), fallback),
            cause: Cause.pretty(cause),
          }),
        ),
      )

      if (!import.meta.env.SSR) {
        return {
          ok: false as const,
          traceId: context.traceId,
          error: 'Server functions must run on the server',
        }
      }

      const { patchPlaneRuntime } = await import('@/effect/runtime')
      const exit = await patchPlaneRuntime.runPromiseExit(program)

      if (Exit.isSuccess(exit)) {
        const successBody = options.success === undefined
          ? { data: exit.value }
          : options.success(exit.value, context)

        return {
          ok: true as const,
          ...successBody,
        }
      }

      const errorCause = Cause.squash(exit.cause)
      const failureBody = options.failure === undefined
        ? { error: publicErrorMessage(errorCause, fallback) }
        : options.failure(errorCause, context)

      return {
        ok: false as const,
        traceId: context.traceId,
        ...failureBody,
      }
    })
}
