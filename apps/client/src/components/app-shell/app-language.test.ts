import { describe, expect, test } from 'vitest'
import { localizeHref } from '@/paraglide/runtime'
import deMessages from '../../../messages/de.json'
import enMessages from '../../../messages/en.json'
import { documentLocaleForPathname } from './app-language'

describe('alpha app language', () => {
  test('preserves the route locale throughout the app', () => {
    expect(documentLocaleForPathname('/app', 'de')).toBe('de')
    expect(documentLocaleForPathname('/app/workflows/run_123', 'de')).toBe('de')
    expect(documentLocaleForPathname('/app', 'en')).toBe('en')
    expect(documentLocaleForPathname('/', 'de')).toBe('de')
  })

  test('localizes app navigation targets', () => {
    expect(localizeHref('/app', { locale: 'de' })).toBe('/de/app')
    expect(localizeHref('/app', { locale: 'en' })).toBe('/en/app')
  })

  test('keeps translated message keys aligned', () => {
    expect(Object.keys(deMessages).toSorted()).toEqual(
      Object.keys(enMessages).toSorted(),
    )
  })
})
