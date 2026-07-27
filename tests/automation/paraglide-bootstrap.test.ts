import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const compileScript = readFileSync(
  'apps/client/src/scripts/compile-paraglide.ts',
  'utf8',
)
const translatedPathnames = readFileSync(
  'apps/client/src/lib/translated-pathnames.ts',
  'utf8',
)
const inlangSettings: unknown = JSON.parse(
  readFileSync('apps/client/project.inlang/settings.json', 'utf8'),
)

function configuredProjectLocales(value: unknown) {
  if (typeof value !== 'object' || value === null) return undefined
  const locales = Reflect.get(value, 'locales')
  return Array.isArray(locales) && locales.every((locale) => typeof locale === 'string')
    ? locales
    : undefined
}

describe('Paraglide clean-checkout bootstrap', () => {
  it('keeps the compiler import graph independent of generated Paraglide output', () => {
    expect(compileScript).toContain("from '../lib/translated-pathnames'")
    expect(compileScript).not.toMatch(/from\s+["'](?:\.\.\/|@\/)paraglide\//)
    expect(translatedPathnames).not.toMatch(/paraglide\/(?:messages|runtime)/)
  })

  it('keeps bootstrap routing locales aligned with the Inlang project', () => {
    const configuredLocales = [...translatedPathnames.matchAll(
      /translatedPathnameLocales\s*=\s*\[([^\]]+)\]/g,
    )].flatMap((match) => match[1]?.match(/["']([^"']+)["']/g) ?? [])
      .map((locale) => locale.slice(1, -1))

    expect(configuredLocales).toEqual(configuredProjectLocales(inlangSettings))
  })
})
