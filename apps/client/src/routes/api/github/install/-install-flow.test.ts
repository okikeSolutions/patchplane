// @vitest-environment jsdom

import { describe, expect, it } from '@effect/vitest'
import { vi } from 'vitest'
import { Effect } from 'effect'
import {
  createGitHubInstallCallbackResponse,
  createGitHubInstallStartResponse,
} from './-install-flow'

function locationOf(response: Response) {
  return response.headers.get('Location')
}

describe('GitHub install flow helpers', () => {
  it.effect(
    'install start requires an authenticated user and organization',
    () =>
      Effect.gen(function* () {
        const createIntent = vi.fn(() => Effect.void)
        const response = yield* createGitHubInstallStartResponse({
          auth: { hasUser: false },
          requestUrl: 'https://patchplane.local/api/github/install/start',
          state: 'state_123',
          installUrl: 'https://github.com/apps/patchplane/installations/new',
          createIntent,
        })
        expect(response.status).toBe(307)
        expect(locationOf(response)).toBe(
          '/api/auth/sign-in?returnPathname=/app',
        )
        expect(createIntent).not.toHaveBeenCalled()
      }),
  )

  it.effect(
    'does not call the connection adapter when a signed-in user lacks a token',
    () =>
      Effect.gen(function* () {
        const createIntent = vi.fn(() => Effect.void)
        const response = yield* createGitHubInstallStartResponse({
          auth: { hasUser: true, organizationId: 'org_123' },
          requestUrl: 'https://patchplane.local/api/github/install/start',
          state: 'state_123',
          installUrl: 'https://github.com/apps/patchplane/installations/new',
          createIntent,
        })
        expect(response.status).toBe(307)
        expect(locationOf(response)).toBe(
          '/api/auth/sign-in?returnPathname=/app',
        )
        expect(createIntent).not.toHaveBeenCalled()
      }),
  )

  it.effect(
    'install start stores an intent and redirects to GitHub with state',
    () =>
      Effect.gen(function* () {
        const createIntent = vi.fn(() => Effect.void)
        const response = yield* createGitHubInstallStartResponse({
          auth: {
            hasUser: true,
            organizationId: 'org_123',
            accessToken: 'token_123',
          },
          requestUrl:
            'https://patchplane.local/api/github/install/start?returnPathname=/app',
          state: 'state_123',
          installUrl: 'https://github.com/apps/patchplane/installations/new',
          createIntent,
        })
        expect(createIntent).toHaveBeenCalledWith(
          {
            hasUser: true,
            organizationId: 'org_123',
            accessToken: 'token_123',
          },
          {
            state: 'state_123',
            workspaceId: 'workos:org_123',
            returnPathname: '/app',
          },
        )
        expect(response.status).toBe(307)
        expect(locationOf(response)).toBe(
          'https://github.com/apps/patchplane/installations/new?state=state_123',
        )
      }),
  )

  it.effect(
    'install callback requires an authenticated user and organization',
    () =>
      Effect.gen(function* () {
        const stageInstallation = vi.fn(() =>
          Effect.succeed({ authorizationUrl: '' }),
        )
        const consumeIntent = vi.fn(() =>
          Effect.succeed({
            workspaceId: '',
            actorId: '',
            installationId: '',
            pkceVerifier: '',
          }),
        )
        const syncInstallation = vi.fn(() => Effect.void)
        const response = yield* createGitHubInstallCallbackResponse({
          auth: { hasUser: false },
          requestUrl:
            'https://patchplane.local/api/github/install/callback?installation_id=123&state=state_123',
          stageInstallation,
          consumeIntent,
          syncInstallation,
        })
        expect(response.status).toBe(307)
        expect(locationOf(response)).toBe(
          '/api/auth/sign-in?returnPathname=/app',
        )
        expect(stageInstallation).not.toHaveBeenCalled()
        expect(consumeIntent).not.toHaveBeenCalled()
        expect(syncInstallation).not.toHaveBeenCalled()
      }),
  )

  it.effect(
    'setup callback stages the untrusted installation and starts GitHub user authorization',
    () =>
      Effect.gen(function* () {
        const stageInstallation = vi.fn(() =>
          Effect.succeed({
            authorizationUrl:
              'https://github.com/login/oauth/authorize?state=state_123',
          }),
        )
        const consumeIntent = vi.fn(() =>
          Effect.succeed({
            workspaceId: '',
            actorId: '',
            installationId: '',
            pkceVerifier: '',
          }),
        )
        const syncInstallation = vi.fn(() => Effect.void)
        const response = yield* createGitHubInstallCallbackResponse({
          auth: {
            hasUser: true,
            organizationId: 'org_123',
            accessToken: 'token_123',
          },
          requestUrl:
            'https://patchplane.local/api/github/install/callback?installation_id=123&state=state_123&setup_action=install',
          stageInstallation,
          consumeIntent,
          syncInstallation,
        })
        expect(stageInstallation).toHaveBeenCalledWith(
          {
            hasUser: true,
            organizationId: 'org_123',
            accessToken: 'token_123',
          },
          {
            state: 'state_123',
            workspaceId: 'workos:org_123',
            installationId: '123',
          },
        )
        expect(consumeIntent).not.toHaveBeenCalled()
        expect(syncInstallation).not.toHaveBeenCalled()
        expect(response.status).toBe(303)
        expect(locationOf(response)).toBe(
          'https://github.com/login/oauth/authorize?state=state_123',
        )
      }),
  )

  it.effect(
    'rejects an ambiguous callback containing setup and OAuth parameters',
    () =>
      Effect.gen(function* () {
        const stageInstallation = vi.fn(() =>
          Effect.succeed({ authorizationUrl: '' }),
        )
        const consumeIntent = vi.fn(() =>
          Effect.succeed({
            workspaceId: '',
            actorId: '',
            installationId: '',
            pkceVerifier: '',
          }),
        )
        const syncInstallation = vi.fn(() => Effect.void)
        const response = yield* createGitHubInstallCallbackResponse({
          auth: {
            hasUser: true,
            organizationId: 'org_123',
            accessToken: 'token_123',
          },
          requestUrl:
            'https://patchplane.local/api/github/install/callback?installation_id=123&code=code_123&state=state_123',
          stageInstallation,
          consumeIntent,
          syncInstallation,
        })
        expect(response.status).toBe(303)
        expect(locationOf(response)).toContain(
          'ambiguous_github_installation_callback_params',
        )
        expect(stageInstallation).not.toHaveBeenCalled()
        expect(consumeIntent).not.toHaveBeenCalled()
        expect(syncInstallation).not.toHaveBeenCalled()
      }),
  )

  it.effect(
    'OAuth callback syncs only the installation bound to consumed state',
    () =>
      Effect.gen(function* () {
        const stageInstallation = vi.fn(() =>
          Effect.succeed({ authorizationUrl: '' }),
        )
        const consumeIntent = vi.fn(() =>
          Effect.succeed({
            workspaceId: 'workos:org_123',
            actorId: 'workos:user_123',
            returnPathname: '/app',
            installationId: '123',
            pkceVerifier: 'v'.repeat(64),
          }),
        )
        const syncInstallation = vi.fn(() => Effect.void)
        const response = yield* createGitHubInstallCallbackResponse({
          auth: {
            hasUser: true,
            organizationId: 'org_123',
            accessToken: 'token_123',
          },
          requestUrl:
            'https://patchplane.local/api/github/install/callback?code=code_123&state=state_123',
          stageInstallation,
          consumeIntent,
          syncInstallation,
        })
        expect(consumeIntent).toHaveBeenCalledWith(
          {
            hasUser: true,
            organizationId: 'org_123',
            accessToken: 'token_123',
          },
          { state: 'state_123', workspaceId: 'workos:org_123' },
        )
        expect(syncInstallation).toHaveBeenCalledWith(
          {
            hasUser: true,
            organizationId: 'org_123',
            accessToken: 'token_123',
          },
          {
            installationId: '123',
            workspaceId: 'workos:org_123',
            authorizationCode: 'code_123',
            pkceVerifier: 'v'.repeat(64),
          },
        )
        expect(response.status).toBe(303)
        expect(locationOf(response)).toBe('/app?github=connected')
      }),
  )
})
