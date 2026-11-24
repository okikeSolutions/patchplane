import { Clock, Duration, Effect, Layer, Schema } from 'effect'
import * as Mac from 'effect/crypto/Mac'
import * as Redacted from 'effect/Redacted'
import { ForgeAdapter } from '@patchplane/core'
import {
  canApproveWithRepositoryPermission,
  ChangeRequestId,
  ForgeAdapterError,
  type ForgeCapabilities,
  ForgeInstallationId,
  ForgeProviderId,
  type ForgePullRequestCandidate,
  type ForgeRepositoryAuthority,
  ForgeWebhookVerificationError,
  GitCommitSha,
  RepositoryId,
  RepositoryPermissionLevel,
  sanitizeErrorMessage,
} from '@patchplane/domain'

export const GITHUB_FORGE_PROVIDER_ID = ForgeProviderId.make('github')

export const GITHUB_APP_CAPABILITIES: ForgeCapabilities = {
  supportsPullRequests: true,
  supportsWebhooks: true,
  supportsInstallationTokens: true,
  supportsRepositoryPermissions: true,
  supportsStatusChecks: true,
}

const DEFAULT_GITHUB_API_TIMEOUT_MS = 15_000

export interface GitHubAppApiPort<
  EToken = unknown,
  EPerm = unknown,
  EPr = unknown,
> {
  readonly webhookSecret: Redacted.Redacted
  readonly timeoutMs?: number
  readonly createInstallationToken: (input: {
    readonly repositoryId: string
  }) => Effect.Effect<
    {
      readonly installationId: string
      readonly token: string
      readonly expiresAtMs: number
    },
    EToken
  >
  readonly getCollaboratorPermission: (input: {
    readonly repositoryId: string
    readonly username: string
  }) => Effect.Effect<
    {
      readonly installationId: string
      readonly permission: string
    },
    EPerm
  >
  readonly getPullRequest: (input: {
    readonly repositoryId: string
    readonly pullNumber: number
  }) => Effect.Effect<
    {
      readonly headSha: string
      readonly isFork: boolean
      readonly forkRepositoryId?: string
    },
    EPr
  >
}

const InstallationTokenResponse = Schema.Struct({
  installationId: ForgeInstallationId,
  token: Schema.NonEmptyString,
  expiresAtMs: Schema.Int.check(Schema.isGreaterThan(0)),
})

const CollaboratorPermissionResponse = Schema.Struct({
  installationId: ForgeInstallationId,
  permission: RepositoryPermissionLevel,
})

const PullRequestResponse = Schema.Struct({
  headSha: GitCommitSha,
  isFork: Schema.Boolean,
  forkRepositoryId: Schema.optionalKey(RepositoryId),
})

const hexToBytes = (hex: string): Uint8Array | null => {
  if (!/^[0-9a-f]{64}$/i.test(hex)) return null
  const out = new Uint8Array(32)
  for (let i = 0; i < 32; i += 1) {
    out[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16)
  }
  return out
}

/**
 * GitHub App forge plugin implementing the provider-neutral `ForgeAdapter`
 * contract:
 * - Constant-time HMAC-SHA256 webhook verification (`X-Hub-Signature-256`) via `effect/crypto/Mac`
 * - Short-lived installation tokens wrapped in `Redacted`
 * - Authoritative collaborator permission checks decoupled from WorkOS login
 * - Pull-request candidate metadata with fork identity
 */
export const makeGitHubAppForgeAdapterLayer = <EToken, EPerm, EPr>(
  port: GitHubAppApiPort<EToken, EPerm, EPr>,
) =>
  Layer.effect(
    ForgeAdapter,
    Effect.gen(function* () {
      const mac = yield* Mac.Mac
      const timeoutMs = Math.max(
        1_000,
        port.timeoutMs ?? DEFAULT_GITHUB_API_TIMEOUT_MS,
      )
      const secretBytes = new TextEncoder().encode(
        Redacted.value(port.webhookSecret),
      )
      const hmacKey = yield* Mac.key(Mac.hmacSha256, secretBytes).pipe(
        Effect.orDie,
      )

      return ForgeAdapter.of({
        provider: GITHUB_FORGE_PROVIDER_ID,
        capabilities: GITHUB_APP_CAPABILITIES,

        verifyWebhookSignature: Effect.fn(
          'GitHubAppForgeAdapter.verifyWebhookSignature',
        )(function* (input) {
          const prefix = 'sha256='
          if (!input.signatureHeader.startsWith(prefix)) {
            return yield* new ForgeWebhookVerificationError({
              provider: GITHUB_FORGE_PROVIDER_ID,
              reason: 'Missing or malformed sha256= webhook signature header',
            })
          }
          const tagBytes = hexToBytes(
            input.signatureHeader.slice(prefix.length),
          )
          if (tagBytes === null) {
            return yield* new ForgeWebhookVerificationError({
              provider: GITHUB_FORGE_PROVIDER_ID,
              reason:
                'Webhook signature is not a valid 64-char SHA-256 hex tag',
            })
          }
          const valid = yield* mac
            .verify(hmacKey, tagBytes, input.rawBody)
            .pipe(
              Effect.mapError(
                () =>
                  new ForgeWebhookVerificationError({
                    provider: GITHUB_FORGE_PROVIDER_ID,
                    reason: 'HMAC-SHA256 verification failed',
                  }),
              ),
            )
          if (!valid) {
            return yield* new ForgeWebhookVerificationError({
              provider: GITHUB_FORGE_PROVIDER_ID,
              reason: `Invalid GitHub webhook signature for delivery "${input.deliveryId}"`,
            })
          }
          return undefined
        }),

        getInstallationToken: Effect.fn(
          'GitHubAppForgeAdapter.getInstallationToken',
        )(function* (input) {
          const raw = yield* port
            .createInstallationToken({ repositoryId: input.repositoryId })
            .pipe(
              Effect.mapError(
                (cause) =>
                  new ForgeAdapterError({
                    provider: GITHUB_FORGE_PROVIDER_ID,
                    operation: 'GitHubAppForgeAdapter.getInstallationToken',
                    message: sanitizeErrorMessage(cause),
                  }),
              ),
              Effect.timeoutOrElse({
                duration: Duration.millis(timeoutMs),
                orElse: () =>
                  Effect.fail(
                    new ForgeAdapterError({
                      provider: GITHUB_FORGE_PROVIDER_ID,
                      operation: 'GitHubAppForgeAdapter.getInstallationToken',
                      message: `Timed out minting installation token after ${timeoutMs}ms`,
                    }),
                  ),
              }),
            )
          const decoded = yield* Schema.decodeEffect(InstallationTokenResponse)(
            raw,
          ).pipe(
            Effect.mapError(
              (cause) =>
                new ForgeAdapterError({
                  provider: GITHUB_FORGE_PROVIDER_ID,
                  operation: 'GitHubAppForgeAdapter.getInstallationToken',
                  message: sanitizeErrorMessage(cause),
                }),
            ),
          )
          const now = yield* Clock.currentTimeMillis
          if (decoded.expiresAtMs <= now) {
            return yield* new ForgeAdapterError({
              provider: GITHUB_FORGE_PROVIDER_ID,
              operation: 'GitHubAppForgeAdapter.getInstallationToken',
              message: 'GitHub App installation token is already expired',
            })
          }
          return {
            installationId: decoded.installationId,
            token: Redacted.make(decoded.token),
            expiresAtMs: decoded.expiresAtMs,
          }
        }),

        checkRepositoryAuthority: Effect.fn(
          'GitHubAppForgeAdapter.checkRepositoryAuthority',
        )(function* (input) {
          const raw = yield* port
            .getCollaboratorPermission({
              repositoryId: input.repositoryId,
              username: input.forgeUserLogin,
            })
            .pipe(
              Effect.mapError(
                (cause) =>
                  new ForgeAdapterError({
                    provider: GITHUB_FORGE_PROVIDER_ID,
                    operation: 'GitHubAppForgeAdapter.checkRepositoryAuthority',
                    message: sanitizeErrorMessage(cause),
                  }),
              ),
              Effect.timeoutOrElse({
                duration: Duration.millis(timeoutMs),
                orElse: () =>
                  Effect.fail(
                    new ForgeAdapterError({
                      provider: GITHUB_FORGE_PROVIDER_ID,
                      operation:
                        'GitHubAppForgeAdapter.checkRepositoryAuthority',
                      message: `Timed out checking repository permission after ${timeoutMs}ms`,
                    }),
                  ),
              }),
            )
          const decoded = yield* Schema.decodeUnknownEffect(
            CollaboratorPermissionResponse,
          )(raw).pipe(
            Effect.mapError(
              (cause) =>
                new ForgeAdapterError({
                  provider: GITHUB_FORGE_PROVIDER_ID,
                  operation: 'GitHubAppForgeAdapter.checkRepositoryAuthority',
                  message: sanitizeErrorMessage(cause),
                }),
            ),
          )
          return {
            provider: GITHUB_FORGE_PROVIDER_ID,
            repositoryId: input.repositoryId,
            installationId: decoded.installationId,
            forgeUserLogin: input.forgeUserLogin,
            permission: decoded.permission,
            canApprove: canApproveWithRepositoryPermission(decoded.permission),
          } satisfies ForgeRepositoryAuthority
        }),

        getPullRequestCandidate: Effect.fn(
          'GitHubAppForgeAdapter.getPullRequestCandidate',
        )(function* (input) {
          if (!Number.isInteger(input.pullNumber) || input.pullNumber <= 0) {
            return yield* new ForgeAdapterError({
              provider: GITHUB_FORGE_PROVIDER_ID,
              operation: 'GitHubAppForgeAdapter.getPullRequestCandidate',
              message: `Pull request number must be a positive integer (got ${input.pullNumber})`,
            })
          }
          const raw = yield* port
            .getPullRequest({
              repositoryId: input.repositoryId,
              pullNumber: input.pullNumber,
            })
            .pipe(
              Effect.mapError(
                (cause) =>
                  new ForgeAdapterError({
                    provider: GITHUB_FORGE_PROVIDER_ID,
                    operation: 'GitHubAppForgeAdapter.getPullRequestCandidate',
                    message: sanitizeErrorMessage(cause),
                  }),
              ),
              Effect.timeoutOrElse({
                duration: Duration.millis(timeoutMs),
                orElse: () =>
                  Effect.fail(
                    new ForgeAdapterError({
                      provider: GITHUB_FORGE_PROVIDER_ID,
                      operation:
                        'GitHubAppForgeAdapter.getPullRequestCandidate',
                      message: `Timed out fetching pull request after ${timeoutMs}ms`,
                    }),
                  ),
              }),
            )
          const decoded = yield* Schema.decodeEffect(PullRequestResponse)(
            raw,
          ).pipe(
            Effect.mapError(
              (cause) =>
                new ForgeAdapterError({
                  provider: GITHUB_FORGE_PROVIDER_ID,
                  operation: 'GitHubAppForgeAdapter.getPullRequestCandidate',
                  message: sanitizeErrorMessage(cause),
                }),
            ),
          )
          return {
            provider: GITHUB_FORGE_PROVIDER_ID,
            changeRequestId: ChangeRequestId.make(
              `github:${input.repositoryId}#${input.pullNumber}`,
            ),
            repositoryId: input.repositoryId,
            pullNumber: input.pullNumber,
            headSha: decoded.headSha,
            isFork: decoded.isFork,
            ...(decoded.forkRepositoryId !== undefined
              ? { forkRepositoryId: decoded.forkRepositoryId }
              : {}),
          } satisfies ForgePullRequestCandidate
        }),
      })
    }),
  )
