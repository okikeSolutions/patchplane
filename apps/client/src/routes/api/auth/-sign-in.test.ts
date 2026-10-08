import { describe, expect, it, vi } from 'vitest'
import { Route } from './sign-in'

const getSignInUrl = vi.fn(
  async ({
    data,
  }: {
    readonly data: { readonly returnPathname?: string | undefined }
  }) =>
    `https://auth.example/sign-in?return=${encodeURIComponent(data.returnPathname ?? '')}`,
)

vi.mock('@workos/authkit-tanstack-react-start', () => ({ getSignInUrl }))

async function getSignInResponse(request: Request) {
  const handlers = Route.options.server?.handlers
  if (handlers === undefined || typeof handlers === 'function') {
    throw new Error('Sign-in route has no server handlers')
  }
  const get = handlers.GET
  if (get === undefined) throw new Error('Sign-in route has no GET handler')
  const result = await get({
    request,
    context: undefined,
    params: {},
    pathname: '/api/auth/sign-in',
    next: () => {
      throw new Error('Sign-in handler must return its own response')
    },
  })
  if (!(result instanceof Response)) {
    throw new Error('Sign-in route did not return a response')
  }
  return result
}

describe('WorkOS sign-in route', () => {
  it('keeps return navigation on the application origin', async () => {
    getSignInUrl.mockClear()
    const response = await getSignInResponse(
      new Request(
        'https://app.example/api/auth/sign-in?returnPathname=https%3A%2F%2Fevil.example%2Fsteal%3Fnext%3D1',
      ),
    )

    expect(getSignInUrl).toHaveBeenCalledWith({
      data: { returnPathname: '/steal?next=1' },
    })
    expect(response.status).toBe(307)
    expect(response.headers.get('location')).toBe(
      'https://auth.example/sign-in?return=%2Fsteal%3Fnext%3D1',
    )
  })

  it('strips the external origin from protocol-relative return paths', async () => {
    getSignInUrl.mockClear()
    await getSignInResponse(
      new Request(
        'https://app.example/api/auth/sign-in?returnPathname=%2F%2Fevil.example%2Fsteal',
      ),
    )

    expect(getSignInUrl).toHaveBeenCalledWith({
      data: { returnPathname: '/steal' },
    })
  })
})
