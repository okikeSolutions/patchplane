import { describe, expect, it } from '@effect/vitest'
import { deriveDurableVerificationStatus } from './persist-sandbox-verification-evidence'

const succeeded = {
  kind: 'test' as const,
  command: 'bun test',
  status: 'succeeded' as const,
  exitCode: 0,
}

describe('durable sandbox verification status', () => {
  it('passes only with an unchanged candidate and required artifact', () => {
    expect(deriveDurableVerificationStatus(succeeded, true, true)).toBe('passed')
    expect(deriveDurableVerificationStatus(succeeded, false, true)).toBe('invalidated')
    expect(deriveDurableVerificationStatus(succeeded, true, false)).toBe('error')
  })

  it('distinguishes command failure from evidence capture error', () => {
    expect(deriveDurableVerificationStatus({ ...succeeded, status: 'failed', exitCode: 2 }, true, true)).toBe('failed')
    expect(deriveDurableVerificationStatus({ ...succeeded, status: 'failed', exitCode: undefined }, true, true)).toBe('failed')
    expect(deriveDurableVerificationStatus({ ...succeeded, status: 'failed', exitCode: 0 }, true, false)).toBe('error')
  })
})
