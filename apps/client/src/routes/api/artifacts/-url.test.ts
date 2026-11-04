import { describe, expect, it, vi } from 'vitest'
import { Route } from './url'

const getAuth = vi.fn(
  async (): Promise<{
    readonly user: unknown
    readonly accessToken?: string
  }> => ({ user: null }),
)

vi.mock('@workos/authkit-tanstack-react-start', () => ({ getAuth }))

async function getArtifactUrlResponse(request: Request) {
  const handlers = Route.options.server?.handlers
  if (handlers === undefined || typeof handlers === 'function') {
    throw new Error('Artifact URL route has no server handlers')
  }
  const get = handlers.GET
  if (get === undefined)
    throw new Error('Artifact URL route has no GET handler')
  const result = await get({
    request,
    context: undefined,
    params: {},
    pathname: '/api/artifacts/url',
    next: () => {
      throw new Error('Artifact URL handler must return its own response')
    },
  })
  if (!(result instanceof Response)) {
    throw new Error('Artifact URL route did not return a response')
  }
  return result
}

describe('artifact URL route', () => {
  it('requires an authenticated user before resolving artifact metadata', async () => {
    getAuth.mockResolvedValue({ user: null })
    const response = await getArtifactUrlResponse(
      new Request(
        'https://app.example/api/artifacts/url?artifactId=artifact_1',
      ),
    )

    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toMatchObject({
      code: 'authentication_required',
    })
  })

  it('rejects a missing artifact id after authentication', async () => {
    getAuth.mockResolvedValue({ user: { id: 'user_1' }, accessToken: 'token' })
    const response = await getArtifactUrlResponse(
      new Request('https://app.example/api/artifacts/url'),
    )

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({
      code: 'invalid_artifact_request',
    })
  })
})
