import { Context, type Effect } from 'effect'
import type * as Redacted from 'effect/Redacted'
import type {
  DeliveryId,
  ForgeAdapterError,
  ForgeCapabilities,
  ForgeInstallationId,
  ForgeInstanceId,
  ForgeProviderId,
  ForgePullRequestCandidate,
  ForgeRepositoryAuthority,
  ForgeUserLogin,
  ForgeWebhookVerificationError,
  RepositoryId,
} from '@patchplane/domain'

export interface ForgeInstallationToken {
  readonly installationId: ForgeInstallationId
  readonly token: Redacted.Redacted
  readonly expiresAtMs: number
}

/**
 * Provider-neutral source-control forge boundary with explicit capability and
 * instance declarations. V2 ships a real GitHub App adapter; future forges
 * (such as GitLab or Gitea) implement this contract with zero core changes.
 *
 * Note: `verifyWebhookSignature` verifies cryptographic authenticity only;
 * callers MUST enforce replay deduplication via `AcceptanceStore.recordDeliveryReceipt`.
 */
export interface ForgeAdapterService {
  readonly provider: ForgeProviderId
  readonly instanceId: ForgeInstanceId
  readonly capabilities: ForgeCapabilities

  readonly verifyWebhookSignature: (input: {
    readonly rawBody: Uint8Array
    readonly signatureHeader: string
    readonly deliveryId: DeliveryId
  }) => Effect.Effect<void, ForgeWebhookVerificationError>

  readonly getInstallationToken: (input: {
    readonly repositoryId: RepositoryId
  }) => Effect.Effect<ForgeInstallationToken, ForgeAdapterError>

  readonly checkRepositoryAuthority: (input: {
    readonly repositoryId: RepositoryId
    readonly forgeUserLogin: ForgeUserLogin
  }) => Effect.Effect<ForgeRepositoryAuthority, ForgeAdapterError>

  readonly getPullRequestCandidate: (input: {
    readonly repositoryId: RepositoryId
    readonly pullNumber: number
  }) => Effect.Effect<ForgePullRequestCandidate, ForgeAdapterError>
}

export class ForgeAdapter extends Context.Service<
  ForgeAdapter,
  ForgeAdapterService
>()('@patchplane/core/ForgeAdapter') {}
