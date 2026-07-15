import { readFileSync } from 'node:fs'
import { describe, expect, test } from 'vitest'

function parseMessages(url: URL): Record<string, string> {
  const value: unknown = JSON.parse(readFileSync(url, 'utf8'))
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TypeError('Expected a message object')
  }

  const entries = Object.entries(value).filter(
    (entry): entry is [string, string] => typeof entry[1] === 'string',
  )
  return Object.fromEntries(entries)
}

const english = parseMessages(
  new URL('../../messages/en.json', import.meta.url),
)
const german = parseMessages(new URL('../../messages/de.json', import.meta.url))
const landingSource = readFileSync(
  new URL('./index.tsx', import.meta.url),
  'utf8',
)

const landingCopy = (messages: Record<string, string>) =>
  Object.entries(messages)
    .filter(([key]) => key.startsWith('landing_'))
    .map(([, value]) => value)
    .join('\n')

describe('M9.9 landing copy', () => {
  test('keeps English and German message keys in sync', () => {
    expect(Object.keys(german)).toEqual(Object.keys(english))
  })

  test('keeps implementation details and unsupported commands off the landing page', () => {
    const publicCopy = `${landingCopy(english)}\n${landingCopy(german)}\n${landingSource}`

    expect(publicCopy).not.toMatch(
      /Daytona|M9\.9|patchplane (review|run|evidence|collect)/,
    )
  })

  test('links the open-source paths developers need', () => {
    expect(landingSource).toContain('#quick-start')
    expect(landingSource).toContain('CONTRIBUTING.md')
    expect(landingSource).toContain('ROADMAP.md')
  })
})
