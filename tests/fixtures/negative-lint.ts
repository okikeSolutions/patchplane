import { Effect } from 'effect'

export async function negativeLintFixture() {
  Promise.resolve('floating-promise')
  Effect.succeed('floating-effect')
  const raw = new Promise<string>((resolve) => resolve('raw'))
  const bridged = Effect.tryPromise({
    try: () => raw,
    catch: () => new Error('failed'),
  })
  return await Effect.runPromise(bridged)
}
