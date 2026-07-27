import { describe, expect, test } from 'vitest'
import {
  activeAppVersionFrom,
  appVersionIdFrom,
  createAppVersionResponse,
  isNewAppVersion,
} from './app-version'

describe('app version contract', () => {
  test('decodes non-empty version identifiers and detects a replacement', () => {
    const bootVersionId = appVersionIdFrom('version-a')
    const activeVersion = activeAppVersionFrom({ versionId: 'version-b' })

    expect(isNewAppVersion(bootVersionId, activeVersion.versionId)).toBe(true)
    expect(isNewAppVersion(bootVersionId, bootVersionId)).toBe(false)
    expect(() => activeAppVersionFrom({ versionId: '' })).toThrow()
  })

  test('returns a non-cacheable JSON response', async () => {
    const response = createAppVersionResponse(appVersionIdFrom('version-a'))

    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(response.headers.get('content-type')).toBe(
      'application/json; charset=utf-8',
    )
    await expect(response.json()).resolves.toEqual({ versionId: 'version-a' })
  })

  test('omits the response body for a HEAD request', async () => {
    const response = createAppVersionResponse(
      appVersionIdFrom('version-a'),
      'HEAD',
    )

    await expect(response.text()).resolves.toBe('')
  })
})
