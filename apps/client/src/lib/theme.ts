import { createServerFn } from '@tanstack/react-start'
import { getCookie, setCookie } from '@tanstack/react-start/server'
import { Schema } from 'effect'

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

export const getThemeServerFn = createServerFn().handler(async () =>
  decodeThemeOrDefault(getCookie(storageKey)),
)

export const setThemeServerFn = createServerFn({ method: 'POST' })
  .validator(decodeTheme)
  .handler(async ({ data }) =>
    setCookie(storageKey, data, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: 60 * 60 * 24 * 365, // 1 year
    }),
  )
