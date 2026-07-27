import { describe, expect, test } from 'vitest'
import * as m from '@/paraglide/messages'
import { localizeHref } from '@/paraglide/runtime'
import { documentLocaleForPathname } from './app-language'

describe('alpha app language', () => {
  test('preserves the route locale throughout the app', () => {
    expect(documentLocaleForPathname('/app', 'de')).toBe('de')
    expect(documentLocaleForPathname('/app/workflows/run_123', 'de')).toBe('de')
    expect(documentLocaleForPathname('/app', 'en')).toBe('en')
    expect(documentLocaleForPathname('/', 'de')).toBe('de')
  })

  test('keeps app links and operational copy in the selected locale', () => {
    expect(localizeHref('/app', { locale: 'de' })).toBe('/de/app')
    expect(localizeHref('/app', { locale: 'en' })).toBe('/en/app')
    expect(m.app_queue_heading({}, { locale: 'de' })).toBe(
      'Workflow-Warteschlange',
    )
    expect(m.app_queue_heading({}, { locale: 'en' })).toBe('Workflow queue')
    expect(m.app_detail_summary({}, { locale: 'de' })).toBe('Übersicht')
    expect(m.app_detail_summary({}, { locale: 'en' })).toBe('Summary')
    expect(m.app_update_available_title({}, { locale: 'de' })).toBe(
      'Neue Patchplane-Version verfügbar',
    )
    expect(m.app_update_available_title({}, { locale: 'en' })).toBe(
      'New Patchplane version available',
    )
    expect(m.app_update_reload({}, { locale: 'de' })).toBe('Neu laden')
    expect(m.app_update_reload({}, { locale: 'en' })).toBe('Reload')
  })
})
