import { describe, expect, test, vi } from 'vitest'
import { formatRelative } from './workflow-console-model'

vi.mock('@/paraglide/runtime', () => ({
  getLocale: () => 'en',
}))

describe('workflow console model', () => {
  test('formats relative time with the active app locale', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-06-27T12:00:00.000Z'))

    expect(formatRelative(Date.parse('2026-06-18T12:00:00.000Z'))).toBe('9 days ago')

    vi.useRealTimers()
  })
})
