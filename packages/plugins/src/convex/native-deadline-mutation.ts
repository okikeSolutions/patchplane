import { ConvexHttpClient } from 'convex/browser'
import type {
  FunctionArgs,
  FunctionReference,
  FunctionReturnType,
} from 'convex/server'
import { Effect } from 'effect'
import {
  combineAbortSignals,
  fetchWithSignal,
} from '../http/sdk-fetch-boundary'
import { settleConvexMutation } from './storage/bounded-native-promise'

export function convexMutationWithNativeDeadline<
  Reference extends FunctionReference<'mutation'>,
  Error,
>(input: {
  readonly url: string
  readonly auth?: string | undefined
  readonly reference: Reference
  readonly args: FunctionArgs<Reference>
  readonly operationName: string
  readonly timeoutMilliseconds?: number | undefined
  readonly catch: (cause: unknown) => Error
}): Effect.Effect<FunctionReturnType<Reference>, Error> {
  return Effect.tryPromise({
    try: (effectSignal) =>
      settleConvexMutation({
        operation: (deadlineSignal) =>
          new ConvexHttpClient(input.url, {
            fetch: fetchWithSignal(
              combineAbortSignals([effectSignal, deadlineSignal]),
            ),
            ...(input.auth === undefined ? {} : { auth: input.auth }),
          }).mutation(input.reference, input.args),
        operationName: input.operationName,
        timeoutMilliseconds: input.timeoutMilliseconds,
      }),
    catch: (cause) => input.catch(cause),
  })
}
