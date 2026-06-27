// @vitest-environment jsdom

import { describe, expect, test, vi } from 'vitest'
import {
  createGitHubInstallCallbackResponse,
  createGitHubInstallStartResponse,
} from './-install-flow'

function locationOf(response: Response) {
  return response.headers.get('Location')
}

describe('GitHub install flow helpers', () => {
  test('install start requires an authenticated user and organization', async () => {
    const createIntent = vi.fn()
    const response = await createGitHubInstallStartResponse({
      auth: { hasUser: false },
      requestUrl: 'https://patchplane.local/api/github/install/start',
      state: 'state_123',
      installUrl: 'https://github.com/apps/patchplane/installations/new',
      createIntent,
      now: 1,
    })

    expect(response.status).toBe(307)
    expect(locationOf(response)).toBe('/api/auth/sign-in?returnPathname=/app')
    expect(createIntent).not.toHaveBeenCalled()
  })

  test('install start stores an intent and redirects to GitHub with state', async () => {
    const createIntent = vi.fn().mockResolvedValue(undefined)
    const response = await createGitHubInstallStartResponse({
      auth: {
        hasUser: true,
        organizationId: 'org_123',
        accessToken: 'token_123',
      },
      requestUrl: 'https://patchplane.local/api/github/install/start?returnPathname=/app',
      state: 'state_123',
      installUrl: 'https://github.com/apps/patchplane/installations/new',
      createIntent,
      now: 1_000,
    })

    expect(createIntent).toHaveBeenCalledWith({
      state: 'state_123',
      workspaceId: 'workos:org_123',
      returnPathname: '/app',
      expiresAt: 601_000,
    })
    expect(response.status).toBe(307)
    expect(locationOf(response)).toBe(
      'https://github.com/apps/patchplane/installations/new?state=state_123',
    )
  })

  test('install callback requires an authenticated user and organization', async () => {
    const consumeIntent = vi.fn()
    const syncInstallation = vi.fn()
    const response = await createGitHubInstallCallbackResponse({
      auth: { hasUser: false },
      requestUrl: 'https://patchplane.local/api/github/install/callback?installation_id=123&state=state_123',
      consumeIntent,
      syncInstallation,
    })

    expect(response.status).toBe(307)
    expect(locationOf(response)).toBe('/api/auth/sign-in?returnPathname=/app')
    expect(consumeIntent).not.toHaveBeenCalled()
    expect(syncInstallation).not.toHaveBeenCalled()
  })

  test('install callback consumes state, stores repositories, and redirects to the app', async () => {
    const consumeIntent = vi.fn().mockResolvedValue({
      workspaceId: 'workos:org_123',
      actorId: 'workos:user_123',
      returnPathname: '/app',
    })
    const syncInstallation = vi.fn().mockResolvedValue(undefined)
    const response = await createGitHubInstallCallbackResponse({
      auth: {
        hasUser: true,
        organizationId: 'org_123',
        accessToken: 'token_123',
      },
      requestUrl: 'https://patchplane.local/api/github/install/callback?installation_id=123&state=state_123&setup_action=install',
      consumeIntent,
      syncInstallation,
    })

    expect(consumeIntent).toHaveBeenCalledWith({
      state: 'state_123',
      workspaceId: 'workos:org_123',
    })
    expect(syncInstallation).toHaveBeenCalledWith({
      installationId: '123',
      workspaceId: 'workos:org_123',
    })
    expect(response.status).toBe(303)
    expect(locationOf(response)).toBe('/app?github=connected')
  })
})
