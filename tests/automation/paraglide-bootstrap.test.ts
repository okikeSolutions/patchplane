import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { translatedPathnameLocales } from '../../apps/client/src/lib/translated-pathnames'

const inlangSettings: unknown = JSON.parse(
  readFileSync('apps/client/project.inlang/settings.json', 'utf8'),
)

function configuredProjectLocales(value: unknown) {
  if (typeof value !== 'object' || value === null) return undefined
  const locales = Reflect.get(value, 'locales')
  return Array.isArray(locales) &&
    locales.every((locale) => typeof locale === 'string')
    ? locales
    : undefined
}

describe('Paraglide clean-checkout bootstrap', () => {
  it('keeps bootstrap routing locales aligned with the Inlang project', () => {
    expect([...translatedPathnameLocales]).toEqual(
      configuredProjectLocales(inlangSettings),
    )
  })
})
