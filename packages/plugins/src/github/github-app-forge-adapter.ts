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
  ForgeInstanceId,
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
export const DEFAULT_GITHUB_INSTANCE_ID = ForgeInstanceId.make('github.com')

export const GITHUB_APP_CAPABILITIES: ForgeCapabilities = {
  supportsPullRequests: true,
  supportsWebhooks: true,
  supportsInstallationTokens: true,
  supportsRepositoryPermissions: true,
  supportsStatusChecks: true,
}

const DEFAULT_GITHUB_API_TIMEOUT_MS = 15_000
const MAX_GITHUB_API_TIMEOUT_MS = 60_000
const textEncoder = new TextEncoder()

const normalizeTimeoutMs = (raw: number | undefined): number =>
  raw !== undefined && Number.isFinite(raw)
    ? Math.min(Math.max(1_000, Math.floor(raw)), MAX_GITHUB_API_TIMEOUT_MS)
    : DEFAULT_GITHUB_API_TIMEOUT_MS

export interface GitHubAppApiPort<
  EToken = unknown,
  EPerm = unknown,
  EPr = unknown,
> {
  readonly webhookSecret: Redacted.Redacted
  readonly instanceId?: ForgeInstanceId
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
      readonly forkRepositoryId?: string | undefined
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
  forkRepositoryId: Schema.optional(RepositoryId),
})

const Sha256HexTag = Schema.String.check(
  Schema.isPattern(/^[0-9a-f]{64}$/i),
).pipe(Schema.decodeTo(Schema.Uint8ArrayFromHex))

/**
 * GitHub App forge plugin implementing the provider-neutral `ForgeAdapter`
 * contract:
 * - Constant-time HMAC-SHA256 webhook verification (`X-Hub-Signature-256`) via `effect/crypto/Mac`
 * - Short-lived installation tokens wrapped in `Redacted` (never leaked in error output)
 * - Authoritative collaborator permission checks decoupled from WorkOS login
 * - Pull-request candidate metadata with fork & instance identity
 */
export const makeGitHubAppForgeAdapterLayer = <EToken, EPerm, EPr>(
  port: GitHubAppApiPort<EToken, EPerm, EPr>,
) =>
  Layer.effect(
    ForgeAdapter,
    Effect.gen(function* () {
      const mac = yield* Mac.Mac
      const timeoutMs = normalizeTimeoutMs(port.timeoutMs)
      const instanceId = port.instanceId ?? DEFAULT_GITHUB_INSTANCE_ID
      const secretBytes = textEncoder.encode(Redacted.value(port.webhookSecret))
      if (secretBytes.byteLength === 0) {
        return yield* new ForgeAdapterError({
          provider: GITHUB_FORGE_PROVIDER_ID,
          operation: 'GitHubAppForgeAdapter.layer',
          message: 'GitHub App webhook secret must not be empty',
        })
      }
      const hmacKey = yield* Mac.key(Mac.hmacSha256, secretBytes).pipe(
        Effect.mapError(
          (cause) =>
            new ForgeAdapterError({
              provider: GITHUB_FORGE_PROVIDER_ID,
              operation: 'GitHubAppForgeAdapter.layer',
              message: sanitizeErrorMessage(cause),
            }),
        ),
      )

      return ForgeAdapter.of({
        provider: GITHUB_FORGE_PROVIDER_ID,
        instanceId,
        capabilities: GITHUB_APP_CAPABILITIES,

        verifyWebhookSignature: Effect.fn(
          'GitHubAppForgeAdapter.verifyWebhookSignature',
        )(function* (input) {
          yield* Effect.annotateCurrentSpan({ deliveryId: input.deliveryId })
          const prefix = 'sha256='
          if (!input.signatureHeader.startsWith(prefix)) {
            return yield* new ForgeWebhookVerificationError({
              provider: GITHUB_FORGE_PROVIDER_ID,
              reason: 'Missing or malformed sha256= webhook signature header',
            })
          }
          const tagBytes = yield* Schema.decodeEffect(Sha256HexTag)(
            input.signatureHeader.slice(prefix.length),
          ).pipe(
            Effect.mapError(
              () =>
                new ForgeWebhookVerificationError({
                  provider: GITHUB_FORGE_PROVIDER_ID,
                  reason:
                    'Webhook signature is not a valid 64-char SHA-256 hex tag',
                }),
            ),
          )
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
          yield* Effect.annotateCurrentSpan({
            repositoryId: input.repositoryId,
          })
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
          // Static error message prevents any raw `ghs_` token in SchemaError output
          const decoded = yield* Schema.decodeEffect(InstallationTokenResponse)(
            raw,
          ).pipe(
            Effect.mapError(
              () =>
                new ForgeAdapterError({
                  provider: GITHUB_FORGE_PROVIDER_ID,
                  operation: 'GitHubAppForgeAdapter.getInstallationToken',
                  message:
                    'GitHub App installation token response failed schema validation',
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
          yield* Effect.annotateCurrentSpan({
            repositoryId: input.repositoryId,
            forgeUserLogin: input.forgeUserLogin,
          })
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
            instanceId,
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
          yield* Effect.annotateCurrentSpan({
            repositoryId: input.repositoryId,
            pullNumber: input.pullNumber,
          })
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
            instanceId,
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
