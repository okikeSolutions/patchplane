import * as Alchemy from 'alchemy'
import * as Cloudflare from 'alchemy/Cloudflare'
import * as Config from 'effect/Config'
import * as Effect from 'effect/Effect'
import { Path } from 'effect/Path'
import { clientRuntimeEnv, sourceControlRuntimeEnv } from './apps/infra/config.ts'
import { createPhysicalName } from './apps/infra/utils.ts'

const artifactRetentionDays = 14
const aiGatewayCollectLogs = false
const aiGatewayRateLimitPerMinute = 120
const evidenceR2AccessKeyId = Config.redacted('PATCHPLANE_EVIDENCE_R2_ACCESS_KEY_ID').pipe(
  Config.orElse(() => Config.redacted('CLOUDFLARE_ACCESS_KEY_ID')),
)
const evidenceR2SecretAccessKey = Config.redacted('PATCHPLANE_EVIDENCE_R2_SECRET_ACCESS_KEY').pipe(
  Config.orElse(() => Config.redacted('CLOUDFLARE_SECRET_ACCESS_KEY')),
)

export default Alchemy.Stack(
  'PatchPlaneInfra',
  {
    providers: Cloudflare.providers(),
    state: Cloudflare.state(),
  },
  Effect.gen(function* () {
    const rawStage = yield* Alchemy.Stage
    const stage = createPhysicalName({ id: '', stage: rawStage, prefix: rawStage, fallback: 'dev' })
    const retentionDays = Math.max(1, Math.floor(artifactRetentionDays))
    const retentionSeconds = retentionDays * 24 * 60 * 60
    const rateLimitPerMinute = Math.max(1, Math.floor(aiGatewayRateLimitPerMinute))
    const collectAiGatewayLogs = aiGatewayCollectLogs
    const path = yield* Path

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

    const sourceControlWorker = yield* Cloudflare.Worker('SourceControlWorker', {
      main: path.resolve(import.meta.dirname, 'apps/source-control/src/worker.ts'),
      url: false,
      compatibility: { flags: ['nodejs_compat'] },
      env: {
        ...sourceControlRuntimeEnv,
        PATCHPLANE_EVIDENCE_R2_BUCKET: evidenceBucket.bucketName,
        PATCHPLANE_EVIDENCE_BUCKET: evidenceBucket,
        PATCHPLANE_AI_GATEWAY_ID: modelGateway.gatewayId,
        CLOUDFLARE_ACCOUNT_ID: evidenceBucket.accountId,
      },
    })

    const githubWebhookWorker = yield* Cloudflare.Worker('GitHubWebhookWorker', {
      main: path.resolve(import.meta.dirname, 'apps/source-control/src/webhook-worker.ts'),
      compatibility: { flags: ['nodejs_compat'] },
      env: {
        SOURCE_CONTROL_WORKER: sourceControlWorker,
      },
    })

    const client = yield* Cloudflare.Website.Vite('Client', {
      rootDir: path.resolve(import.meta.dirname, 'apps/client'),
      compatibility: { flags: ['nodejs_compat'] },
      env: {
        ...clientRuntimeEnv,
        SOURCE_CONTROL_WORKER: sourceControlWorker,
        PATCHPLANE_EVIDENCE_R2_BUCKET: evidenceBucket.bucketName,
        PATCHPLANE_EVIDENCE_BUCKET: evidenceBucket,
        PATCHPLANE_EVIDENCE_R2_ACCESS_KEY_ID: evidenceR2AccessKeyId,
        PATCHPLANE_EVIDENCE_R2_SECRET_ACCESS_KEY: evidenceR2SecretAccessKey,
        PATCHPLANE_AI_GATEWAY_ID: modelGateway.gatewayId,
        CLOUDFLARE_ACCOUNT_ID: evidenceBucket.accountId,
      },
      dev: { port: 3000 },
      assets: { runWorkerFirst: true },
    })

    return {
      stage,
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
