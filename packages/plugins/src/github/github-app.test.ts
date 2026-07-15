import { generateKeyPairSync } from 'node:crypto'
import { describe, expect, test } from 'vitest'
import { normalizeGitHubAppPrivateKey } from './github-app'

function privateKey(type: 'pkcs1' | 'pkcs8') {
  return generateKeyPairSync('rsa', { modulusLength: 1024 })
    .privateKey.export({
      type,
      format: 'pem',
    })
    .trim()
}

describe('normalizeGitHubAppPrivateKey', () => {
  test('converts PKCS#1 keys before Octokit reaches WebCrypto', () => {
    expect(normalizeGitHubAppPrivateKey(privateKey('pkcs1'))).toContain(
      '-----BEGIN PRIVATE KEY-----',
    )
  })

  test('preserves PKCS#8 key material', () => {
    const pkcs8 = privateKey('pkcs8')
    expect(normalizeGitHubAppPrivateKey(pkcs8)).toBe(pkcs8)
  })
})
