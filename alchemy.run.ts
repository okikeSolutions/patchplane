import * as Alchemy from 'alchemy'
import * as Cloudflare from 'alchemy/Cloudflare'
import * as Config from 'effect/Config'
import * as ConfigProvider from 'effect/ConfigProvider'
import * as Effect from 'effect/Effect'
import * as FileSystem from 'effect/FileSystem'
import * as Option from 'effect/Option'
import { Path } from 'effect/Path'
import {
  clientRuntimeEnv,
  sourceControlRuntimeEnv,
} from './apps/infra/config.ts'
import { createPhysicalName } from './apps/infra/utils.ts'

const artifactRetentionDays = 14
const aiGatewayCollectLogs = false
const aiGatewayRateLimitPerMinute = 120
const devWorkerObservability = {
  enabled: true,
  headSamplingRate: 1,
  logs: {
    enabled: true,
    invocationLogs: false,
    headSamplingRate: 1,
    persist: true,
  },
  traces: {
    enabled: true,
    headSamplingRate: 1,
    persist: true,
  },
} as const
export default Alchemy.Stack(
  'PatchPlaneInfra',
  {
    providers: Cloudflare.providers(),
    state: Cloudflare.state(),
  },
  Effect.gen(function* () {
    const rawStage = yield* Alchemy.Stage
    const stage = createPhysicalName({
      id: '',
      stage: rawStage,
      prefix: rawStage,
      fallback: 'dev',
    })
    const isLandingStage =
      rawStage === 'prod' || rawStage.startsWith('landing-')
    const path = yield* Path

    if (isLandingStage) {
      const fileSystem = yield* FileSystem.FileSystem
      const publicDirectory = path.resolve(
        import.meta.dirname,
        'apps/client/public',
      )
      const readStaticAsset = (fileName: string) =>
        fileSystem.readFileString(path.join(publicDirectory, fileName)).pipe(
          Effect.mapError(
            (error) =>
              new Config.ConfigError(
                new ConfigProvider.SourceError({
                  message: error.message,
                }),
              ),
          ),
        )
      const [headers, redirects] = yield* Effect.all([
        readStaticAsset('_headers'),
        readStaticAsset('_redirects'),
      ])
      const configuredProductionDomain = yield* Config.option(
        Config.string('PATCHPLANE_PRODUCTION_DOMAIN'),
      )
      const productionDomain =
        Option.getOrUndefined(configuredProductionDomain)?.trim() || undefined
      const client = yield* Cloudflare.Website.StaticSite('Client', {
        cwd: path.resolve(import.meta.dirname, 'apps/client'),
        command: 'bun run build:landing',
        outdir: 'dist/client',
        ...(rawStage === 'prod' && productionDomain !== undefined
          ? { domain: productionDomain }
          : {}),
        assets: {
          headers,
          redirects,
          htmlHandling: 'drop-trailing-slash',
          notFoundHandling: '404-page',
        },
      })

      return {
        stage,
        surface: 'landing' as const,
        clientUrl: client.url,
      }
    }

    const retentionDays = Math.max(1, Math.floor(artifactRetentionDays))
    const retentionSeconds = retentionDays * 24 * 60 * 60
    const rateLimitPerMinute = Math.max(
      1,
      Math.floor(aiGatewayRateLimitPerMinute),
    )
    const collectAiGatewayLogs = aiGatewayCollectLogs

    const evidenceBucket = yield* Cloudflare.R2.Bucket('EvidenceArtifacts', {
      name: createPhysicalName({
        id: 'evidence-artifacts',
        stage,
        maxLength: 63,
      }),
      lifecycleRules: [
        {
          id: 'expire-alpha-artifacts',
          enabled: true,
          prefix: '',
          deleteObjectsTransition: {
            condition: { type: 'Age', maxAge: retentionSeconds },
          },
        },
        {
          id: 'abort-incomplete-multipart-uploads',
          enabled: true,
          prefix: '',
          abortMultipartUploadsTransition: {
            condition: { type: 'Age', maxAge: 24 * 60 * 60 },
          },
        },
      ],
    })

    const modelGateway = yield* Cloudflare.AI.Gateway('ModelGateway', {
      id: createPhysicalName({ id: 'model-gateway', stage, maxLength: 64 }),
      cacheTtl: null,
      collectLogs: collectAiGatewayLogs,
      authentication: true,
      rateLimitingInterval: 60,
      rateLimitingLimit: rateLimitPerMinute,
      rateLimitingTechnique: 'sliding',
    })

    const verificationExecutionQueue = yield* Cloudflare.Queues.Queue(
      'VerificationExecutionQueue',
    )
    const verificationExecutionDeadLetterQueue = yield* Cloudflare.Queues.Queue(
      'VerificationExecutionDeadLetterQueue',
    )

    const sourceControlWorker = yield* Cloudflare.Worker(
      'SourceControlWorker',
      {
        main: path.resolve(
          import.meta.dirname,
          'apps/source-control/src/worker.ts',
        ),
        url: false,
        compatibility: { flags: ['nodejs_compat'] },
        observability: devWorkerObservability,
        env: {
          ...sourceControlRuntimeEnv,
          PATCHPLANE_EVIDENCE_R2_BUCKET: evidenceBucket.bucketName,
          PATCHPLANE_EVIDENCE_BUCKET: evidenceBucket,
          PATCHPLANE_AI_GATEWAY_ID: modelGateway.gatewayId,
          CLOUDFLARE_ACCOUNT_ID: evidenceBucket.accountId,
        },
      },
    )

    const githubWebhookWorker = yield* Cloudflare.Worker(
      'GitHubWebhookWorker',
      {
        main: path.resolve(
          import.meta.dirname,
          'apps/source-control/src/webhook-worker.ts',
        ),
        compatibility: { flags: ['nodejs_compat'] },
        observability: devWorkerObservability,
        crons: ['*/5 * * * *'],
        env: {
          CLOUDFLARE_SENTRY_DSN: sourceControlRuntimeEnv.CLOUDFLARE_SENTRY_DSN,
          GITHUB_WEBHOOK_SECRET: sourceControlRuntimeEnv.GITHUB_WEBHOOK_SECRET,
          CONVEX_URL: sourceControlRuntimeEnv.CONVEX_URL,
          PATCHPLANE_SYSTEM_INGESTION_SECRET:
            sourceControlRuntimeEnv.PATCHPLANE_SYSTEM_INGESTION_SECRET,
          SOURCE_CONTROL_WORKER: sourceControlWorker,
          PATCHPLANE_EVIDENCE_BUCKET: evidenceBucket,
          VERIFICATION_EXECUTION_QUEUE: verificationExecutionQueue,
          VERIFICATION_DEAD_LETTER_QUEUE_NAME:
            verificationExecutionDeadLetterQueue.queueName,
        },
      },
    )

    yield* Cloudflare.Queues.Consumer('VerificationExecutionConsumer', {
      queueId: verificationExecutionQueue.queueId,
      scriptName: githubWebhookWorker.workerName,
      settings: {
        batchSize: 1,
        maxRetries: 3,
        maxWaitTimeMs: 1_000,
        retryDelay: 30,
      },
      deadLetterQueue: verificationExecutionDeadLetterQueue.queueName,
    })

    yield* Cloudflare.Queues.Consumer(
      'VerificationExecutionDeadLetterConsumer',
      {
        queueId: verificationExecutionDeadLetterQueue.queueId,
        scriptName: githubWebhookWorker.workerName,
        settings: {
          batchSize: 1,
          maxRetries: 100,
          maxWaitTimeMs: 1_000,
          retryDelay: 3_600,
        },
      },
    )

    const client = yield* Cloudflare.Website.Vite('Client', {
      rootDir: path.resolve(import.meta.dirname, 'apps/client'),
      compatibility: { flags: ['nodejs_compat'] },
      observability: devWorkerObservability,
      env: {
        ...clientRuntimeEnv,
        PATCHPLANE_DEBUG_LOGGING: true,
        CF_VERSION_METADATA: Cloudflare.Workers.VersionMetadata(),
        SOURCE_CONTROL_WORKER: sourceControlWorker,
        PATCHPLANE_EVIDENCE_R2_BUCKET: evidenceBucket.bucketName,
        PATCHPLANE_EVIDENCE_BUCKET: evidenceBucket,
        PATCHPLANE_AI_GATEWAY_ID: modelGateway.gatewayId,
        CLOUDFLARE_ACCOUNT_ID: evidenceBucket.accountId,
      },
      dev: { port: 3000 },
    })

    return {
      stage,
      surface: 'full' as const,
      evidenceBucketName: evidenceBucket.bucketName,
      evidenceBucketAccountId: evidenceBucket.accountId,
      evidenceRetentionDays: retentionDays,
      aiGatewayId: modelGateway.gatewayId,
      aiGatewayCollectLogs: collectAiGatewayLogs,
      aiGatewayRateLimitPerMinute: rateLimitPerMinute,
      sourceControlWorkerUrl: sourceControlWorker.url,
      githubWebhookWorkerUrl: githubWebhookWorker.url,
      clientUrl: client.url,
      runtimeEnv: {
        PATCHPLANE_EVIDENCE_R2_BUCKET: evidenceBucket.bucketName,
        PATCHPLANE_AI_GATEWAY_ID: modelGateway.gatewayId,
        CLOUDFLARE_ACCOUNT_ID: evidenceBucket.accountId,
      },
    }
  }),
)
