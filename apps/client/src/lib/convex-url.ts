import { Config, Data, Effect, Option } from 'effect'

class ConvexUrlConfigError extends Data.TaggedError('ConvexUrlConfigError')<{
  readonly message: string
  readonly cause?: unknown
}> {}

const ConvexUrlEnvironment = Config.all({
  canonical: Config.option(Config.nonEmptyString('CONVEX_URL')),
  legacy: Config.option(Config.nonEmptyString('VITE_CONVEX_URL')),
})

export const loadConfiguredConvexUrl = Effect.fnUntraced(function*() {
  const environment = yield* ConvexUrlEnvironment
  const value = Option.isSome(environment.canonical)
    ? environment.canonical.value
    : Option.getOrUndefined(environment.legacy)
  if (value === undefined) {
    return yield* new ConvexUrlConfigError({
      message: 'CONVEX_URL or VITE_CONVEX_URL is required',
    })
  }
  return yield* Effect.try({
    try: () => new URL(value),
    catch: (cause) => new ConvexUrlConfigError({
      message: 'Convex URL configuration is invalid',
      cause,
    }),
  })
})
