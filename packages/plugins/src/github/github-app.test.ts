import {
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
} from 'node:crypto'
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
  test('converts PKCS#1 keys without changing their public key', () => {
    const original = privateKey('pkcs1')
    const normalized = normalizeGitHubAppPrivateKey(original)
    const originalPublicKey = createPublicKey(
      createPrivateKey(original),
    ).export({
      type: 'spki',
      format: 'der',
    })
    const normalizedPublicKey = createPublicKey(
      createPrivateKey(normalized),
    ).export({ type: 'spki', format: 'der' })

    expect(normalizedPublicKey).toEqual(originalPublicKey)
  })

  test('preserves the public key for PKCS#8 input', () => {
    const pkcs8 = privateKey('pkcs8')
    const normalized = normalizeGitHubAppPrivateKey(pkcs8)

    expect(
      createPublicKey(createPrivateKey(normalized)).export({
        type: 'spki',
        format: 'der',
      }),
    ).toEqual(
      createPublicKey(createPrivateKey(pkcs8)).export({
        type: 'spki',
        format: 'der',
      }),
    )
  })
})
