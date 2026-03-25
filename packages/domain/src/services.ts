import { Context, Effect } from 'effect'
import type {
  GitHubInstallation,
  GitHubInstallationScope,
  GitHubInstallationToken,
  GitHubPublicationCommand,
  GitHubPublicationReceipt,
  GitHubWebhookDeliveryAttempt,
  GitHubWebhookEnvelope,
} from './github'
import type { PatchPlaneCommand } from './request-intake'
import type {
  RuntimeExecutionOutput,
  RuntimeExecutionPlan,
  RuntimeExecutionRequest,
  SandboxExecutionRequest,
  SandboxExecutionResult,
} from './runtime'

export interface BoundaryFailure {
  readonly boundary: string
  readonly message: string
  readonly retryable: boolean
  readonly cause?: unknown
}

export interface GitHubAppAuth {
  readonly name: string
  getInstallationToken(
    externalInstallationId: number,
  ): Effect.Effect<GitHubInstallationToken, BoundaryFailure>
  resolveInstallationScope(
    externalInstallationId: number,
  ): Effect.Effect<GitHubInstallationScope, BoundaryFailure>
}

export interface GitHubWebhookIngestor {
  readonly name: string
  ingest(
    delivery: GitHubWebhookEnvelope,
  ): Effect.Effect<ReadonlyArray<PatchPlaneCommand>, BoundaryFailure>
}

export interface GitHubRepositorySync {
  readonly name: string
  syncInstallation(
    installation: GitHubInstallation,
  ): Effect.Effect<GitHubInstallationScope, BoundaryFailure>
}

export interface GitHubWebhookDeliveryClient {
  readonly name: string
  listDeliveriesSince(
    deliveredSince: number,
  ): Effect.Effect<ReadonlyArray<GitHubWebhookDeliveryAttempt>, BoundaryFailure>
  redeliverDelivery(
    deliveryId: number,
  ): Effect.Effect<void, BoundaryFailure>
}

export interface GitHubPublisher {
  readonly name: string
  publish(
    command: GitHubPublicationCommand,
  ): Effect.Effect<GitHubPublicationReceipt, BoundaryFailure>
}

export interface RuntimeAdapter {
  readonly name: string
  createExecutionPlan(
    request: RuntimeExecutionRequest,
  ): Effect.Effect<RuntimeExecutionPlan, BoundaryFailure>
  normalizeOutput(
    request: RuntimeExecutionRequest,
    output: RuntimeExecutionOutput,
  ): Effect.Effect<SandboxExecutionResult['events'], BoundaryFailure>
}

export interface SandboxAdapter {
  readonly name: string
  execute(
    request: SandboxExecutionRequest,
    runtime: RuntimeAdapter,
  ): Effect.Effect<SandboxExecutionResult, BoundaryFailure>
}

export class GitHubAppAuthService extends Context.Tag(
  '@patchplane/domain/GitHubAppAuthService',
)<GitHubAppAuthService, GitHubAppAuth>() {}

export class GitHubWebhookIngestorService extends Context.Tag(
  '@patchplane/domain/GitHubWebhookIngestorService',
)<GitHubWebhookIngestorService, GitHubWebhookIngestor>() {}

export class GitHubRepositorySyncService extends Context.Tag(
  '@patchplane/domain/GitHubRepositorySyncService',
)<GitHubRepositorySyncService, GitHubRepositorySync>() {}

export class GitHubWebhookDeliveryClientService extends Context.Tag(
  '@patchplane/domain/GitHubWebhookDeliveryClientService',
)<GitHubWebhookDeliveryClientService, GitHubWebhookDeliveryClient>() {}

export class GitHubPublisherService extends Context.Tag(
  '@patchplane/domain/GitHubPublisherService',
)<GitHubPublisherService, GitHubPublisher>() {}

export class RuntimeAdapterService extends Context.Tag(
  '@patchplane/domain/RuntimeAdapterService',
)<RuntimeAdapterService, RuntimeAdapter>() {}

export class SandboxAdapterService extends Context.Tag(
  '@patchplane/domain/SandboxAdapterService',
)<SandboxAdapterService, SandboxAdapter>() {}
