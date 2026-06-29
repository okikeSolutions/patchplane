import * as Alchemy from 'alchemy'
import * as Cloudflare from 'alchemy/Cloudflare'
import * as Effect from 'effect/Effect'
import { createPhysicalName } from './utils'

const artifactRetentionDays = 14
const aiGatewayCollectLogs = false
const aiGatewayRateLimitPerMinute = 120

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
      main: '../source-control/src/worker.ts',
      compatibility: { flags: ['nodejs_compat'] },
      build: {
        bundleAnalyzer: true,
      },
      env: {
        PATCHPLANE_EVIDENCE_R2_BUCKET: evidenceBucket.bucketName,
        PATCHPLANE_AI_GATEWAY_ID: modelGateway.gatewayId,
        CLOUDFLARE_ACCOUNT_ID: evidenceBucket.accountId,
      },
    })

    const client = yield* Cloudflare.Website.Vite('Client', {
      rootDir: '../client',
      compatibility: { flags: ['nodejs_compat'] },
      env: {
        SOURCE_CONTROL_WORKER: sourceControlWorker,
        PATCHPLANE_EVIDENCE_R2_BUCKET: evidenceBucket.bucketName,
        PATCHPLANE_AI_GATEWAY_ID: modelGateway.gatewayId,
        CLOUDFLARE_ACCOUNT_ID: evidenceBucket.accountId,
      },
      assets: { runWorkerFirst: true },
      // Alchemy's proxied Cloudflare Vite dev path currently fails TanStack Start's
      // module-runner WebSocket upgrade locally. Keep infra dev healthy and run the
      // client with `bun run dev:client`.
      dev: { mode: 'external', url: 'http://localhost:3000' },
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
      clientUrl: client.url,
      runtimeEnv: {
        PATCHPLANE_EVIDENCE_R2_BUCKET: evidenceBucket.bucketName,
        PATCHPLANE_AI_GATEWAY_ID: modelGateway.gatewayId,
        CLOUDFLARE_ACCOUNT_ID: evidenceBucket.accountId,
      },
    }
  }),
)
