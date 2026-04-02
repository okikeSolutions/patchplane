import { Effect } from 'effect'
import { ConvexInteropFailure } from '../errors'

export function tryConvexPromise<A>(
  operation: string,
  evaluate: () => Promise<A>,
): Effect.Effect<A, ConvexInteropFailure> {
  return Effect.tryPromise({
    try: () => evaluate(),
    catch: (cause) =>
      new ConvexInteropFailure({
        operation,
        cause,
        message: `Convex ${operation} failed.`,
      }),
  })
}
