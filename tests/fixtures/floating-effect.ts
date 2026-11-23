import { Effect } from 'effect'

export const discardedEffectFixture = () => {
  Effect.succeed('discarded')
}
