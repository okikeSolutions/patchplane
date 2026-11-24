import { Clock, Duration, Effect, Layer, Schema } from 'effect'
import * as Digest from 'effect/crypto/Digest'
import * as Mac from 'effect/crypto/Mac'
import * as Redacted from 'effect/Redacted'
import { WorkOsAuthProvider } from '@patchplane/core'
import {
  AuthenticationError,
  sanitizeErrorMessage,
  WorkOsAuthenticatedIdentity,
} from '@patchplane/domain'

const DEFAULT_WORKOS_TIMEOUT_MS = 10_000
const MAX_WORKOS_TIMEOUT_MS = 60_000
const textEncoder = new TextEncoder()

const normalizeTimeoutMs = (raw: number | undefined): number =>
  raw !== undefined && Number.isFinite(raw)
    ? Math.min(Math.max(1_000, Math.floor(raw)), MAX_WORKOS_TIMEOUT_MS)
    : DEFAULT_WORKOS_TIMEOUT_MS

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
  }) => Effect.Effect<unknown, EOrg>
}

/**
 * WorkOS + GitHub OAuth authentication plugin. Validates OAuth CSRF state
 * using fixed-length SHA-256 constant-time comparison, enforces
 * `provider === 'GitHubOAuth'`, checks session expiry against `Clock`, and
 * runtime-validates organization membership — while NEVER inferring forge
 * repository authority from WorkOS sign-in alone.
 */
export const makeWorkOsAuthProviderLayer = <ECallback, ESession, EOrg>(
  port: WorkOsAuthPort<ECallback, ESession, EOrg>,
) =>
  Layer.effect(
    WorkOsAuthProvider,
    Effect.gen(function* () {
      const digest = yield* Digest.Digest
      const timeoutMs = normalizeTimeoutMs(port.timeoutMs)

      const constantTimeStateEqual = Effect.fnUntraced(function* (
        actual: string,
        expected: string,
      ) {
        if (actual.length === 0 || expected.length === 0) {
          return false
        }
        const [hashA, hashB] = yield* Effect.all([
          digest.digest(Digest.sha256, textEncoder.encode(actual)),
          digest.digest(Digest.sha256, textEncoder.encode(expected)),
        ]).pipe(
          Effect.mapError(
            () =>
              new AuthenticationError({
                reason: 'OAuth state verification failed',
              }),
          ),
        )
        return Mac.timingSafeEqual(hashA, hashB)
      })

      return WorkOsAuthProvider.of({
        authenticateGitHubOAuthCallback: Effect.fn(
          'WorkOsAuthProvider.authenticateGitHubOAuthCallback',
        )(function* (input) {
          const stateMatches = yield* constantTimeStateEqual(
            input.state,
            input.expectedState,
          )
          if (!stateMatches) {
            return yield* new AuthenticationError({
              reason: 'WorkOS GitHub OAuth state mismatch',
            })
          }
          if (Redacted.value(input.code).trim().length === 0) {
            return yield* new AuthenticationError({
              reason: 'WorkOS GitHub OAuth authorization code is empty',
            })
          }
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
          const decoded = yield* Schema.decodeUnknownEffect(
            WorkOsRawAuthPayload,
          )(raw).pipe(
            Effect.tapError((cause) =>
              Effect.logWarning(
                'WorkOS OAuth callback payload failed schema decode',
                { reason: sanitizeErrorMessage(cause) },
              ),
            ),
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
          yield* Effect.annotateCurrentSpan({
            principalId: decoded.identity.principalId,
            organizationId: decoded.identity.organizationId,
          })
          return decoded.identity
        }),

        verifySessionToken: Effect.fn('WorkOsAuthProvider.verifySessionToken')(
          function* (token) {
            if (Redacted.value(token).trim().length === 0) {
              return yield* new AuthenticationError({
                reason: 'Missing WorkOS session token',
              })
            }
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
              Effect.tapError((cause) =>
                Effect.logWarning(
                  'WorkOS session token payload failed schema decode',
                  { reason: sanitizeErrorMessage(cause) },
                ),
              ),
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
            yield* Effect.annotateCurrentSpan({
              principalId: decoded.identity.principalId,
              organizationId: decoded.identity.organizationId,
            })
            return decoded.identity
          },
        ),

        verifyOrganizationMembership: Effect.fn(
          'WorkOsAuthProvider.verifyOrganizationMembership',
        )(function* (input) {
          yield* Effect.annotateCurrentSpan({
            principalId: input.principalId,
            organizationId: input.organizationId,
          })
          const raw = yield* port
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
          return yield* Schema.decodeUnknownEffect(Schema.Boolean)(raw).pipe(
            Effect.mapError(
              () =>
                new AuthenticationError({
                  reason:
                    'WorkOS organization membership check returned a non-boolean result',
                }),
            ),
          )
        }),
      })
    }),
  )
