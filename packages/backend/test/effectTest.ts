import { Effect, TestContext } from 'effect'

export function runEffectTest<A, E>(effect: Effect.Effect<A, E, never>) {
  return Effect.runPromise(effect.pipe(Effect.provide(TestContext.TestContext)))
}
