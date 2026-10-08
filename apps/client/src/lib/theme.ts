import { createServerFn } from '@tanstack/react-start'
import { getCookie, setCookie } from '@tanstack/react-start/server'
import { Config, Effect, Schema } from 'effect'

const Theme = Schema.Literals(['light', 'dark', 'system'])
export type T = Schema.Schema.Type<typeof Theme>
const decodeTheme = Schema.decodeUnknownSync(Theme)
const storageKey = '_preferred-theme'

function decodeThemeOrDefault(value: unknown): T {
  try {
    return decodeTheme(value)
  } catch {
    return 'dark'
  }
}

export const getThemeServerFn = createServerFn().handler(() =>
  Effect.runPromise(
    Effect.sync(() => decodeThemeOrDefault(getCookie(storageKey))),
  ),
)

export const setThemeServerFn = createServerFn({ method: 'POST' })
  .validator(decodeTheme)
  .handler(({ data }) =>
    Effect.runPromise(
      Config.String('NODE_ENV').pipe(
        Config.withDefault('development'),
        Config.map((environment) => environment === 'production'),
        Effect.flatMap((secure) =>
          Effect.sync(() =>
            setCookie(storageKey, data, {
              httpOnly: true,
              secure,
              sameSite: 'lax',
              path: '/',
              maxAge: 60 * 60 * 24 * 365,
            }),
          ),
        ),
      ),
    ),
  )
