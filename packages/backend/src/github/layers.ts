import { Context, Effect, Layer } from 'effect'
import type { App } from 'octokit'
import type { GitHubWebhookDeliveryClient } from '@patchplane/domain'
import {
  GitHubAppAuthService,
  GitHubPublisherService,
  GitHubRepositorySyncService,
  GitHubWebhookDeliveryClientService,
  GitHubWebhookIngestorService,
} from '@patchplane/domain'
import { BackendConfig, BackendConfigLive } from '../config/schema'
import {
  createGitHubApp,
  listAppWebhookDeliveriesSince,
  OctokitGitHubAppAuth,
  OctokitGitHubPublisher,
  OctokitGitHubRepositorySync,
  redeliverAppWebhookDelivery,
} from './octokit'
import { IssueCommentGitHubWebhookIngestor } from './webhookIngestor'

export class GitHubAppRuntime extends Context.Tag(
  '@patchplane/backend/GitHubAppRuntime',
)<GitHubAppRuntime, App>() {}

const GitHubAppLive = Layer.effect(
  GitHubAppRuntime,
  Effect.gen(function* () {
    const config = yield* BackendConfig

    return createGitHubApp({
      appId: config.github.appId,
      privateKey: config.github.privateKey,
      webhookSecret: config.github.webhookSecret,
      ...(config.github.baseUrl ? { baseUrl: config.github.baseUrl } : {}),
    })
  }),
).pipe(Layer.provide(BackendConfigLive))

const GitHubAppAuthLive = Layer.effect(
  GitHubAppAuthService,
  Effect.gen(function* () {
    const app = yield* GitHubAppRuntime
    return new OctokitGitHubAppAuth(app)
  }),
).pipe(Layer.provide(GitHubAppLive))

const GitHubRepositorySyncLive = Layer.effect(
  GitHubRepositorySyncService,
  Effect.gen(function* () {
    const auth = yield* GitHubAppAuthService
    return new OctokitGitHubRepositorySync(auth)
  }),
).pipe(Layer.provide(GitHubAppAuthLive))

const GitHubWebhookIngestorLive = Layer.effect(
  GitHubWebhookIngestorService,
  Effect.gen(function* () {
    const config = yield* BackendConfig

    return new IssueCommentGitHubWebhookIngestor({
      executionTargetKey: config.github.defaultExecutionTargetKey,
      policyBundleKey: config.github.defaultPolicyBundleKey,
    })
  }),
).pipe(Layer.provide(BackendConfigLive))

const GitHubWebhookDeliveryClientLive = Layer.effect(
  GitHubWebhookDeliveryClientService,
  Effect.gen(function* () {
    const app = yield* GitHubAppRuntime

    const client: GitHubWebhookDeliveryClient = {
      name: 'octokit-github-webhook-delivery-client',
      listDeliveriesSince: (deliveredSince) =>
        listAppWebhookDeliveriesSince(app, deliveredSince),
      redeliverDelivery: (deliveryId) =>
        redeliverAppWebhookDelivery(app, deliveryId),
    }

    return client
  }),
).pipe(Layer.provide(GitHubAppLive))

const GitHubPublisherLive = Layer.effect(
  GitHubPublisherService,
  Effect.gen(function* () {
    const app = yield* GitHubAppRuntime
    return new OctokitGitHubPublisher(app)
  }),
).pipe(Layer.provide(GitHubAppLive))

export const GitHubBoundaryLive = Layer.mergeAll(
  GitHubAppLive,
  GitHubAppAuthLive,
  GitHubRepositorySyncLive,
  GitHubWebhookIngestorLive,
  GitHubWebhookDeliveryClientLive,
  GitHubPublisherLive,
)
