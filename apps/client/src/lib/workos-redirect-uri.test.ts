import { describe, expect, it } from 'vitest'
import { resolveWorkOSRedirectUri } from './workos-redirect-uri'

describe('resolveWorkOSRedirectUri', () => {
  it('prefers the configured public callback over an internal request origin', () => {
    expect(resolveWorkOSRedirectUri(
      new Request('http://localhost:3000/app'),
      'https://patchplane.example/api/auth/callback',
    )).toBe('https://patchplane.example/api/auth/callback')
  })

  it('derives the callback from the request origin for local development', () => {
    expect(resolveWorkOSRedirectUri(
      new Request('http://localhost:3000/app'),
      '',
    )).toBe('http://localhost:3000/api/auth/callback')
  })

  it.each([
    'javascript:alert(1)',
    'https://user:password@patchplane.example/api/auth/callback',
    'https://patchplane.example/not-the-callback',
    'https://patchplane.example/api/auth/callback?next=/app',
  ])('rejects an unsafe or incorrect configured callback: %s', (configured) => {
    expect(() => resolveWorkOSRedirectUri(
      new Request('http://localhost:3000/app'),
      configured,
    )).toThrow('WORKOS_REDIRECT_URI must be an HTTP(S) URL')
  })
})
