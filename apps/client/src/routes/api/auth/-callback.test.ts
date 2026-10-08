import { describe, expect, it, vi } from 'vitest'
import { Route } from './callback'

const workos = vi.hoisted(() => ({
  handleCallbackRoute: vi.fn(),
}))

vi.mock('@workos/authkit-tanstack-react-start', () => workos)

async function getCallbackResponse(request: Request) {
  const handlers = Route.options.server?.handlers
  if (handlers === undefined || typeof handlers === 'function') {
    throw new Error('WorkOS callback route has no server handlers')
  }
  const get = handlers.GET
  if (get === undefined) throw new Error('WorkOS callback route has no GET handler')
  const result = await get({
    request,
    context: undefined,
    params: {},
    pathname: '/api/auth/callback',
    next: () => {
      throw new Error('WorkOS callback handler must return its own response')
    },
  })
  if (!(result instanceof Response)) {
    throw new Error('WorkOS callback route did not return a response')
  }
  return result
}

describe('WorkOS callback route', () => {
  it('delegates the request with a safe failure destination', async () => {
    workos.handleCallbackRoute.mockReset().mockReturnValue(
      async () => new Response('callback complete', { status: 200 }),
    )

    const response = await getCallbackResponse(
      new Request('https://app.example/api/auth/callback?code=provider-code'),
    )

    expect(workos.handleCallbackRoute).toHaveBeenCalledWith({
      errorRedirectUrl: '/?auth=failed',
    })
    expect(response.status).toBe(200)
    expect(await response.text()).toBe('callback complete')
  })

  it('maps callback adapter failures into an application auth error', async () => {
    workos.handleCallbackRoute.mockReset().mockReturnValue(async () => {
      throw new Error('provider response body')
    })

    await expect(
      getCallbackResponse(
        new Request('https://app.example/api/auth/callback?code=bad-code'),
      ),
    ).rejects.toMatchObject({
      _tag: 'AuthError',
      operation: 'workos.callback',
      message: 'WorkOS callback handling failed',
    })
  })
})
