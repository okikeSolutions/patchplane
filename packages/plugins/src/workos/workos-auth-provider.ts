import { Clock, Duration, Effect, Layer, Schema } from 'effect'
import * as Mac from 'effect/crypto/Mac'
import * as Redacted from 'effect/Redacted'
import { WorkOsAuthProvider } from '@patchplane/core'
import {
  AuthenticationError,
  sanitizeErrorMessage,
  WorkOsAuthenticatedIdentity,
} from '@patchplane/domain'

const DEFAULT_WORKOS_TIMEOUT_MS = 10_000

const WorkOsRawAuthPayload = Schema.Struct({
  provider: Schema.Literal('GitHubOAuth'),
  identity: WorkOsAuthenticatedIdentity,
})

export interface WorkOsAuthPort<
  ECallback = unknown,
  ESession = unknown,
  EOrg = unknown,
> {
  readonly timeoutMs?: number
  readonly exchangeGitHubOAuthCode: (input: {
    readonly code: Redacted.Redacted
  }) => Effect.Effect<unknown, ECallback>
  readonly verifyAccessToken: (
    token: Redacted.Redacted,
  ) => Effect.Effect<unknown, ESession>
  readonly checkOrganizationMembership: (input: {
    readonly principalId: string
    readonly organizationId: string
  }) => Effect.Effect<boolean, EOrg>
}

const constantTimeStringEqual = (a: string, b: string): boolean => {
  const enc = new TextEncoder()
  const bytesA = enc.encode(a)
  const bytesB = enc.encode(b)
  if (bytesA.byteLength === 0 || bytesA.byteLength !== bytesB.byteLength) {
    return false
  }
  return Mac.timingSafeEqual(bytesA, bytesB)
}

/**
 * WorkOS + GitHub OAuth authentication plugin. Validates OAuth CSRF state,
 * enforces `provider === 'GitHubOAuth'`, checks session expiry against `Clock`,
 * and verifies B2B organization membership — while NEVER inferring forge
 * repository authority from WorkOS sign-in alone.
 */
export const makeWorkOsAuthProviderLayer = <ECallback, ESession, EOrg>(
  port: WorkOsAuthPort<ECallback, ESession, EOrg>,
) =>
  Layer.succeed(
    WorkOsAuthProvider,
    WorkOsAuthProvider.of({
      authenticateGitHubOAuthCallback: Effect.fn(
        'WorkOsAuthProvider.authenticateGitHubOAuthCallback',
      )(function* (input) {
        if (!constantTimeStringEqual(input.state, input.expectedState)) {
          return yield* new AuthenticationError({
            reason: 'WorkOS GitHub OAuth state mismatch',
          })
        }
        if (Redacted.value(input.code).trim().length === 0) {
          return yield* new AuthenticationError({
            reason: 'WorkOS GitHub OAuth authorization code is empty',
          })
        }
        const timeoutMs = Math.max(
          1_000,
          port.timeoutMs ?? DEFAULT_WORKOS_TIMEOUT_MS,
        )
        const raw = yield* port
          .exchangeGitHubOAuthCode({ code: input.code })
          .pipe(
            Effect.mapError(
              (cause) =>
                new AuthenticationError({
                  reason: sanitizeErrorMessage(cause),
                }),
            ),
            Effect.timeoutOrElse({
              duration: Duration.millis(timeoutMs),
              orElse: () =>
                Effect.fail(
                  new AuthenticationError({
                    reason: `WorkOS GitHub OAuth callback timed out after ${timeoutMs}ms`,
                  }),
                ),
            }),
          )
        const decoded = yield* Schema.decodeUnknownEffect(WorkOsRawAuthPayload)(
          raw,
        ).pipe(
          Effect.mapError(
            () =>
              new AuthenticationError({
                reason:
                  'WorkOS authentication payload was missing required GitHubOAuth identity claims',
              }),
          ),
        )
        const now = yield* Clock.currentTimeMillis
        if (decoded.identity.expiresAtMs <= now) {
          return yield* new AuthenticationError({
            reason: 'WorkOS authenticated session is already expired',
          })
        }
        return decoded.identity
      }),

      verifySessionToken: Effect.fn('WorkOsAuthProvider.verifySessionToken')(
        function* (token) {
          if (Redacted.value(token).trim().length === 0) {
            return yield* new AuthenticationError({
              reason: 'Missing WorkOS session token',
            })
          }
          const timeoutMs = Math.max(
            1_000,
            port.timeoutMs ?? DEFAULT_WORKOS_TIMEOUT_MS,
          )
          const raw = yield* port.verifyAccessToken(token).pipe(
            Effect.mapError(
              (cause) =>
                new AuthenticationError({
                  reason: sanitizeErrorMessage(cause),
                }),
            ),
            Effect.timeoutOrElse({
              duration: Duration.millis(timeoutMs),
              orElse: () =>
                Effect.fail(
                  new AuthenticationError({
                    reason: `WorkOS session verification timed out after ${timeoutMs}ms`,
                  }),
                ),
            }),
          )
          const decoded = yield* Schema.decodeUnknownEffect(
            WorkOsRawAuthPayload,
          )(raw).pipe(
            Effect.mapError(
              () =>
                new AuthenticationError({
                  reason:
                    'WorkOS session token did not decode to a valid GitHubOAuth identity',
                }),
            ),
          )
          const now = yield* Clock.currentTimeMillis
          if (decoded.identity.expiresAtMs <= now) {
            return yield* new AuthenticationError({
              reason: 'WorkOS session token has expired',
            })
          }
          return decoded.identity
        },
      ),

      verifyOrganizationMembership: Effect.fn(
        'WorkOsAuthProvider.verifyOrganizationMembership',
      )(function* (input) {
        const timeoutMs = Math.max(
          1_000,
          port.timeoutMs ?? DEFAULT_WORKOS_TIMEOUT_MS,
        )
        return yield* port
          .checkOrganizationMembership({
            principalId: input.principalId,
            organizationId: input.organizationId,
          })
          .pipe(
            Effect.mapError(
              (cause) =>
                new AuthenticationError({
                  reason: sanitizeErrorMessage(cause),
                }),
            ),
            Effect.timeoutOrElse({
              duration: Duration.millis(timeoutMs),
              orElse: () =>
                Effect.fail(
                  new AuthenticationError({
                    reason: `WorkOS organization membership check timed out after ${timeoutMs}ms`,
                  }),
                ),
            }),
          )
      }),
    }),
  )
