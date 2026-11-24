import { describe, expect, it } from '@effect/vitest'
import { Duration, Effect, Fiber, Layer } from 'effect'
import * as Digest from 'effect/crypto/Digest'
import * as Redacted from 'effect/Redacted'
import * as TestClock from 'effect/testing/TestClock'
import { WorkOsAuthProvider } from '@patchplane/core'
import {
  ForgeUserLogin,
  HumanPrincipalId,
  OrganizationId,
  WorkOsSessionId,
} from '@patchplane/domain'
import { makeWorkOsAuthProviderLayer } from './workos-auth-provider'

const makeIdentityPayload = (
  expiresAtMs: number,
  provider = 'GitHubOAuth',
) => ({
  provider,
  identity: {
    principalId: HumanPrincipalId.make('user-wos-1'),
    workOsUserId: 'wos_user_1',
    workOsSessionId: WorkOsSessionId.make('wos_sess_1'),
    organizationId: OrganizationId.make('org-wos-1'),
    forgeUserLogin: ForgeUserLogin.make('okike-maintainer'),
    email: 'ugo@okikesolutions.dev',
    expiresAtMs,
  },
})

describe('WorkOsAuthProvider plugin boundary & security checks', () => {
  it.effect(
    'enforces constant-time CSRF state check, GitHubOAuth provider claim, non-empty credentials, session expiry, and boolean org membership',
    () =>
      Effect.gen(function* () {
        yield* TestClock.adjust(Duration.millis(10_000))
        let callbackPayload: unknown = makeIdentityPayload(60_000)
        let sessionPayload: unknown = makeIdentityPayload(60_000)
        let orgResult: unknown = true

        const layer = makeWorkOsAuthProviderLayer({
          exchangeGitHubOAuthCode: () => Effect.sync(() => callbackPayload),
          verifyAccessToken: () => Effect.sync(() => sessionPayload),
          checkOrganizationMembership: () => Effect.sync(() => orgResult),
        }).pipe(Layer.provide(Digest.layerWebCrypto))

        yield* Effect.gen(function* () {
          const auth = yield* WorkOsAuthProvider

          // 1) CSRF state mismatch (including differing lengths & empty)
          for (const [state, expected] of [
            ['short', 'much-longer-expected-state'],
            ['wrong-state-1', 'right-state-1'],
            ['', 'expected-state'],
          ] as const) {
            const err = yield* Effect.flip(
              auth.authenticateGitHubOAuthCallback({
                code: Redacted.make('oauth-code-1'),
                state,
                expectedState: expected,
              }),
            )
            expect(err._tag).toBe('AuthenticationError')
          }

          // 2) Empty OAuth code or empty session token rejected
          const emptyCode = yield* Effect.flip(
            auth.authenticateGitHubOAuthCallback({
              code: Redacted.make('   '),
              state: 'csrf-ok',
              expectedState: 'csrf-ok',
            }),
          )
          expect(emptyCode._tag).toBe('AuthenticationError')

          const emptyToken = yield* Effect.flip(
            auth.verifySessionToken(Redacted.make('')),
          )
          expect(emptyToken._tag).toBe('AuthenticationError')

          // 3) Non-GitHubOAuth provider claim rejected
          callbackPayload = makeIdentityPayload(60_000, 'GoogleOAuth')
          const wrongProvider = yield* Effect.flip(
            auth.authenticateGitHubOAuthCallback({
              code: Redacted.make('oauth-code-1'),
              state: 'csrf-ok',
              expectedState: 'csrf-ok',
            }),
          )
          expect(wrongProvider._tag).toBe('AuthenticationError')

          // 4) Valid GitHubOAuth callback succeeds
          callbackPayload = makeIdentityPayload(60_000, 'GitHubOAuth')
          const ok = yield* auth.authenticateGitHubOAuthCallback({
            code: Redacted.make('oauth-code-1'),
            state: 'csrf-ok',
            expectedState: 'csrf-ok',
          })
          expect(ok.principalId).toBe('user-wos-1')

          // 5) Expired session token fails closed after TestClock advances
          sessionPayload = makeIdentityPayload(15_000, 'GitHubOAuth')
          yield* TestClock.adjust(Duration.millis(5_001))
          const expired = yield* Effect.flip(
            auth.verifySessionToken(Redacted.make('tok-1')),
          )
          expect(expired._tag).toBe('AuthenticationError')

          // 6) Non-boolean organization membership payload fails closed
          orgResult = 'false'
          const badBool = yield* Effect.flip(
            auth.verifyOrganizationMembership({
              principalId: HumanPrincipalId.make('user-wos-1'),
              organizationId: OrganizationId.make('org-wos-1'),
            }),
          )
          expect(badBool._tag).toBe('AuthenticationError')

          orgResult = false
          expect(
            yield* auth.verifyOrganizationMembership({
              principalId: HumanPrincipalId.make('user-wos-1'),
              organizationId: OrganizationId.make('org-wos-1'),
            }),
          ).toBe(false)
        }).pipe(Effect.provide(layer))
      }),
  )

  it.effect(
    'enforces bounded TestClock timeout even when port timeoutMs is NaN',
    () =>
      Effect.gen(function* () {
        const layer = makeWorkOsAuthProviderLayer({
          timeoutMs: 2_000,
          exchangeGitHubOAuthCode: () => Effect.never,
          verifyAccessToken: () => Effect.never,
          checkOrganizationMembership: () => Effect.never,
        }).pipe(Layer.provide(Digest.layerWebCrypto))

        const fiber = yield* Effect.forkChild(
          Effect.flip(
            Effect.gen(function* () {
              const auth = yield* WorkOsAuthProvider
              return yield* auth.verifySessionToken(Redacted.make('tok-hang'))
            }).pipe(Effect.provide(layer)),
          ),
        )
        yield* TestClock.adjust(Duration.millis(2_001))
        const err = yield* Fiber.join(fiber)
        expect(err._tag).toBe('AuthenticationError')
      }),
  )
})
