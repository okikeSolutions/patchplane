import { ConvexHttpClient } from 'convex/browser'
import type {
  FunctionArgs,
  FunctionReference,
  FunctionReturnType,
} from 'convex/server'
import { Effect } from 'effect'
import { fetchWithSignal } from '../http/sdk-fetch-boundary'

interface ConvexOperationInput<
  Reference extends FunctionReference<'query' | 'mutation'>,
  Error,
> {
  readonly url: string
  readonly auth?: string | undefined
  readonly reference: Reference
  readonly args: FunctionArgs<Reference>
  readonly catch: (cause: unknown) => Error
}

function makeClient(input: {
  readonly url: string
  readonly signal: AbortSignal
  readonly auth?: string | undefined
}) {
  return new ConvexHttpClient(input.url, {
    fetch: fetchWithSignal(input.signal),
    ...(input.auth === undefined ? {} : { auth: input.auth }),
  })
}

export function convexQuery<
  Reference extends FunctionReference<'query'>,
  Error,
>(
  input: ConvexOperationInput<Reference, Error>,
): Effect.Effect<FunctionReturnType<Reference>, Error> {
  return Effect.tryPromise({
    try: (signal) =>
      makeClient({ ...input, signal }).query(input.reference, input.args),
    catch: (cause) => input.catch(cause),
  })
}

export function convexMutation<
  Reference extends FunctionReference<'mutation'>,
  Error,
>(
  input: ConvexOperationInput<Reference, Error>,
): Effect.Effect<FunctionReturnType<Reference>, Error> {
  return Effect.tryPromise({
    try: (signal) =>
      makeClient({ ...input, signal }).mutation(input.reference, input.args),
    catch: (cause) => input.catch(cause),
  })
}
